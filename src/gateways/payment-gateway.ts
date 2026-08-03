/**
 * Payment side effects, kept behind an interface so the domain/service never
 * depends on a real payment provider. `declined` (a business outcome — the
 * card was rejected) is modeled separately from `error` (an unexpected
 * technical failure, e.g. a timeout) since they must be handled differently:
 * a decline safely rejects the order, but a technical error means we don't
 * actually know whether money moved, so it must not be treated as a clean
 * decline.
 */
export type AuthorizeResult =
  | { outcome: 'approved'; authorizationId: string }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'error'; reason: string };

export type VoidResult = { outcome: 'voided' } | { outcome: 'error'; reason: string };

export interface PaymentGateway {
  authorize(orderId: string): Promise<AuthorizeResult>;
  void(orderId: string, authorizationId: string): Promise<VoidResult>;
}
