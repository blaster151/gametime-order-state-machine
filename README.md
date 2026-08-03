# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## What Exists

- `src/domain/order.ts` models states, transitions, and history.
- `src/gateways/*` defines payment and completion interfaces.
- `src/app/order-service.ts` coordinates order commands and compensation.

## Recovery Rules

- A payment decline moves the order to `rejected`.
- A successful authorization stores the authorization id for a possible later
  void.
- A completion success moves the order to `complete`.
- A completion failure attempts a payment void before cancellation.
- If the void fails too, the order moves to `needs_attention` and the service
  throws a partial-failure error.

Tests and the HTTP surface are still being built out, but the central
orchestration path is now in place.