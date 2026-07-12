# Agent Instructions

Kairox is paper-first. Keep all implementation choices aligned with safe, broker-agnostic experimentation.

## Guardrails

- Do not add live brokerage credentials.
- Do not enable live order execution.
- Do not add leverage, margin, options execution, or futures execution.
- Do not call paid AI APIs.
- Do not commit secrets, `.dev.vars`, or account tokens.
- Do not reuse April Family Cookbook or BingeKeeper Cloudflare resources.
- Use only the dedicated `cryptolab-ai-db` Cloudflare D1 database bound as `DB`.

## Engineering Rules

- Use TypeScript and Cloudflare Workers APIs.
- Keep broker integrations behind `BrokerAdapter`.
- Keep market data integrations behind `MarketDataProvider`.
- Run risk checks before any execution path.
- Log every recommendation, trade, and decision.
- Every decision must include an explanation, confidence score, risk score, timestamp, and market price data.
- `DO_NOTHING` is a valid and often preferred recommendation.

## Current Scope

This milestone is a foundation only. It supports one local user named Tim, a `$20` paper portfolio, a Bitcoin buy-and-hold benchmark, and a cash benchmark.
