# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md) so the implementation can be
reviewed against the original problem.

## Design Direction

- Model the checkout lifecycle as an explicit state machine instead of letting
  callers assign arbitrary states.
- Keep state and history changes together in a small domain object.
- Put payment and completion side effects behind gateway interfaces so failure modes
  are deterministic in tests.
- Use an application service for orchestration: authorize payment, complete
  the order, and compensate with a void when completion fails.
- Start with in-memory persistence and a small command-oriented HTTP API; avoid
  database, queue, and framework work that would distract from the state
  machine.

## Expected Scenarios

- Happy path: `initialized -> payment_authorized -> complete`
- Payment decline: `initialized -> rejected`
- Completion failure with successful void: `payment_authorized -> cancelled`
- Completion failure with failed void: `payment_authorized -> needs_attention`