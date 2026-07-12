import { listRows, TIM_PORTFOLIO_ID } from "../shared/db.ts";

export async function getRecommendations(db: D1Database) {
  return listRows(
    db
      .prepare(
        `SELECT id, symbol, action, explanation,
          confidence_score AS confidenceScore, risk_score AS riskScore,
          market_data_source AS marketDataSource, price_usd AS priceUsd,
          price_as_of AS priceAsOf, created_at AS createdAt
         FROM recommendations
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT 25`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
}

export async function getJournal(db: D1Database) {
  return listRows(
    db
      .prepare(
        `SELECT id, recommendation_id AS recommendationId, decision, explanation,
          confidence_score AS confidenceScore, risk_score AS riskScore,
          price_data_json AS priceDataJson, created_at AS createdAt
         FROM decision_journal
         WHERE portfolio_id = ?
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .bind(TIM_PORTFOLIO_ID)
  );
}
