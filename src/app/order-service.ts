import { randomUUID } from 'node:crypto';
import { Clock, SystemClock } from '../domain/clock';
import { Order } from '../domain/order';
import { OrderNotFoundError } from '../domain/errors';
import { OrderRepository } from './order-repository';
import { AuthorizeResult, PaymentGateway, VoidResult } from '../gateways/payment-gateway';
import { CompletionResult, OrderCompletionGateway } from '../gateways/order-completion-gateway';
import { PartialFailureError, PaymentAuthorizationError } from './errors';

/** Extracts a safe, human-readable message from anything a dependency might throw. */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrates the order lifecycle: guards which stage a command is legal
 * from, calls the relevant external dependency, and applies the resulting
 * domain transition. All state-machine rules themselves live in `Order` —
 * this class only decides *which* transition to request and in what order
 * to call dependencies.
 */
export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly completionGateway: OrderCompletionGateway,
    private readonly clock: Clock = new SystemClock(),
    private readonly generateId: () => string = () => randomUUID()
  ) {}

  async createOrder(): Promise<Order> {
    const order = Order.create(this.generateId(), this.clock);
    await this.repository.save(order);
    return order;
  }

  async authorizePayment(orderId: string): Promise<Order> {
    const order = await this.requireOrder(orderId);
    order.assertCanTransitionTo('payment_authorized');

    // A rejected/thrown call is treated identically to an explicit `error`
    // outcome — TypeScript's Promise<AuthorizeResult> return type does not
    // guarantee the promise never rejects, and a real (or test) gateway may
    // throw instead of returning a failure object.
    const result = await this.callDependency<AuthorizeResult>(
      () => this.paymentGateway.authorize(orderId),
      (message) => ({ outcome: 'error', reason: message })
    );

    if (result.outcome === 'approved') {
      order.markPaymentAuthorized(result.authorizationId);
    } else if (result.outcome === 'declined') {
      order.rejectPayment(result.reason);
    } else {
      // Unexpected technical failure — distinct from a decline. We don't know
      // whether the charge went through, so the order is left `initialized`
      // (no state mutation) rather than guessing. Surfaced as an error for
      // the caller to retry or investigate.
      throw new PaymentAuthorizationError(orderId, result.reason);
    }

    await this.repository.save(order);
    return order;
  }

  async completeOrder(orderId: string): Promise<Order> {
    const order = await this.requireOrder(orderId);
    order.assertCanTransitionTo('complete');

    // A thrown/rejected completion attempt is treated the same as an
    // explicit `failed` outcome, so it still triggers the void — a
    // completion failure must never be swallowed just because the
    // dependency happened to reject instead of resolving with a failure.
    const completionResult = await this.callDependency<CompletionResult>(
      () => this.completionGateway.complete(orderId),
      (message) => ({ outcome: 'failed', reason: message })
    );

    if (completionResult.outcome === 'completed') {
      order.markComplete();
      await this.repository.save(order);
      return order;
    }

    const authorizationId = order.getAuthorizationId();
    /* istanbul ignore if -- defensive: payment_authorized always has an authorizationId */
    if (!authorizationId) {
      throw new Error(`Order ${orderId} is payment_authorized but has no stored authorization id`);
    }

    // Same reasoning: a void that throws must still land in needs_attention,
    // never leave the order stuck in payment_authorized.
    const voidResult = await this.callDependency<VoidResult>(
      () => this.paymentGateway.void(orderId, authorizationId),
      (message) => ({ outcome: 'error', reason: message })
    );

    if (voidResult.outcome === 'voided') {
      order.markCancelledAfterVoid(completionResult.reason);
      await this.repository.save(order);
      return order;
    }

    // Void also failed: persist needs_attention with both failure reasons
    // *before* surfacing the error, so the order is never lost even though
    // the caller sees a thrown error.
    order.markNeedsAttention(completionResult.reason, voidResult.reason);
    await this.repository.save(order);
    throw new PartialFailureError(orderId, completionResult.reason, voidResult.reason);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.requireOrder(orderId);
  }

  private async requireOrder(orderId: string): Promise<Order> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }

  /**
   * Calls an external dependency and normalizes a thrown/rejected error into
   * the same result shape used for an explicit failure outcome, via
   * `onRejection`. This is the single place that guards against dependencies
   * that reject instead of resolving with a failure object.
   */
  private async callDependency<T>(call: () => Promise<T>, onRejection: (message: string) => T): Promise<T> {
    try {
      return await call();
    } catch (error) {
      return onRejection(toErrorMessage(error));
    }
  }
}
