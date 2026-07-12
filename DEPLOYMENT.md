# Deployment

Run these commands outside Codex in Windows PowerShell. Use `.cmd` commands to avoid PowerShell execution-policy issues with `.ps1` shims.

Do not use any April Family Cookbook, BingeKeeper, or unrelated Cloudflare resource. Kairox currently keeps these internal resource names:

- Worker/project: `cryptolab-ai`
- D1 database: `cryptolab-ai-db`
- D1 binding: `DB`
- Current D1 database ID: `09480454-a133-4f0d-b5fe-c45c59dc0ef8`
- Canonical GitHub repository: `kairoxHQ/kairox`

## 1. Open The Project

```powershell
cd "C:\Users\timbo\OneDrive\Documents\Trading Bot"
```

## 2. Check Wrangler Authentication

```powershell
npx.cmd wrangler whoami
```

If Wrangler is not authenticated, log in:

```powershell
npx.cmd wrangler login
```

Then verify again:

```powershell
npx.cmd wrangler whoami
```

## 3. List Existing D1 Databases

```powershell
npx.cmd wrangler d1 list
```

Look for a dedicated database named `cryptolab-ai-db`.

Do not use databases from `april-family-cookbook`, `Bingekeeper`, or any unrelated project.

## 4. Create The D1 Database If Needed

Only run this if `cryptolab-ai-db` does not already exist:

```powershell
npx.cmd wrangler d1 create cryptolab-ai-db
```

Copy the returned `database_id`.

## 5. Update Wrangler Configuration

If `wrangler.jsonc` still contains the placeholder database ID, replace every placeholder:

```text
00000000-0000-0000-0000-000000000000
```

with the actual `database_id` for `cryptolab-ai-db`.

The current configured ID is:

```text
09480454-a133-4f0d-b5fe-c45c59dc0ef8
```

Confirm the binding remains exactly:

```jsonc
"binding": "DB"
```

## 6. Apply The Remote Migration

```powershell
npx.cmd wrangler d1 migrations apply cryptolab-ai-db --remote
```

## 7. Deploy The Worker

Set the secret required for `POST /paper/run`. Do not commit the value.

```powershell
npx.cmd wrangler secret put PAPER_RUN_SECRET
```

Deploy the configured Worker:

```powershell
npx.cmd wrangler deploy
```

If you want to deploy the preview environment instead:

```powershell
npx.cmd wrangler deploy --env preview
```

Copy the deployed Worker URL printed by Wrangler.

## 8. Verify Deployed Endpoints

Set a local variable to the deployed Worker URL. Replace the value below with your actual URL:

```powershell
$workerUrl = "https://app.kairoxhq.com"
```

The fallback Worker URL should also remain available:

```powershell
$fallbackWorkerUrl = "https://cryptolab-ai.aprilfamilycookbook.workers.dev"
curl.exe "$fallbackWorkerUrl/health"
```

Verify `/health`:

```powershell
curl.exe "$workerUrl/health"
```

Verify `/status`:

```powershell
curl.exe "$workerUrl/status"
```

Verify `/portfolio`:

```powershell
curl.exe "$workerUrl/portfolio"
```

Verify `/recommendations`:

```powershell
curl.exe "$workerUrl/recommendations"
```

Verify `/journal`:

```powershell
curl.exe "$workerUrl/journal"
```

Verify `/benchmarks`:

```powershell
curl.exe "$workerUrl/benchmarks"
```

Verify `/market`:

```powershell
curl.exe "$workerUrl/market"
```

Verify `/trades`:

```powershell
curl.exe "$workerUrl/trades"
```

Verify `/performance`:

```powershell
curl.exe "$workerUrl/performance"
```

Verify `/dashboard`:

```powershell
curl.exe "$workerUrl/dashboard"
```

Verify `/scheduled-runs`:

```powershell
curl.exe "$workerUrl/scheduled-runs"
```

Verify `/summaries`:

```powershell
curl.exe "$workerUrl/summaries"
```

Verify `/settings`:

```powershell
curl.exe "$workerUrl/settings"
```

Verify protected `/paper/run` after setting `$paperRunSecret` locally:

```powershell
$paperRunSecret = "paste-your-secret-here"
curl.exe -X POST "$workerUrl/paper/run" -H "x-cryptolab-paper-secret: $paperRunSecret"
```

Pause scheduled paper execution:

```powershell
curl.exe -X POST "$workerUrl/settings/pause" -H "x-cryptolab-paper-secret: $paperRunSecret"
```

Resume scheduled paper execution:

```powershell
curl.exe -X POST "$workerUrl/settings/resume" -H "x-cryptolab-paper-secret: $paperRunSecret"
```

Expected safety checks:

- `/status` reports `paperTradingOnly: true`.
- `/status` reports `liveTradingEnabled: false`.
- `/recommendations` contains a logged `DO_NOTHING` recommendation unless later validated market data supports another logged action.
- `/journal` contains an explanation, confidence score, risk score, timestamp, and price data for decisions.
- `/paper/run` rejects missing or incorrect `x-cryptolab-paper-secret`.
- `/dashboard` does not expose `PAPER_RUN_SECRET`.
- `/settings` reports whether automation is active or paused.
