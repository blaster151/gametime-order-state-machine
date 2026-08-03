# Gametime Order State Machine

This repo is for the Gametime checkout backend assessment. The full prompt is
preserved in [ASSESSMENT.md](./ASSESSMENT.md).

## What Was Built

A small TypeScript service for order state transitions, dependency-backed
orchestration, and a command-oriented HTTP API.

## API Commands

```bash
curl -s -X POST http://localhost:3000/orders
curl -s -X POST http://localhost:3000/orders/<id>/authorize-payment
curl -s -X POST http://localhost:3000/orders/<id>/complete
curl -s http://localhost:3000/orders/<id>
```

There is no generic "set state" endpoint. The API exposes domain commands
only, so business rules stay in the service and domain model.

## Run

```bash
npm install
npm test
npm run build
npm run dev
```

The remaining work is to add a deterministic scenario demo and expand the
README with tradeoffs, production omissions, and AI usage notes.