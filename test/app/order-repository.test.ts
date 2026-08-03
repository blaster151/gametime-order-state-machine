import { describe, expect, it } from 'vitest';
import { InMemoryOrderRepository } from '../../src/app/order-repository';
import { Order } from '../../src/domain/order';
import { SequentialClock } from '../support/sequential-clock';

describe('InMemoryOrderRepository', () => {
  it('returns a previously saved order by id', async () => {
    const repository = new InMemoryOrderRepository();
    const order = Order.create('order-1', new SequentialClock());

    await repository.save(order);
    const found = await repository.findById('order-1');

    expect(found).toBe(order);
  });

  it('returns null for an unknown order id', async () => {
    const repository = new InMemoryOrderRepository();

    const found = await repository.findById('missing');

    expect(found).toBeNull();
  });

  it('reflects the latest saved state when an order is saved again', async () => {
    const repository = new InMemoryOrderRepository();
    const order = Order.create('order-1', new SequentialClock());
    await repository.save(order);

    order.rejectPayment('card_declined');
    await repository.save(order);

    const found = await repository.findById('order-1');
    expect(found?.getState()).toBe('rejected');
  });
});
