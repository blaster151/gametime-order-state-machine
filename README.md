# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## What Was Built

A small TypeScript service modeling the checkout order state machine, with
command-oriented HTTP endpoints and deterministic fakes for payment and
completion dependencies.

## How To Run

```bash
npm install
npm test
npm run build
npm run demo
npm run dev
```

`npm run demo` prints all four required scenarios end to end with final state
and history:

- Happy path
- Payment decline
- Completion failure with successful void
- Completion failure with failed void

## Direction

The architecture is intentionally small: domain state machine, application
service, dependency ports, fakes, and HTTP adapters. The final documentation
pass will add the fuller explanation of tradeoffs, API errors, production
concerns, and AI usage.