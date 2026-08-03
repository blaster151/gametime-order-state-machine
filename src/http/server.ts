import Fastify, { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { OrderService } from '../app/order-service';
import { PartialFailureError, PaymentAuthorizationError } from '../app/errors';
import { InvalidTransitionError, OrderNotFoundError } from '../domain/errors';
import { orderIdParamsSchema } from './schemas';
import { serializeOrder } from './serialize-order';

/**
 * Command-oriented endpoints only — there is deliberately no generic
 * "set state" endpoint. Each route maps to exactly one legal command from
 * the assessment: create, authorize payment, complete, and read.
 */
export function buildServer(orderService: OrderService): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/orders', async (_request, reply) => {
    const order = await orderService.createOrder();
    reply.code(201);
    return serializeOrder(order);
  });

  app.post('/orders/:id/authorize-payment', async (request) => {
    const { id } = orderIdParamsSchema.parse(request.params);
    const order = await orderService.authorizePayment(id);
    return serializeOrder(order);
  });

  app.post('/orders/:id/complete', async (request) => {
    const { id } = orderIdParamsSchema.parse(request.params);
    const order = await orderService.completeOrder(id);
    return serializeOrder(order);
  });

  app.get('/orders/:id', async (request) => {
    const { id } = orderIdParamsSchema.parse(request.params);
    const order = await orderService.getOrder(id);
    return serializeOrder(order);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'Request validation failed',
        issues: error.issues,
      });
      return;
    }

    if (error instanceof OrderNotFoundError) {
      reply.code(404).send({ code: 'ORDER_NOT_FOUND', orderId: error.orderId, message: error.message });
      return;
    }

    if (error instanceof InvalidTransitionError) {
      reply.code(409).send({
        code: 'INVALID_TRANSITION',
        orderId: error.orderId,
        fromState: error.fromState,
        attemptedState: error.attemptedState,
        message: error.message,
      });
      return;
    }

    if (error instanceof PartialFailureError) {
      // Deliberately not 2xx: automation could not cleanly resolve the
      // order, so callers must not mistake this for success.
      reply.code(502).send({
        code: error.code,
        orderId: error.orderId,
        state: 'needs_attention',
        completionFailureReason: error.completionFailureReason,
        voidFailureReason: error.voidFailureReason,
        message: error.message,
      });
      return;
    }

    if (error instanceof PaymentAuthorizationError) {
      reply.code(502).send({
        code: 'PAYMENT_GATEWAY_ERROR',
        orderId: error.orderId,
        reason: error.reason,
        message: error.message,
      });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
  });

  return app;
}
