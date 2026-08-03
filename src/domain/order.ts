import { Clock, SystemClock } from './clock';
import { InvalidTransitionError } from './errors';

/**
 * The six states an order can occupy. These are the entire vocabulary of the
 * domain — keep this list, and the ALLOWED_TRANSITIONS table below it, as the
 * single source of truth for what the order state machine can do.
 */
export type OrderState =
  | 'initialized'
  | 'payment_authorized'
  | 'complete'
  | 'rejected'
  | 'cancelled'
  | 'needs_attention';

const TERMINAL_STATES: ReadonlySet<OrderState> = new Set([
  'complete',
  'rejected',
  'cancelled',
  'needs_attention',
]);

/** Legal `from -> to` transitions. Anything not listed here is rejected. */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  initialized: ['payment_authorized', 'rejected'],
  payment_authorized: ['complete', 'cancelled', 'needs_attention'],
  complete: [],
  rejected: [],
  cancelled: [],
  needs_attention: [],
};

/** Machine-readable reason codes, one per way an order can move between states. */
export type TransitionReasonCode =
  | 'order_created'
  | 'payment_authorized'
  | 'payment_declined'
  | 'completion_succeeded'
  | 'completion_failed_void_succeeded'
  | 'completion_failed_void_failed';

export interface TransitionReason {
  readonly code: TransitionReasonCode;
  readonly message?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface HistoryEntry {
  readonly fromState: OrderState | null;
  readonly toState: OrderState;
  readonly at: Date;
  readonly reason: TransitionReason;
}

/**
 * Aggregate enforcing the order state machine. `state` and `history` can only
 * ever change together, through the private `transitionTo` method, so they can
 * never disagree with each other.
 */
export class Order {
  readonly id: string;
  private readonly clock: Clock;
  private state: OrderState;
  private readonly history: HistoryEntry[];
  private authorizationId: string | null = null;

  private constructor(id: string, clock: Clock) {
    this.id = id;
    this.clock = clock;
    this.state = 'initialized';
    this.history = [
      {
        fromState: null,
        toState: 'initialized',
        at: clock.now(),
        reason: { code: 'order_created' },
      },
    ];
  }

  static create(id: string, clock: Clock = new SystemClock()): Order {
    return new Order(id, clock);
  }

  getState(): OrderState {
    return this.state;
  }

  getAuthorizationId(): string | null {
    return this.authorizationId;
  }

  /**
   * Returns a defensive copy so callers cannot mutate the internal audit
   * trail. A deep clone is required, not just a shallow spread: each entry's
   * `at` (a `Date`), `reason`, and `reason.metadata` are nested mutable
   * values that a shallow copy would still share with the original.
   */
  getHistory(): HistoryEntry[] {
    return structuredClone(this.history);
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /**
   * Throws InvalidTransitionError if `next` is not legal from the current
   * state, without changing anything. Lets callers (e.g. OrderService) check
   * legality up front so they never call an external dependency on behalf of
   * an invalid transition.
   */
  assertCanTransitionTo(next: OrderState): void {
    const allowedNextStates = ALLOWED_TRANSITIONS[this.state];
    if (!allowedNextStates.includes(next)) {
      throw new InvalidTransitionError(this.id, this.state, next);
    }
  }

  private transitionTo(next: OrderState, reason: TransitionReason): void {
    this.assertCanTransitionTo(next);

    const from = this.state;
    this.state = next;
    this.history.push({ fromState: from, toState: next, at: this.clock.now(), reason });
  }

  /** initialized -> payment_authorized. Stores the authorization id for a later void, if ever needed. */
  markPaymentAuthorized(authorizationId: string): void {
    this.transitionTo('payment_authorized', { code: 'payment_authorized', metadata: { authorizationId } });
    this.authorizationId = authorizationId;
  }

  /** initialized -> rejected. No cleanup required for a payment decline. */
  rejectPayment(message: string, metadata?: Record<string, unknown>): void {
    this.transitionTo('rejected', { code: 'payment_declined', message, metadata });
  }

  /** payment_authorized -> complete */
  markComplete(metadata?: Record<string, unknown>): void {
    this.transitionTo('complete', { code: 'completion_succeeded', metadata });
  }

  /** payment_authorized -> cancelled, only once the void has actually succeeded. */
  markCancelledAfterVoid(completionFailureMessage: string, metadata?: Record<string, unknown>): void {
    this.transitionTo('cancelled', {
      code: 'completion_failed_void_succeeded',
      message: completionFailureMessage,
      metadata,
    });
  }

  /**
   * payment_authorized -> needs_attention. Preserves both the original
   * completion failure and the void failure so nothing is lost.
   */
  markNeedsAttention(
    completionFailureMessage: string,
    voidFailureMessage: string,
    metadata?: Record<string, unknown>
  ): void {
    this.transitionTo('needs_attention', {
      code: 'completion_failed_void_failed',
      message: `${completionFailureMessage}; void also failed: ${voidFailureMessage}`,
      metadata: { ...metadata, completionFailureMessage, voidFailureMessage },
    });
  }
}
