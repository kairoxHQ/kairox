import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";
import type { InvestmentProfile } from "../settings/service.ts";

export interface DividendEventInput {
  symbol: string;
  amountUsd: number;
  amountPerShareUsd?: number;
  quantity?: number;
  paymentDate?: string;
  exDividendDate?: string;
  source: string;
  explanation: string;
  currentPriceUsd?: number;
}

export async function getDividendEvents(db: D1Database): Promise<unknown[]> {
  return listRows(
    db
      .prepare(
        `SELECT symbol, amount_usd AS amountUsd, amount_per_share_usd AS amountPerShareUsd,
          quantity, ex_dividend_date AS exDividendDate, payment_date AS paymentDate,
          source, reliability_status AS reliabilityStatus, reinvested,
          reinvested_quantity AS reinvestedQuantity, explanation, created_at AS createdAt
         FROM dividend_events
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
}

export async function recordDividendEvent(
  db: D1Database,
  profile: InvestmentProfile,
  input: DividendEventInput
): Promise<{ recorded: boolean; reinvestedQuantity: number }> {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0 || !input.paymentDate) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO dividend_events (
          id, portfolio_id, symbol, amount_usd, source, reliability_status, explanation
        ) VALUES (?, ?, ?, 0, ?, 'unavailable', ?)`
      )
      .bind(
        `dividend_unavailable_${input.symbol}_${Date.now()}`,
        TIM_PORTFOLIO_ID,
        input.symbol,
        input.source,
        "Reliable dividend amount or payment date was unavailable, so dividend return is excluded."
      )
      .run();
    return { recorded: false, reinvestedQuantity: 0 };
  }

  const shouldReinvest = profile.dividendHandling.toLowerCase().includes("reinvest");
  const reinvestedQuantity = calculateReinvestedQuantity(input.amountUsd, input.currentPriceUsd, shouldReinvest);

  await db
    .prepare(
      `INSERT OR IGNORE INTO dividend_events (
        id, portfolio_id, symbol, amount_usd, amount_per_share_usd, quantity,
        ex_dividend_date, payment_date, source, reliability_status, reinvested,
        reinvested_quantity, explanation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?)`
    )
    .bind(
      `dividend_${input.symbol}_${input.paymentDate}`,
      TIM_PORTFOLIO_ID,
      input.symbol,
      input.amountUsd,
      input.amountPerShareUsd ?? null,
      input.quantity ?? null,
      input.exDividendDate ?? null,
      input.paymentDate,
      input.source,
      shouldReinvest ? 1 : 0,
      reinvestedQuantity,
      input.explanation
    )
    .run();

  if (shouldReinvest && reinvestedQuantity > 0 && input.currentPriceUsd) {
    await db
      .prepare(
        `UPDATE positions
         SET quantity = quantity + ?,
           market_value_usd = (quantity + ?) * ?,
           current_price_usd = ?,
           updated_at = datetime('now')
         WHERE portfolio_id = ? AND symbol = ? AND quantity > 0`
      )
      .bind(reinvestedQuantity, reinvestedQuantity, input.currentPriceUsd, input.currentPriceUsd, TIM_PORTFOLIO_ID, input.symbol)
      .run();
  } else {
    await db
      .prepare("UPDATE portfolios SET cash_usd = cash_usd + ?, updated_at = datetime('now') WHERE id = ?")
      .bind(input.amountUsd, TIM_PORTFOLIO_ID)
      .run();
  }

  return { recorded: true, reinvestedQuantity };
}

export function assessDividendQuality(input: {
  payoutRatio?: number;
  consecutivePaymentYears?: number;
}): { available: boolean; status: string; explanation: string } {
  if (input.payoutRatio === undefined || input.consecutivePaymentYears === undefined) {
    return {
      available: false,
      status: "unavailable",
      explanation: "Reliable payout sustainability and consistency data is unavailable, so dividend quality is not scored."
    };
  }

  const sustainable = input.payoutRatio >= 0 && input.payoutRatio <= 0.8;
  const consistent = input.consecutivePaymentYears >= 5;
  return {
    available: true,
    status: sustainable && consistent ? "acceptable" : "weak",
    explanation: sustainable && consistent
      ? "Dividend quality checks passed based on payout sustainability and consistency."
      : "Dividend quality checks did not pass payout sustainability or consistency thresholds."
  };
}

export function calculateReinvestedQuantity(amountUsd: number, currentPriceUsd: number | undefined, reinvest: boolean): number {
  if (!reinvest || !currentPriceUsd || currentPriceUsd <= 0 || amountUsd <= 0) {
    return 0;
  }
  return amountUsd / currentPriceUsd;
}
