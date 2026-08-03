/**
 * Fulfillment/completion side effect (e.g. issuing tickets), stubbed the same
 * way as the payment gateway so completion failures are testable without a
 * real dependency.
 */
export type CompletionResult = { outcome: 'completed' } | { outcome: 'failed'; reason: string };

export interface OrderCompletionGateway {
  complete(orderId: string): Promise<CompletionResult>;
}
