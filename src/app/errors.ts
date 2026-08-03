/**
 * Application-level errors thrown by OrderService. Distinct from the domain's
 * InvalidTransitionError/OrderNotFoundError: these represent orchestration
 * outcomes rather than illegal state-machine usage.
 */

/** An unexpected (non-decline) failure while authorizing payment. The order stays `initialized`. */
export class PaymentAuthorizationError extends Error {
  readonly orderId: string;
  readonly reason: string;

  constructor(orderId: string, reason: string) {
    super(`Payment authorization for order ${orderId} failed unexpectedly: ${reason}`);
    this.name = 'PaymentAuthorizationError';
    this.orderId = orderId;
    this.reason = reason;
  }
}

/**
 * Thrown after a completion failure whose void also failed. By the time this
 * is thrown, the order has already been persisted in `needs_attention` with
 * both failure reasons recorded in its history — this error exists purely to
 * make sure the failure cannot be silently ignored by a caller.
 */
export class PartialFailureError extends Error {
  readonly code = 'ORDER_NEEDS_ATTENTION' as const;
  readonly orderId: string;
  readonly completionFailureReason: string;
  readonly voidFailureReason: string;

  constructor(orderId: string, completionFailureReason: string, voidFailureReason: string) {
    super(
      `Order ${orderId} needs manual attention: completion failed (${completionFailureReason}) and the payment void also failed (${voidFailureReason})`
    );
    this.name = 'PartialFailureError';
    this.orderId = orderId;
    this.completionFailureReason = completionFailureReason;
    this.voidFailureReason = voidFailureReason;
  }
}
