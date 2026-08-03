# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## Design Direction

The core of the solution is a small domain model in `src/domain/order.ts`.
It owns the allowed transition table, the current order state, and the audit
history. That keeps the central invariant simple: an order can only move
through named domain methods, and every state change appends a timestamped
history entry at the same time.

Current domain states:

- `initialized`
- `payment_authorized`
- `complete`
- `rejected`
- `cancelled`
- `needs_attention`

Next up: add ports for payment and completion dependencies, then an
application service to coordinate failure recovery around the domain model.