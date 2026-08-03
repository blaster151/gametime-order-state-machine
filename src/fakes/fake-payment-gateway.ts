import { AuthorizeResult, PaymentGateway, VoidResult } from '../gateways/payment-gateway';

export type FakeAuthorizeBehavior =
  | { outcome: 'approved'; authorizationId?: string }
  | { outcome: 'declined'; reason?: string }
  | { outcome: 'error'; reason?: string };

export type FakeVoidBehavior = { outcome: 'voided' } | { outcome: 'error'; reason?: string };

export interface FakePaymentGatewayCall {
  readonly method: 'authorize' | 'void';
  readonly orderId: string;
  readonly authorizationId?: string;
}

/**
 * Deterministic PaymentGateway test double. Behavior is fixed at construction
 * (no randomness) and every call is recorded â€” including an optional shared
 * log array â€” so tests can assert call counts, arguments, and cross-fake
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
    }
  }

  async void(orderId: string, authorizationId: string): Promise<VoidResult> {
    this.calls.push({ method: 'void', orderId, authorizationId });
    this.sharedCallLog.push('payment.void');

    if (this.voidBehavior.outcome === 'voided') {
      return { outcome: 'voided' };
    }
    return { outcome: 'error', reason: this.voidBehavior.reason ?? 'void_failed' };
  }
}