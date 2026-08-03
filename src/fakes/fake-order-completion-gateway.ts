import { CompletionResult, OrderCompletionGateway } from '../gateways/order-completion-gateway';

export type FakeCompletionBehavior = { outcome: 'completed' } | { outcome: 'failed'; reason?: string };

export interface FakeOrderCompletionGatewayCall {
  readonly method: 'complete';
  readonly orderId: string;
}

/** Deterministic OrderCompletionGateway test double â€” same shape as FakePaymentGateway. */
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
    return { outcome: 'failed', reason: this.behavior.reason ?? 'fulfillment_error' };
  }
}