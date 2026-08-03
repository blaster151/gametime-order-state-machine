# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## Design Direction

The state machine lives in `src/domain/order.ts`; external work lives behind
gateways in `src/gateways`. The payment gateway separates a business decline from a
technical error, because a declined card can reject the order cleanly while a
gateway error should not be treated as a clean decline.

The project now has:

- `Order`, with legal transitions and state history.
- `PaymentGateway`, for authorize and void.
- `OrderCompletionGateway`, for fulfillment/completion.
- `OrderRepository`, with an in-memory implementation for the prototype.
- Deterministic fakes for tests and demos.

The next layer will orchestrate these pieces so completion failure always
attempts the payment void before an order is marked cancelled.