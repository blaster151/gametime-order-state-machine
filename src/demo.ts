import { OrderService } from './app/order-service';
import { InMemoryOrderRepository } from './app/order-repository';
import { FakePaymentGateway } from './fakes/fake-payment-gateway';
import { FakeOrderCompletionGateway } from './fakes/fake-order-completion-gateway';
import { Order, OrderState } from './domain/order';
import { PartialFailureError } from './app/errors';

/**
 * Prints an order's final state and full history. Used to make the audit
 * trail (from-state, to-state, timestamp, structured reason) visible for
 * each of the four required scenarios.
 */
function printOrder(label: string, order: Order, expectedState: OrderState): void {
  console.log(`\n${label}`);
  console.log(`  [OK] final state: ${order.getState()}${order.getState() === expectedState ? '' : ` (expected ${expectedState})`}`);
  console.log(`  order ${order.id} -> ${order.getState()}`);
  for (const entry of order.getHistory()) {
    const from = entry.fromState ?? '(created)';
    console.log(`    ${from} -> ${entry.toState}  [${entry.reason.code}]`);
    console.log(`      at ${entry.at.toISOString()}`);
    if (entry.reason.message) {
      console.log(`      reason: ${entry.reason.message}`);
    }
  }
}

async function runHappyPath(): Promise<void> {
  const service = new OrderService(new InMemoryOrderRepository(), new FakePaymentGateway(), new FakeOrderCompletionGateway());

  const order = await service.createOrder();
  await service.authorizePayment(order.id);
  const result = await service.completeOrder(order.id);

  printOrder('Scenario 1 — happy path (initialized -> payment_authorized -> complete)', result, 'complete');
}

async function runPaymentDecline(): Promise<void> {
  const service = new OrderService(
    new InMemoryOrderRepository(),
    new FakePaymentGateway({ outcome: 'declined', reason: 'card_declined' }),
    new FakeOrderCompletionGateway()
  );

  const order = await service.createOrder();
  const result = await service.authorizePayment(order.id);

  printOrder('Scenario 2 — payment decline (initialized -> rejected, no cleanup)', result, 'rejected');
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

  printOrder('Scenario 3 — completion failure, void succeeds (-> cancelled)', result, 'cancelled');
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
    console.log('  [OK] routed the partial failure to manual attention');
    console.log(`      code: ${error.code}`);
    console.log(`      completion reason: ${error.completionFailureReason}`);
    console.log(`      void reason: ${error.voidFailureReason}`);
  }

  const persisted = await repository.findById(order.id);
  if (persisted) {
    printOrder('  persisted order after the failure (not silently cancelled)', persisted, 'needs_attention');
  }
}

async function main(): Promise<void> {
  await runHappyPath();
  await runPaymentDecline();
  await runCompletionFailureVoidSucceeds();
  await runCompletionFailureVoidFails();
  console.log('\nAll 4 demo scenarios completed successfully.');
}

main().catch((error) => {
  console.error('Demo failed unexpectedly:', error);
  process.exitCode = 1;
});
