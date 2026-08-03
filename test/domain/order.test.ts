import { describe, expect, it } from 'vitest';
import { Clock } from '../../src/domain/clock';
import { Order } from '../../src/domain/order';
import { InvalidTransitionError } from '../../src/domain/errors';
import { SequentialClock } from '../support/sequential-clock';

class ThrowsAfterFirstTickClock implements Clock {
  private calls = 0;

  now(): Date {
    if (this.calls++ === 0) {
      return new Date(0);
    }
    throw new Error('clock failed');
  }
}

describe('Order domain model', () => {
  it('records an initial history entry on creation', () => {
    const order = Order.create('order-1', new SequentialClock(1000));

    expect(order.getState()).toBe('initialized');
    expect(order.getHistory()).toEqual([
      { fromState: null, toState: 'initialized', at: new Date(1000), reason: { code: 'order_created' } },
    ]);
  });

  it('moves through the happy path and appends one history entry per transition', () => {
    const order = Order.create('order-1', new SequentialClock(0, 10));

    order.markPaymentAuthorized('auth-1');
    order.markComplete();

    expect(order.getState()).toBe('complete');
    expect(order.getAuthorizationId()).toBe('auth-1');
    const history = order.getHistory();
    expect(history.map((e) => e.toState)).toEqual(['initialized', 'payment_authorized', 'complete']);
    expect(history.map((e) => e.fromState)).toEqual([null, 'initialized', 'payment_authorized']);
    expect(history.map((e) => e.at.getTime())).toEqual([0, 10, 20]);
    expect(order.isTerminal()).toBe(true);
  });

  it('rejects a payment decline with no further cleanup', () => {
    const order = Order.create('order-1', new SequentialClock());

    order.rejectPayment('card_declined');

    expect(order.getState()).toBe('rejected');
    const last = order.getHistory().at(-1)!;
    expect(last.toState).toBe('rejected');
    expect(last.reason).toEqual({ code: 'payment_declined', message: 'card_declined', metadata: undefined });
    expect(order.isTerminal()).toBe(true);
  });

  it('cancels cleanly once a completion failure is followed by a successful void', () => {
    const order = Order.create('order-1', new SequentialClock());
    order.markPaymentAuthorized('auth-1');

    order.markCancelledAfterVoid('fulfillment_error');

    expect(order.getState()).toBe('cancelled');
    expect(order.getHistory().at(-1)?.reason.code).toBe('completion_failed_void_succeeded');
  });

  it('surfaces needs_attention with both failure reasons preserved when the void also fails', () => {
    const order = Order.create('order-1', new SequentialClock());
    order.markPaymentAuthorized('auth-1');

    order.markNeedsAttention('fulfillment_error', 'gateway_timeout');

    expect(order.getState()).toBe('needs_attention');
    const last = order.getHistory().at(-1)!;
    expect(last.reason.code).toBe('completion_failed_void_failed');
    expect(last.reason.metadata).toMatchObject({
      completionFailureMessage: 'fulfillment_error',
      voidFailureMessage: 'gateway_timeout',
    });
  });

  it('rejects an invalid transition without changing state or history', () => {
    const order = Order.create('order-1', new SequentialClock());
    const historyBefore = order.getHistory();

    expect(() => order.markComplete()).toThrow(InvalidTransitionError);

    expect(order.getState()).toBe('initialized');
    expect(order.getHistory()).toEqual(historyBefore);
  });

  it('keeps state and history unchanged if timestamping a transition fails', () => {
    const order = Order.create('order-1', new ThrowsAfterFirstTickClock());
    const historyBefore = order.getHistory();

    expect(() => order.markPaymentAuthorized('auth-1')).toThrow('clock failed');

    expect(order.getState()).toBe('initialized');
    expect(order.getAuthorizationId()).toBeNull();
    expect(order.getHistory()).toEqual(historyBefore);
  });

  it('treats complete, rejected, cancelled, and needs_attention as terminal', () => {
    const complete = Order.create('a', new SequentialClock());
    complete.markPaymentAuthorized('auth-a');
    complete.markComplete();
    expect(() => complete.markPaymentAuthorized('auth-a-2')).toThrow(InvalidTransitionError);

    const rejected = Order.create('b', new SequentialClock());
    rejected.rejectPayment('declined');
    expect(() => rejected.markPaymentAuthorized('auth-b')).toThrow(InvalidTransitionError);

    const cancelled = Order.create('c', new SequentialClock());
    cancelled.markPaymentAuthorized('auth-c');
    cancelled.markCancelledAfterVoid('failure');
    expect(() => cancelled.markComplete()).toThrow(InvalidTransitionError);

    const needsAttention = Order.create('d', new SequentialClock());
    needsAttention.markPaymentAuthorized('auth-d');
    needsAttention.markNeedsAttention('failure', 'void_failure');
    expect(() => needsAttention.markComplete()).toThrow(InvalidTransitionError);
  });

  it('never lets external mutation of a returned history array affect internal state', () => {
    const order = Order.create('order-1', new SequentialClock());

    const history = order.getHistory();
    history.push({ fromState: 'initialized', toState: 'complete', at: new Date(), reason: { code: 'completion_succeeded' } });
    history[0].toState = 'complete' as never;

    expect(order.getHistory()).toHaveLength(1);
    expect(order.getState()).toBe('initialized');
  });

  it('never lets external mutation of a returned entry\'s nested Date, reason, or metadata affect internal state', () => {
    const order = Order.create('order-1', new SequentialClock());
    order.markPaymentAuthorized('auth-1');
    order.markNeedsAttention('fulfillment_error', 'gateway_timeout');

    const history = order.getHistory();
    const entry = history.at(-1)!;
    const originalYear = entry.at.getFullYear();
    const originalCode = entry.reason.code;
    const originalMetadata = { ...entry.reason.metadata };

    entry.at.setFullYear(1995);
    (entry.reason as { code: string }).code = 'completion_succeeded';
    (entry.reason.metadata as Record<string, unknown>).completionFailureMessage = 'tampered';

    const freshEntry = order.getHistory().at(-1)!;
    expect(freshEntry.at.getFullYear()).toBe(originalYear);
    expect(freshEntry.reason.code).toBe(originalCode);
    expect(freshEntry.reason.metadata).toEqual(originalMetadata);
  });

  it('keeps current state and the last history entry in agreement after every legal transition', () => {
    const order = Order.create('order-1', new SequentialClock());
    order.markPaymentAuthorized('auth-1');
    expect(order.getState()).toBe(order.getHistory().at(-1)?.toState);

    order.markComplete();
    expect(order.getState()).toBe(order.getHistory().at(-1)?.toState);
  });
});
