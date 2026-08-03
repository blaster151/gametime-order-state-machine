# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## Current Shape

The project is a TypeScript service with a layered structure:

- Domain state machine in `src/domain/order.ts`
- Application orchestration in `src/app/order-service.ts`
- Payment, completion, and repository
- Deterministic fakes for payment and completion behavior

## Test Coverage

The required assessment scenarios are covered:

- Happy path
- Payment decline
- Completion failure with successful void
- Completion failure with failed void and `needs_attention`

Additional tests cover invalid transitions and repository behavior. The next
step is to expose the same commands through a small HTTP API.