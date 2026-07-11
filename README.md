# CryptoLab AI

CryptoLab AI is a small, auditable crypto-market experiment built around a $20 test account.

## First-month objective

The first release does **not** place real trades. It produces paper-trading recommendations, records every decision, and compares the strategy against simply holding Bitcoin.

## Safety rules

- No leverage, futures, margin, or borrowing.
- No automatic trading in the MVP.
- No API secrets committed to GitHub.
- Every recommendation must include a reason and confidence score.
- The system must be allowed to recommend **do nothing**.
- Performance must include fees and be compared with a Bitcoin buy-and-hold benchmark.
- Real trading is a later, opt-in phase only after sustained paper-trading results.

## MVP

- Cloudflare Worker written in TypeScript.
- Health/status endpoint.
- Paper portfolio starting at $20.
- BTC benchmark starting at $20.
- Recommendation and decision-journal data models.
- Later: market data, indicators, news analysis, D1 storage, and a mobile-friendly dashboard.

## Local development

```bash
npm install
npm run dev
```

## Deployment

```bash
npm run deploy
```

## Environment variables

Copy `.dev.vars.example` to `.dev.vars` for local-only secrets. Never commit `.dev.vars` or exchange API keys.

## Status

**Version 0.1 scaffold:** paper trading only. No exchange connection and no ability to place orders.
