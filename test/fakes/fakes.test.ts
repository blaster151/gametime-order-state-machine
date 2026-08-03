import { describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../../src/fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from '../../src/fakes/fake-order-completion-gateway';

describe('FakePaymentGateway', () => {
  it('returns the configured approval and records the call', async () => {
    const gateway = new FakePaymentGateway({ outcome: 'approved', authorizationId: 'auth-1' });

    const result = await gateway.authorize('order-1');

    expect(result).toEqual({ outcome: 'approved', authorizationId: 'auth-1' });
    expect(gateway.calls).toEqual([{ method: 'authorize', orderId: 'order-1' }]);
  });

  it('returns the configured decline without touching void', async () => {
    const gateway = new FakePaymentGateway({ outcome: 'declined', reason: 'card_declined' });

    const result = await gateway.authorize('order-1');

    expect(result).toEqual({ outcome: 'declined', reason: 'card_declined' });
    expect(gateway.calls.some((c) => c.method === 'void')).toBe(false);
  });

  it('records void calls with the authorization id and returns the configured outcome', async () => {
    const gateway = new FakePaymentGateway(undefined, { outcome: 'error', reason: 'gateway_timeout' });

    const result = await gateway.void('order-1', 'auth-1');

    expect(result).toEqual({ outcome: 'error', reason: 'gateway_timeout' });
    expect(gateway.calls).toEqual([{ method: 'void', orderId: 'order-1', authorizationId: 'auth-1' }]);
  });

  it('never behaves randomly across repeated calls', async () => {
    const gateway = new FakePaymentGateway({ outcome: 'declined', reason: 'card_declined' });

    const results = await Promise.all([gateway.authorize('order-1'), gateway.authorize('order-1')]);

    expect(results).toEqual([
      { outcome: 'declined', reason: 'card_declined' },
      { outcome: 'declined', reason: 'card_declined' },
    ]);
  });
});

describe('FakeOrderCompletionGateway', () => {
  it('returns the configured failure and records the call', async () => {
    const completionGateway = new FakeOrderCompletionGateway({ outcome: 'failed', reason: 'fulfillment_error' });

    const result = await completionGateway.complete('order-1');

    expect(result).toEqual({ outcome: 'failed', reason: 'fulfillment_error' });
    expect(completionGateway.calls).toEqual([{ method: 'complete', orderId: 'order-1' }]);
  });
});

describe('shared call log across fakes', () => {
  it('records cross-fake call order for a completion-then-void sequence', async () => {
    const sharedLog: string[] = [];
    const completionGateway = new FakeOrderCompletionGateway({ outcome: 'failed', reason: 'fulfillment_error' }, sharedLog);
    const gateway = new FakePaymentGateway(undefined, { outcome: 'voided' }, sharedLog);

    await completionGateway.complete('order-1');
    await gateway.void('order-1', 'auth-1');

    expect(sharedLog).toEqual(['completionGateway.complete', 'payment.void']);
  });
});
