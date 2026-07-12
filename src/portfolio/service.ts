import { listRows, TIM_PORTFOLIO_ID, TIM_USER_ID } from "../shared/db.ts";

export async function getPortfolio(db: D1Database) {
  const user = await db.prepare("SELECT id, name, created_at AS createdAt FROM users WHERE id = ?").bind(TIM_USER_ID).first();
  const portfolio = await db
    .prepare(
      `SELECT id, name, cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd,
        currency, mode, created_at AS createdAt, updated_at AS updatedAt
       FROM portfolios WHERE id = ?`
    )
    .bind(TIM_PORTFOLIO_ID)
    .first();
  const positions = await listRows(
    db
      .prepare(
        `SELECT symbol, asset_class AS assetClass, quantity, avg_entry_price_usd AS avgEntryPriceUsd,
          current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd, updated_at AS updatedAt
         FROM positions WHERE portfolio_id = ? ORDER BY symbol`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  const goals = await listRows(
    db
      .prepare(
        `SELECT objective, target_description AS targetDescription, created_at AS createdAt
         FROM portfolio_goals WHERE portfolio_id = ?`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
  const riskProfile = await db
    .prepare(
      `SELECT risk_level AS riskLevel, max_position_pct AS maxPositionPct,
        max_daily_loss_pct AS maxDailyLossPct, leverage_allowed AS leverageAllowed,
        options_allowed AS optionsAllowed, futures_allowed AS futuresAllowed,
        live_trading_allowed AS liveTradingAllowed
       FROM risk_profiles WHERE portfolio_id = ?`
    )
    .bind(TIM_PORTFOLIO_ID)
    .first();

  return { user, portfolio, positions, goals, riskProfile };
}
