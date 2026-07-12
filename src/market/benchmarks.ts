import { listRows } from "../shared/db.ts";

export async function getBenchmarks(db: D1Database) {
  return listRows(
    db.prepare(
      `SELECT benchmark_name AS benchmarkName, snapshot_date AS snapshotDate,
        symbol, starting_value_usd AS startingValueUsd, units,
        price_usd AS priceUsd, value_usd AS valueUsd,
        market_data_source AS marketDataSource, price_as_of AS priceAsOf,
        created_at AS createdAt
       FROM benchmark_snapshots
       ORDER BY benchmark_name, snapshot_date DESC`
    )
  );
}
