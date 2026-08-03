import { describe, expect, it } from 'vitest';
import { OrderService } from '../../src/app/order-service';
import { InMemoryOrderRepository } from '../../src/app/order-repository';
import { PartialFailureError, PaymentAuthorizationError } from '../../src/app/errors';
import { InvalidTransitionError, OrderNotFoundError } from '../../src/domain/errors';
import { FakePaymentGateway } from '../../src/fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from '../../src/fakes/fake-order-completion-gateway';
import { SequentialClock } from '../support/sequential-clock';
import { OrderRepository } from '../../src/app/order-repository';

function buildService(options: {
  authorize?: ConstructorParameters<typeof FakePaymentGateway>[0];
  voidBehavior?: ConstructorParameters<typeof FakePaymentGateway>[1];
  completion?: ConstructorParameters<typeof FakeOrderCompletionGateway>[0];
  sharedCallLog?: string[];
  repository?: OrderRepository;
} = {}) {
  const sharedCallLog = options.sharedCallLog ?? [];
  const repository = options.repository ?? new InMemoryOrderRepository();
  const paymentGateway = new FakePaymentGateway(options.authorize, options.voidBehavior, sharedCallLog);
  const completionGateway = new FakeOrderCompletionGateway(options.completion, sharedCallLog);
  const service = new OrderService(repository, paymentGateway, completionGateway, new SequentialClock(), (() => {
    let n = 0;
    return () => `order-${++n}`;
  })());

  return { service, repository, paymentGateway, completionGateway, sharedCallLog };
}

describe('OrderService â€” happy path', () => {
  it('creates, authorizes, and completes an order', async () => {
    const { service, paymentGateway, completionGateway } = buildService();

    const created = await service.createOrder();
    expect(created.getState()).toBe('initialized');

    const authorized = await service.authorizePayment(created.id);
    expect(authorized.getState()).toBe('payment_authorized');
    expect(authorized.getAuthorizationId()).toBe(`auth-${created.id}`);

    const completed = await service.completeOrder(created.id);
    expect(completed.getState()).toBe('complete');
    expect(completed.getHistory().map((e) => e.toState)).toEqual([
      'initialized',
      'payment_authorized',
      'complete',
    ]);

    expect(paymentGateway.calls.some((c) => c.method === 'void')).toBe(false);
    expect(completionGateway.calls).toHaveLength(1);
  });
});

describe('OrderService â€” payment decline', () => {
  it('rejects the order with no void and no completion attempt', async () => {
    const { service, paymentGateway, completionGateway } = buildService({
      authorize: { outcome: 'declined', reason: 'card_declined' },
    });

    const created = await service.createOrder();
    const result = await service.authorizePayment(created.id);

    expect(result.getState()).toBe('rejected');
    expect(result.getHistory().at(-1)?.reason).toMatchObject({ code: 'payment_declined', message: 'card_declined' });
    expect(paymentGateway.calls).toEqual([{ method: 'authorize', orderId: created.id }]);
    expect(completionGateway.calls).toHaveLength(0);
  });

  it('throws PaymentAuthorizationError and leaves the order initialized on an unexpected gateway error', async () => {
    const { service, repository } = buildService({
      authorize: { outcome: 'error', reason: 'gateway_unreachable' },
    });
    const created = await service.createOrder();

    await expect(service.authorizePayment(created.id)).rejects.toThrow(PaymentAuthorizationError);

    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('initialized');
  });
});

describe('OrderService â€” completion failure, void succeeds', () => {
  it('cancels the order only after the void succeeds', async () => {
    const sharedCallLog: string[] = [];
    const { service, paymentGateway } = buildService({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'voided' },
      sharedCallLog,
    });

    const created = await service.createOrder();
    await service.authorizePayment(created.id);
    const result = await service.completeOrder(created.id);

    expect(result.getState()).toBe('cancelled');
    expect(result.getHistory().at(-1)?.reason.code).toBe('completion_failed_void_succeeded');
    expect(sharedCallLog).toEqual(['payment.authorize', 'completionGateway.complete', 'payment.void']);
    expect(paymentGateway.calls.filter((c) => c.method === 'void')).toHaveLength(1);
  });
});

describe('OrderService â€” completion failure, void also fails', () => {
  it('persists needs_attention with both reasons and throws PartialFailureError', async () => {
    const { service, repository } = buildService({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'error', reason: 'gateway_timeout' },
    });

    const created = await service.createOrder();
    await service.authorizePayment(created.id);

    let caught: unknown;
    try {
      await service.completeOrder(created.id);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PartialFailureError);
    const error = caught as PartialFailureError;
    expect(error.orderId).toBe(created.id);
    expect(error.completionFailureReason).toBe('fulfillment_error');
    expect(error.voidFailureReason).toBe('gateway_timeout');

    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('needs_attention');
    const last = stored?.getHistory().at(-1);
    expect(last?.reason.metadata).toMatchObject({
      completionFailureMessage: 'fulfillment_error',
      voidFailureMessage: 'gateway_timeout',
    });
  });
});

describe('OrderService â€” invalid transitions', () => {
  it('rejects completing an order that was never authorized, without calling any dependency', async () => {
    const { service, paymentGateway, completionGateway, repository } = buildService();
    const created = await service.createOrder();

    await expect(service.completeOrder(created.id)).rejects.toThrow(InvalidTransitionError);

    expect(paymentGateway.calls).toHaveLength(0);
    expect(completionGateway.calls).toHaveLength(0);
    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('initialized');
    expect(stored?.getHistory()).toHaveLength(1);
  });

  it('rejects authorizing an order that is already payment_authorized', async () => {
    const { service, paymentGateway } = buildService();
    const created = await service.createOrder();
    await service.authorizePayment(created.id);

    await expect(service.authorizePayment(created.id)).rejects.toThrow(InvalidTransitionError);
    expect(paymentGateway.calls.filter((c) => c.method === 'authorize')).toHaveLength(1);
  });

  it('throws OrderNotFoundError for an unknown order id', async () => {
    const { service } = buildService();

    await expect(service.getOrder('missing')).rejects.toThrow(OrderNotFoundError);
  });
});