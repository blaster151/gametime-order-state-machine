import { CompletionResult, OrderCompletionGateway } from '../gateways/order-completion-gateway';

function toThrown(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : fallbackMessage);
}

export type FakeCompletionBehavior =
  | { outcome: 'completed' }
  | { outcome: 'failed'; reason?: string }
  | { outcome: 'throws'; error?: unknown };

export interface FakeOrderCompletionGatewayCall {
  readonly method: 'complete';
  readonly orderId: string;
}

/** Deterministic OrderCompletionGateway test double — same shape as FakePaymentGateway. */
export class FakeOrderCompletionGateway implements OrderCompletionGateway {
  readonly calls: FakeOrderCompletionGatewayCall[] = [];

  constructor(
    private readonly behavior: FakeCompletionBehavior = { outcome: 'completed' },
    private readonly sharedCallLog: string[] = []
  ) {}

  async complete(orderId: string): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', orderId });
    this.sharedCallLog.push('completionGateway.complete');

    if (this.behavior.outcome === 'completed') {
      return { outcome: 'completed' };
    }
    if (this.behavior.outcome === 'throws') {
      throw toThrown(this.behavior.error, 'complete rejected unexpectedly');
    }
    return { outcome: 'failed', reason: this.behavior.reason ?? 'fulfillment_error' };
  }
}
