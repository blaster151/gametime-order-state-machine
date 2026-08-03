import { Order } from '../domain/order';

export interface OrderResponse {
  id: string;
  state: ReturnType<Order['getState']>;
  history: Array<{
    fromState: ReturnType<Order['getState']> | null;
    toState: ReturnType<Order['getState']>;
    at: string;
    reason: ReturnType<Order['getHistory']>[number]['reason'];
  }>;
}

/** Maps the domain Order to a plain, JSON-serializable shape for the API. */
export function serializeOrder(order: Order): OrderResponse {
  return {
    id: order.id,
    state: order.getState(),
    history: order.getHistory().map((entry) => ({
      fromState: entry.fromState,
      toState: entry.toState,
      at: entry.at.toISOString(),
      reason: entry.reason,
    })),
  };
}
