import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/http/server';
import { OrderService } from '../../src/app/order-service';
import { InMemoryOrderRepository } from '../../src/app/order-repository';
import { FakePaymentGateway } from '../../src/fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from '../../src/fakes/fake-order-completion-gateway';
import { SequentialClock } from '../support/sequential-clock';

interface SerializedHistoryEntry {
  readonly at: string;
  readonly reason: {
    readonly code: string;
  };
}

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
    const history = fetched.json().history as SerializedHistoryEntry[];
    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.reason.code)).toEqual([
      'order_created',
      'payment_authorized',
      'completion_succeeded',
    ]);
    expect(history.every((entry) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.at))).toBe(true);
  });

  it('maps an unexpected payment gateway error to 502', async () => {
    const app = buildTestServer({
      authorize: { outcome: 'error', reason: 'gateway_unreachable' },
    });
    const created = await app.inject({ method: 'POST', url: '/orders' });
    const { id } = created.json();

    const response = await app.inject({ method: 'POST', url: `/orders/${id}/authorize-payment` });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: 'PAYMENT_GATEWAY_ERROR',
      orderId: id,
      reason: 'gateway_unreachable',
    });
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
