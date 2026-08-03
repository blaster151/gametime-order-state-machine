import { randomUUID } from 'node:crypto';
import { Clock, SystemClock } from '../domain/clock';
import { Order } from '../domain/order';
import { OrderNotFoundError } from '../domain/errors';
import { OrderRepository } from './order-repository';
import { PaymentGateway } from '../gateways/payment-gateway';
import { OrderCompletionGateway } from '../gateways/order-completion-gateway';
import { PartialFailureError, PaymentAuthorizationError } from './errors';

/**
 * Orchestrates the order lifecycle: guards which stage a command is legal
 * from, calls the relevant external dependency, and applies the resulting
 * domain transition. All state-machine rules themselves live in `Order` â€”
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

    const result = await this.paymentGateway.authorize(orderId);

    if (result.outcome === 'approved') {
      order.markPaymentAuthorized(result.authorizationId);
    } else if (result.outcome === 'declined') {
      order.rejectPayment(result.reason);
    } else {
      // Unexpected technical failure â€” distinct from a decline. We don't know
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

    const completionResult = await this.completionGateway.complete(orderId);

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

    const voidResult = await this.paymentGateway.void(orderId, authorizationId);

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
}