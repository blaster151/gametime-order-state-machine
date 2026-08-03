import { OrderService } from './app/order-service';
import { InMemoryOrderRepository } from './app/order-repository';
import { FakePaymentGateway } from './fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from './fakes/fake-order-completion-gateway';
import { Order } from './domain/order';
import { PartialFailureError } from './app/errors';

/**
 * Prints an order's final state and full history. Used to make the audit
 * trail (from-state, to-state, timestamp, structured reason) visible for
 * each of the four required scenarios.
 */
function printOrder(label: string, order: Order): void {
  console.log(`\n${label}`);
  console.log(`  order ${order.id} -> ${order.getState()}`);
  for (const entry of order.getHistory()) {
    const from = entry.fromState ?? '(created)';
    const detail = entry.reason.message ? ` — ${entry.reason.message}` : '';
    console.log(`    ${entry.at.toISOString()}  ${from} -> ${entry.toState}  [${entry.reason.code}]${detail}`);
  }
}

async function runHappyPath(): Promise<void> {
  const service = new OrderService(new InMemoryOrderRepository(), new FakePaymentGateway(), new FakeOrderCompletionGateway());

  const order = await service.createOrder();
  await service.authorizePayment(order.id);
  const result = await service.completeOrder(order.id);

  printOrder('Scenario 1 — happy path (initialized -> payment_authorized -> complete)', result);
}

async function runPaymentDecline(): Promise<void> {
  const service = new OrderService(
    new InMemoryOrderRepository(),
    new FakePaymentGateway({ outcome: 'declined', reason: 'card_declined' }),
    new FakeOrderCompletionGateway()
  );

  const order = await service.createOrder();
  const result = await service.authorizePayment(order.id);

  printOrder('Scenario 2 — payment decline (initialized -> rejected, no cleanup)', result);
}

async function runCompletionFailureVoidSucceeds(): Promise<void> {
  const service = new OrderService(
    new InMemoryOrderRepository(),
    new FakePaymentGateway(undefined, { outcome: 'voided' }),
    new FakeOrderCompletionGateway({ outcome: 'failed', reason: 'fulfillment_error' })
  );

  const order = await service.createOrder();
  await service.authorizePayment(order.id);
  const result = await service.completeOrder(order.id);

  printOrder('Scenario 3 — completion failure, void succeeds (-> cancelled)', result);
}

async function runCompletionFailureVoidFails(): Promise<void> {
  const repository = new InMemoryOrderRepository();
  const service = new OrderService(
    repository,
    new FakePaymentGateway(undefined, { outcome: 'error', reason: 'gateway_timeout' }),
    new FakeOrderCompletionGateway({ outcome: 'failed', reason: 'fulfillment_error' })
  );

  const order = await service.createOrder();
  await service.authorizePayment(order.id);

  console.log('\nScenario 4 — completion failure, void also fails (-> needs_attention)');
  try {
    await service.completeOrder(order.id);
    throw new Error('expected completeOrder to throw PartialFailureError');
  } catch (error) {
    if (!(error instanceof PartialFailureError)) {
      throw error;
    }
    console.log(`  surfaced PartialFailureError: ${error.message}`);
  }

  const persisted = await repository.findById(order.id);
  if (persisted) {
    printOrder('  persisted order after the failure (not silently cancelled)', persisted);
  }
}

async function main(): Promise<void> {
  await runHappyPath();
  await runPaymentDecline();
  await runCompletionFailureVoidSucceeds();
  await runCompletionFailureVoidFails();
  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Demo failed unexpectedly:', error);
  process.exitCode = 1;
});
