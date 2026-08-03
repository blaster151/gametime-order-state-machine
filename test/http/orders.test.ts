import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/http/server';
import { OrderService } from '../../src/app/order-service';
import { InMemoryOrderRepository } from '../../src/app/order-repository';
import { FakePaymentGateway } from '../../src/fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from '../../src/fakes/fake-order-completion-gateway';
import { SequentialClock } from '../support/sequential-clock';

function buildTestServer(
  options: {
    authorize?: ConstructorParameters<typeof FakePaymentGateway>[0];
    voidBehavior?: ConstructorParameters<typeof FakePaymentGateway>[1];
    completion?: ConstructorParameters<typeof FakeOrderCompletionGateway>[0];
  } = {}
) {
  const orderService = new OrderService(
    new InMemoryOrderRepository(),
    new FakePaymentGateway(options.authorize, options.voidBehavior),
    new FakeOrderCompletionGateway(options.completion),
    new SequentialClock()
  );
  return buildServer(orderService);
}

describe('HTTP API — route wiring and error mapping', () => {
  it('walks the happy path through create, authorize, and complete', async () => {
    const app = buildTestServer();

    const created = await app.inject({ method: 'POST', url: '/orders' });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(created.json().state).toBe('initialized');

    const authorized = await app.inject({ method: 'POST', url: `/orders/${id}/authorize-payment` });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().state).toBe('payment_authorized');

    const completed = await app.inject({ method: 'POST', url: `/orders/${id}/complete` });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().state).toBe('complete');

    const fetched = await app.inject({ method: 'GET', url: `/orders/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().history).toHaveLength(3);
  });

  it('maps an unknown order id to 404', async () => {
    const app = buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/orders/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('ORDER_NOT_FOUND');
  });

  it('maps an invalid transition to 409', async () => {
    const app = buildTestServer();
    const created = await app.inject({ method: 'POST', url: '/orders' });
    const { id } = created.json();

    const response = await app.inject({ method: 'POST', url: `/orders/${id}/complete` });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_TRANSITION');
  });

  it('maps a malformed order id to 400', async () => {
    const app = buildTestServer();

    const response = await app.inject({ method: 'GET', url: `/orders/${encodeURIComponent('bad id!')}` });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_REQUEST');
  });

  it('maps a completion failure whose void also fails to a non-success response with needs_attention detail', async () => {
    const app = buildTestServer({
      completion: { outcome: 'failed', reason: 'fulfillment_error' },
      voidBehavior: { outcome: 'error', reason: 'gateway_timeout' },
    });
    const created = await app.inject({ method: 'POST', url: '/orders' });
    const { id } = created.json();
    await app.inject({ method: 'POST', url: `/orders/${id}/authorize-payment` });

    const response = await app.inject({ method: 'POST', url: `/orders/${id}/complete` });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body).toMatchObject({
      code: 'ORDER_NEEDS_ATTENTION',
      orderId: id,
      state: 'needs_attention',
      completionFailureReason: 'fulfillment_error',
      voidFailureReason: 'gateway_timeout',
    });

    const fetched = await app.inject({ method: 'GET', url: `/orders/${id}` });
    expect(fetched.json().state).toBe('needs_attention');
  });
});
