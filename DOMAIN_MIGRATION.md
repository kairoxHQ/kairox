# Kairox Domain Migration

The public brand is `Kairox`.

Recommended public structure:

- `kairoxhq.com` for a future marketing homepage.
- `app.kairoxhq.com` for the paper-trading dashboard and application.

This keeps room for a product/marketing site at the apex domain while the existing Worker serves the app.

## Current Resources

- Production Worker: `kairox`
- Production D1 database: `kairox-production-db`
- D1 binding: `DB`
- Public app URL: `https://app.kairoxhq.com`
- Production Worker fallback URL: `https://kairox.kairoxtradingbot.workers.dev`
- Legacy rollback Worker URL: `https://cryptolab-ai.aprilfamilycookbook.workers.dev`
- Canonical GitHub repository: `kairoxHQ/kairox`
- Intended cron schedule after legacy scheduler shutdown: `*/30 * * * *`
- Required secret name for protected endpoints: `PAPER_RUN_SECRET`
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

Deploying this configuration attaches `app.kairoxhq.com` to the existing `kairox` Worker. Do not create another Worker.

The root domain `kairoxhq.com` is intentionally reserved for a future marketing site.

## Scheduler Cutover Gate

Only one production scheduler may be active at a time.

The legacy Worker `cryptolab-ai` in the April Family Cookbook Cloudflare account was observed still writing scheduled runs after the D1 restore. The dedicated Kairox account cannot disable that legacy scheduler with its current Wrangler credentials. Keep the new `kairox` cron trigger omitted from `wrangler.jsonc` until the legacy `cryptolab-ai` cron trigger is disabled in the old account.

After the old scheduler is disabled and verified, add:

```jsonc
"triggers": {
  "crons": ["*/30 * * * *"]
}
```

Then run a dry-run deploy, deploy `kairox`, and verify exactly one new scheduled run writes to `kairox-production-db`.

## Verification Commands

```powershell
cd "C:\Users\timbo\OneDrive\Documents\Trading Bot"
npx.cmd wrangler whoami
npx.cmd wrangler deploy --dry-run
npx.cmd wrangler deployments status --name kairox
```

Confirm you are in the dedicated Kairox Cloudflare account that owns `kairox` and the `KairoxHQ.com` zone.

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
- Do not enable the new production scheduler until the old production scheduler is disabled.
