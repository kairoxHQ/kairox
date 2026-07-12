import { TIM_PORTFOLIO_ID, TIM_USER_ID } from "../shared/db.ts";

export interface SystemSettings {
  automationPaused: boolean;
  liveTradingEnabled: false;
  profile: InvestmentProfile;
}

export interface InvestmentProfile {
  primaryGoal: string;
  riskLevel: string;
  tradingActivity: string;
  dividendPreference: string;
  dividendHandling: string;
  leverageAllowed: boolean;
  shortSellingAllowed: boolean;
  optionsAllowed: boolean;
  futuresAllowed: boolean;
  notes: string;
}

export async function getSettings(db: D1Database): Promise<SystemSettings> {
  await ensureSprint3Defaults(db);
  const paused = await getSetting(db, "automation_paused");
  return {
    automationPaused: paused === "true",
    liveTradingEnabled: false,
    profile: await getInvestmentProfile(db)
  };
}

export async function setAutomationPaused(db: D1Database, paused: boolean): Promise<SystemSettings> {
  await ensureSprint3Defaults(db);
  await db
    .prepare(
      `INSERT INTO system_settings (key, value, description, updated_at)
       VALUES ('automation_paused', ?, 'When true, scheduled runs may collect market data but cannot execute paper trades.', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(paused ? "true" : "false")
    .run();
  return getSettings(db);
}

export async function ensureSprint3Defaults(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO system_settings (key, value, description)
       VALUES
        ('automation_paused', 'false', 'When true, scheduled runs may collect market data but cannot execute paper trades.'),
        ('live_trading_enabled', 'false', 'Live brokerage execution remains disabled by default and is not supported in this project.')`
    )
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO investment_profiles (
        id, user_id, portfolio_id, primary_goal, risk_level, trading_activity,
        dividend_preference, dividend_handling, leverage_allowed, short_selling_allowed,
        options_allowed, futures_allowed, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`
    )
    .bind(
      "profile_tim_initial",
      TIM_USER_ID,
      TIM_PORTFOLIO_ID,
      "maximize long-term net worth",
      "moderate growth",
      "active when justified",
      "preferred when expected total return is otherwise comparable",
      "reinvest dividends",
      "Rank investments primarily by expected risk-adjusted total return. Dividend quality and expected dividend return are secondary tie-breakers only."
    )
    .run();
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function getInvestmentProfile(db: D1Database): Promise<InvestmentProfile> {
  const row = await db
    .prepare(
      `SELECT primary_goal AS primaryGoal, risk_level AS riskLevel,
        trading_activity AS tradingActivity, dividend_preference AS dividendPreference,
        dividend_handling AS dividendHandling, leverage_allowed AS leverageAllowed,
        short_selling_allowed AS shortSellingAllowed, options_allowed AS optionsAllowed,
        futures_allowed AS futuresAllowed, notes
       FROM investment_profiles
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(TIM_PORTFOLIO_ID)
    .first<{
      primaryGoal: string;
      riskLevel: string;
      tradingActivity: string;
      dividendPreference: string;
      dividendHandling: string;
      leverageAllowed: number;
      shortSellingAllowed: number;
      optionsAllowed: number;
      futuresAllowed: number;
      notes: string;
    }>();

  return {
    primaryGoal: row?.primaryGoal ?? "maximize long-term net worth",
    riskLevel: row?.riskLevel ?? "moderate growth",
    tradingActivity: row?.tradingActivity ?? "active when justified",
    dividendPreference: row?.dividendPreference ?? "preferred when expected total return is otherwise comparable",
    dividendHandling: row?.dividendHandling ?? "reinvest dividends",
    leverageAllowed: row?.leverageAllowed === 1,
    shortSellingAllowed: row?.shortSellingAllowed === 1,
    optionsAllowed: row?.optionsAllowed === 1,
    futuresAllowed: row?.futuresAllowed === 1,
    notes: row?.notes ?? "Dividend quality is a secondary preference, not the primary objective."
  };
}
