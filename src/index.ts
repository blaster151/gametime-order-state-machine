import { buildServer } from './http/server';
import { OrderService } from './app/order-service';
import { InMemoryOrderRepository } from './app/order-repository';
import { FakePaymentGateway } from './fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from './fakes/fake-order-completion-gateway';

/**
 * No real payment/fulfillment provider exists for this prototype, so the API
 * is wired to fakes configured to always succeed. Failure scenarios are
 * demonstrated by the separate demo runner (`npm run demo`), not through
 * hidden toggles on this HTTP surface.
 */
export function createDefaultOrderService(): OrderService {
  return new OrderService(new InMemoryOrderRepository(), new FakePaymentGateway(), new FakeOrderCompletionGateway());
}

if (require.main === module) {
  const orderService = createDefaultOrderService();
  const app = buildServer(orderService);
  const port = Number(process.env.PORT) || 3000;

  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
