# Kairox Domain Migration

The public brand is `Kairox`.

Recommended public structure:

- `kairoxhq.com` for a future marketing homepage.
- `app.kairoxhq.com` for the paper-trading dashboard and application.

This keeps room for a product/marketing site at the apex domain while the existing Worker serves the app.

## Current Resources To Preserve

- Worker: `cryptolab-ai`
- D1 database: `cryptolab-ai-db`
- D1 binding: `DB`
- Public app URL: `https://app.kairoxhq.com`
- Fallback Worker URL: `https://cryptolab-ai.aprilfamilycookbook.workers.dev`
- Canonical GitHub repository: `kairoxHQ/kairox`
- Cron schedule: `*/30 * * * *`
- Existing secrets, including `PAPER_RUN_SECRET`
- Existing paper-trading history in D1

Do not recreate the Worker or D1 database during domain migration.

## Worker Route

The custom domain is source-controlled in `wrangler.jsonc`:

```jsonc
"routes": [
  {
    "pattern": "app.kairoxhq.com",
    "custom_domain": true
  }
]
```

Deploying this configuration attaches `app.kairoxhq.com` to the existing `cryptolab-ai` Worker. Do not create another Worker.

## Verification Commands

```powershell
cd "C:\Users\timbo\OneDrive\Documents\Trading Bot"
npx.cmd wrangler whoami
npx.cmd wrangler deploy --dry-run
npx.cmd wrangler deployments status --name cryptolab-ai
```

Confirm you are in the Cloudflare account that owns `cryptolab-ai` and the `KairoxHQ.com` zone.

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
- Do not remove the workers.dev URL.
- Do not enable live trading.
