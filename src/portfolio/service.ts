import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";

export async function getPortfolio(db: D1Database, portfolioId = TIM_PORTFOLIO_ID) {
  const portfolio = await db
    .prepare(
      `SELECT p.id, p.user_id AS userId, p.broker_account_id AS brokerAccountId,
        p.name, p.cash_usd AS cashUsd, p.starting_balance_usd AS startingBalanceUsd,
        p.currency, p.mode, p.created_at AS createdAt, p.updated_at AS updatedAt,
        ba.status AS accountStatus, ba.account_type AS accountType
       FROM portfolios p
       LEFT JOIN broker_accounts ba ON ba.id = p.broker_account_id
       WHERE p.id = ?`
    )
    .bind(portfolioId)
    .first<{ userId: string }>();
  const user = portfolio
    ? await db.prepare("SELECT id, name, created_at AS createdAt FROM users WHERE id = ?").bind(portfolio.userId).first()
    : null;
  const positions = await listRows(
    db
      .prepare(
        `SELECT symbol, asset_class AS assetClass, quantity, avg_entry_price_usd AS avgEntryPriceUsd,
          current_price_usd AS currentPriceUsd, market_value_usd AS marketValueUsd, updated_at AS updatedAt
         FROM positions WHERE portfolio_id = ? ORDER BY symbol`
      )
      .bind(portfolioId)
  );
  const goals = await listRows(
    db
      .prepare(
        `SELECT objective, target_description AS targetDescription, created_at AS createdAt
         FROM portfolio_goals WHERE portfolio_id = ?`
      )
      .bind(portfolioId)
  );
  const riskProfile = await db
    .prepare(
      `SELECT risk_level AS riskLevel, max_position_pct AS maxPositionPct,
        max_daily_loss_pct AS maxDailyLossPct, leverage_allowed AS leverageAllowed,
        options_allowed AS optionsAllowed, futures_allowed AS futuresAllowed,
        live_trading_allowed AS liveTradingAllowed
       FROM risk_profiles WHERE portfolio_id = ?`
    )
    .bind(portfolioId)
    .first();

  return { user, portfolio, positions, goals, riskProfile };
}
