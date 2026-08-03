import { Order } from '../../src/domain/order';
import { OrderRepository } from '../../src/app/order-repository';

export interface RecordedSave {
  readonly orderId: string;
  readonly stateAtSaveTime: ReturnType<Order['getState']>;
}

/**
 * Wraps a real OrderRepository and records every save() call, including the
 * order's state *at the moment save was invoked*. Exists because an
 * in-memory repository stores objects by reference: mutating an Order that
 * was already retrieved from the repository can make a missing/removed
 * `save()` call invisible to a naive "read it back" assertion. This makes
 * that regression (persist skipped, or persisted before the real state was
 * set) visible.
 */
export class RecordingOrderRepository implements OrderRepository {
  readonly saveCalls: RecordedSave[] = [];

  constructor(private readonly delegate: OrderRepository) {}

  async save(order: Order): Promise<void> {
    this.saveCalls.push({ orderId: order.id, stateAtSaveTime: order.getState() });
    await this.delegate.save(order);
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.delegate.findById(orderId);
  }
}
