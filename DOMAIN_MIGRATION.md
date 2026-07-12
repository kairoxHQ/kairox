# Kairox Domain Migration

The public brand is `Kairox`.

Recommended public structure:

- `kairoxhq.com` for a future marketing homepage.
- `app.kairoxhq.com` for the paper-trading dashboard and application.

This keeps room for a product/marketing site at the apex domain while the existing Worker continues serving the app.

## Current Resources To Preserve

- Worker: `cryptolab-ai`
- D1 database: `cryptolab-ai-db`
- D1 binding: `DB`
- Current Worker URL: `https://cryptolab-ai.aprilfamilycookbook.workers.dev`
- Canonical GitHub repository: `kairoxHQ/kairox`
- Cron schedule: `*/30 * * * *`
- Existing secrets, including `PAPER_RUN_SECRET`
- Existing paper-trading history in D1

Do not recreate the Worker or D1 database during domain migration.

## Manual Cloudflare Steps

Run these outside Codex in Windows PowerShell after `KairoxHQ.com` is available in the intended Cloudflare account.

```powershell
cd "C:\Users\timbo\OneDrive\Documents\Trading Bot"
npx.cmd wrangler whoami
```

Confirm you are in the Cloudflare account that owns `cryptolab-ai` and the `KairoxHQ.com` zone.

Verify the existing Worker still deploys:

```powershell
npx.cmd wrangler deploy --dry-run
```

Attach a custom domain for the app:

```powershell
npx.cmd wrangler triggers deploy
```

Then in the Cloudflare dashboard:

1. Open Workers & Pages.
2. Select Worker `cryptolab-ai`.
3. Open Settings.
4. Open Triggers.
5. Add a Custom Domain.
6. Enter `app.kairoxhq.com`.
7. Confirm the route maps to the existing `cryptolab-ai` Worker.
8. Verify TLS is active.

Optionally add `www.kairoxhq.com` later for a marketing site or redirect. Do not point the apex `kairoxhq.com` at the Worker unless you decide the app should be the whole public site.

## Post-Migration Verification

```powershell
$workerUrl = "https://app.kairoxhq.com"
curl.exe "$workerUrl/health"
curl.exe "$workerUrl/status"
curl.exe "$workerUrl/dashboard"
curl.exe "$workerUrl/market"
curl.exe "$workerUrl/summaries"
```

Protected endpoints still require the existing secret header:

```powershell
$paperRunSecret = "paste-your-secret-here"
curl.exe -X POST "$workerUrl/paper/run" -H "x-cryptolab-paper-secret: $paperRunSecret"
```

## What Must Not Change

- Do not create a new D1 database.
- Do not reset migrations.
- Do not rotate secrets unless intentionally planned.
- Do not remove the workers.dev URL until the custom domain has been verified.
- Do not enable live trading.
