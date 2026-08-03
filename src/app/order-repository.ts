import { Order } from '../domain/order';

export interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(orderId: string): Promise<Order | null>;
}

/** In-memory only, as agreed for this prototype — no database. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }
}
