UPDATE portfolio_profiles
SET parameters_json = json_set(
    parameters_json,
    '$.iraCashManagement',
    json('{
      "enabled": true,
      "minOperationalCashReserveUsd": 100,
      "minOperationalCashReservePct": 0.05,
      "targetOperationalCashReservePct": 0.075,
      "maxUnallocatedCashPct": 0.125,
      "minimumDeploymentUsd": 25,
      "minimumRebalanceUsd": 25,
      "dailyDeploymentLimitPctOfExcess": 0.25,
      "dailyDeploymentLimitUsd": null,
      "reviewCadence": "trading_day",
      "conservativeAllowlist": [
        {
          "symbol": "BND",
          "category": "broad_bond_market_etf",
          "targetAllocationPct": 0.20,
          "priority": 10
        }
      ]
    }')
  ),
  updated_at = datetime('now')
WHERE portfolio_id = 'portfolio_ira'
  AND profile_key = 'ira';

UPDATE watchlist_assets
SET notes = 'Bond ETF candidate for defensive allocation and approved IRA idle-cash fallback while Treasury cash-equivalent ETF support is not yet seeded.',
  updated_at = datetime('now')
WHERE watchlist_id = 'watchlist_ira_core'
  AND asset_id = 'asset_bnd';
