import { describe, expect, it } from 'vitest';
import { OrderService } from '../../src/app/order-service';
import { InMemoryOrderRepository } from '../../src/app/order-repository';
import { PartialFailureError, PaymentAuthorizationError } from '../../src/app/errors';
import { InvalidTransitionError, OrderNotFoundError } from '../../src/domain/errors';
import { FakePaymentGateway } from '../../src/fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from '../../src/fakes/fake-order-completion-gateway';
import { SequentialClock } from '../support/sequential-clock';
import { OrderRepository } from '../../src/app/order-repository';
import { RecordingOrderRepository } from '../support/recording-order-repository';
import { PaymentGateway } from '../../src/gateways/payment-gateway';

class ObservingVoidPaymentGateway implements PaymentGateway {
  readonly calls: Array<{ method: 'authorize' | 'void'; orderId: string; authorizationId?: string }> = [];
  stateDuringVoid: string | null = null;

  constructor(
    private readonly repository: OrderRepository,
    private readonly sharedCallLog: string[]
  ) {}

  async authorize(orderId: string) {
    this.calls.push({ method: 'authorize', orderId });
    this.sharedCallLog.push('payment.authorize');
    return { outcome: 'approved' as const, authorizationId: `auth-${orderId}` };
  }

  async void(orderId: string, authorizationId: string) {
    this.calls.push({ method: 'void', orderId, authorizationId });
    this.sharedCallLog.push('payment.void');
    const stored = await this.repository.findById(orderId);
    this.stateDuringVoid = stored?.getState() ?? null;
    return { outcome: 'voided' as const };
  }
}

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

describe('OrderService — happy path', () => {
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

describe('OrderService — payment decline', () => {
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

describe('OrderService — completion failure, void succeeds', () => {
  it('cancels the order only after the void succeeds', async () => {
    const sharedCallLog: string[] = [];
    const repository = new InMemoryOrderRepository();
    const paymentGateway = new ObservingVoidPaymentGateway(repository, sharedCallLog);
    const completionGateway = new FakeOrderCompletionGateway({ outcome: 'failed', reason: 'fulfillment_error' }, sharedCallLog);
    const service = new OrderService(repository, paymentGateway, completionGateway, new SequentialClock(), (() => {
      let n = 0;
      return () => `order-${++n}`;
    })());

    const created = await service.createOrder();
    await service.authorizePayment(created.id);
    const result = await service.completeOrder(created.id);

    expect(result.getState()).toBe('cancelled');
    expect(result.getHistory().at(-1)?.reason.code).toBe('completion_failed_void_succeeded');
    expect(sharedCallLog).toEqual(['payment.authorize', 'completionGateway.complete', 'payment.void']);
    expect(paymentGateway.calls.at(-1)).toEqual({
      method: 'void',
      orderId: created.id,
      authorizationId: `auth-${created.id}`,
    });
    expect(paymentGateway.stateDuringVoid).toBe('payment_authorized');
  });
});

describe('OrderService — completion failure, void also fails', () => {
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

describe('OrderService — dependency rejections (throwing test doubles)', () => {
  // A Promise<T> return type does not guarantee the promise never rejects.
  // These mirror the 4 required scenarios but with each dependency throwing
  // instead of returning a failure result object, to prove rejections are
  // normalized into the same handling rather than escaping as raw errors.

  it('treats a thrown authorize() the same as an explicit error outcome', async () => {
    const { service, repository } = buildService({
      authorize: { outcome: 'throws', error: new Error('gateway_unreachable') },
    });
    const created = await service.createOrder();

    await expect(service.authorizePayment(created.id)).rejects.toThrow(PaymentAuthorizationError);

    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('initialized');
  });

  it('still attempts the void when complete() throws instead of returning a failure result', async () => {
    const { service, paymentGateway } = buildService({
      completion: { outcome: 'throws', error: new Error('fulfillment_crashed') },
      voidBehavior: { outcome: 'voided' },
    });
    const created = await service.createOrder();
    await service.authorizePayment(created.id);

    const result = await service.completeOrder(created.id);

    expect(result.getState()).toBe('cancelled');
    expect(paymentGateway.calls.filter((c) => c.method === 'void')).toHaveLength(1);
  });

  it('persists needs_attention and surfaces PartialFailureError when void() throws', async () => {
    const { service, repository } = buildService({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'throws', error: new Error('void_crashed') },
    });
    const created = await service.createOrder();
    await service.authorizePayment(created.id);

    await expect(service.completeOrder(created.id)).rejects.toThrow(PartialFailureError);

    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('needs_attention');
    expect(stored?.getHistory().at(-1)?.reason.metadata).toMatchObject({
      completionFailureMessage: 'fulfillment_error',
      voidFailureMessage: 'void_crashed',
    });
  });

  it('normalizes both a thrown completion and a thrown void into needs_attention', async () => {
    const { service, repository } = buildService({
      completion: { outcome: 'throws', error: 'fulfillment_crashed' },
      voidBehavior: { outcome: 'throws', error: 'void_crashed' },
    });
    const created = await service.createOrder();
    await service.authorizePayment(created.id);

    await expect(service.completeOrder(created.id)).rejects.toThrow(PartialFailureError);

    const stored = await repository.findById(created.id);
    expect(stored?.getState()).toBe('needs_attention');
  });
});

describe('OrderService — invalid transitions', () => {
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

// Adversarial regression coverage: each test below is written to fail if a
// specific real-world bug were reintroduced, not just to re-check the happy
// path from a different angle.
describe('OrderService — adversarial regression guards', () => {
  it('actually persists needs_attention via repository.save (not just via in-memory object mutation)', async () => {
    const recordingRepository = new RecordingOrderRepository(new InMemoryOrderRepository());
    const { service, repository } = buildService({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'error', reason: 'gateway_timeout' },
      repository: recordingRepository,
    });

    const created = await service.createOrder();
    await service.authorizePayment(created.id);
    await expect(service.completeOrder(created.id)).rejects.toThrow(PartialFailureError);

    // Would fail if a future refactor threw PartialFailureError without ever
    // calling repository.save — an in-memory Map storing the same object
    // reference would otherwise hide that regression.
    expect(recordingRepository.saveCalls).toContainEqual({
      orderId: created.id,
      stateAtSaveTime: 'needs_attention',
    });
    expect((await repository.findById(created.id))?.getState()).toBe('needs_attention');
  });

  it('never calls an external dependency again once an order reaches any terminal state', async () => {
    // complete
    const complete = buildService();
    const completeOrder = await complete.service.createOrder();
    await complete.service.authorizePayment(completeOrder.id);
    await complete.service.completeOrder(completeOrder.id);
    const completeCallsBefore = complete.paymentGateway.calls.length + complete.completionGateway.calls.length;
    await expect(complete.service.authorizePayment(completeOrder.id)).rejects.toThrow(InvalidTransitionError);
    await expect(complete.service.completeOrder(completeOrder.id)).rejects.toThrow(InvalidTransitionError);
    expect(complete.paymentGateway.calls.length + complete.completionGateway.calls.length).toBe(completeCallsBefore);

    // rejected
    const rejected = buildService({ authorize: { outcome: 'declined', reason: 'card_declined' } });
    const rejectedOrder = await rejected.service.createOrder();
    await rejected.service.authorizePayment(rejectedOrder.id);
    const rejectedCallsBefore = rejected.paymentGateway.calls.length + rejected.completionGateway.calls.length;
    await expect(rejected.service.authorizePayment(rejectedOrder.id)).rejects.toThrow(InvalidTransitionError);
    await expect(rejected.service.completeOrder(rejectedOrder.id)).rejects.toThrow(InvalidTransitionError);
    expect(rejected.paymentGateway.calls.length + rejected.completionGateway.calls.length).toBe(rejectedCallsBefore);

    // cancelled
    const cancelled = buildService({ completion: { outcome: 'failed', reason: 'fulfillment_error' } });
    const cancelledOrder = await cancelled.service.createOrder();
    await cancelled.service.authorizePayment(cancelledOrder.id);
    await cancelled.service.completeOrder(cancelledOrder.id);
    const cancelledCallsBefore = cancelled.paymentGateway.calls.length + cancelled.completionGateway.calls.length;
    await expect(cancelled.service.authorizePayment(cancelledOrder.id)).rejects.toThrow(InvalidTransitionError);
    await expect(cancelled.service.completeOrder(cancelledOrder.id)).rejects.toThrow(InvalidTransitionError);
    expect(cancelled.paymentGateway.calls.length + cancelled.completionGateway.calls.length).toBe(cancelledCallsBefore);

    // needs_attention
    const needsAttention = buildService({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'error', reason: 'gateway_timeout' },
    });
    const needsAttentionOrder = await needsAttention.service.createOrder();
    await needsAttention.service.authorizePayment(needsAttentionOrder.id);
    await expect(needsAttention.service.completeOrder(needsAttentionOrder.id)).rejects.toThrow(PartialFailureError);
    const needsAttentionCallsBefore =
      needsAttention.paymentGateway.calls.length + needsAttention.completionGateway.calls.length;
    await expect(needsAttention.service.authorizePayment(needsAttentionOrder.id)).rejects.toThrow(
      InvalidTransitionError
    );
    await expect(needsAttention.service.completeOrder(needsAttentionOrder.id)).rejects.toThrow(
      InvalidTransitionError
    );
    expect(needsAttention.paymentGateway.calls.length + needsAttention.completionGateway.calls.length).toBe(
      needsAttentionCallsBefore
    );
  });

  it('never calls void when the payment was declined (not just that void array is empty at test end)', async () => {
    const { service, paymentGateway } = buildService({ authorize: { outcome: 'declined', reason: 'card_declined' } });
    const created = await service.createOrder();

    await service.authorizePayment(created.id);

    expect(paymentGateway.calls.filter((c) => c.method === 'void')).toHaveLength(0);
  });
});

