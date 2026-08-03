import { AuthorizeResult, PaymentGateway, VoidResult } from '../gateways/payment-gateway';

function toThrown(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : fallbackMessage);
}

export type FakeAuthorizeBehavior =
  | { outcome: 'approved'; authorizationId?: string }
  | { outcome: 'declined'; reason?: string }
  | { outcome: 'error'; reason?: string }
  | { outcome: 'throws'; error?: unknown };

export type FakeVoidBehavior =
  | { outcome: 'voided' }
  | { outcome: 'error'; reason?: string }
  | { outcome: 'throws'; error?: unknown };

export interface FakePaymentGatewayCall {
  readonly method: 'authorize' | 'void';
  readonly orderId: string;
  readonly authorizationId?: string;
}

/**
 * Deterministic PaymentGateway test double. Behavior is fixed at construction
 * (no randomness) and every call is recorded — including an optional shared
 * log array — so tests can assert call counts, arguments, and cross-fake
 * ordering (e.g. completionGateway.complete() before gateway.void()).
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly calls: FakePaymentGatewayCall[] = [];

  constructor(
    private readonly authorizeBehavior: FakeAuthorizeBehavior = { outcome: 'approved' },
    private readonly voidBehavior: FakeVoidBehavior = { outcome: 'voided' },
    private readonly sharedCallLog: string[] = []
  ) {}

  async authorize(orderId: string): Promise<AuthorizeResult> {
    this.calls.push({ method: 'authorize', orderId });
    this.sharedCallLog.push('payment.authorize');

    switch (this.authorizeBehavior.outcome) {
      case 'approved':
        return { outcome: 'approved', authorizationId: this.authorizeBehavior.authorizationId ?? `auth-${orderId}` };
      case 'declined':
        return { outcome: 'declined', reason: this.authorizeBehavior.reason ?? 'card_declined' };
      case 'error':
        return { outcome: 'error', reason: this.authorizeBehavior.reason ?? 'gateway_unreachable' };
      case 'throws':
        throw toThrown(this.authorizeBehavior.error, 'authorize rejected unexpectedly');
    }
  }

  async void(orderId: string, authorizationId: string): Promise<VoidResult> {
    this.calls.push({ method: 'void', orderId, authorizationId });
    this.sharedCallLog.push('payment.void');

    if (this.voidBehavior.outcome === 'voided') {
      return { outcome: 'voided' };
    }
    if (this.voidBehavior.outcome === 'throws') {
      throw toThrown(this.voidBehavior.error, 'void rejected unexpectedly');
    }
    return { outcome: 'error', reason: this.voidBehavior.reason ?? 'void_failed' };
  }
}
