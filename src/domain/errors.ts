export class InvalidTransitionError extends Error {
  readonly orderId: string;
  readonly fromState: string;
  readonly attemptedState: string;

  constructor(orderId: string, fromState: string, attemptedState: string) {
    super(`Order ${orderId} cannot transition from "${fromState}" to "${attemptedState}"`);
    this.name = 'InvalidTransitionError';
    this.orderId = orderId;
    this.fromState = fromState;
    this.attemptedState = attemptedState;
  }
}

export class OrderNotFoundError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order "${orderId}" was not found`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
  }
}
