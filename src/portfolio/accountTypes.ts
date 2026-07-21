import type { AssetClass } from "../shared/types.ts";

export type LinkedPortfolioAccountType = "paper" | "read_only_watchlist" | "paper_portfolio_twin";

export interface LinkedPortfolioAccount {
  portfolioId: string;
  accountType: LinkedPortfolioAccountType;
  linkedPortfolioId: string | null;
  relationshipLabel: string | null;
  manualEntryEnabled: boolean;
  managedByKairox: boolean;
  readOnly: boolean;
  badgeLabel: "Paper" | "Read Only" | "Paper Managed";
  tradingAllowed: boolean;
  orderGenerationAllowed: boolean;
  rebalanceAllowed: boolean;
}

export interface CreatePaperPortfolioTwinInput {
  sourcePortfolioId: string;
  twinPortfolioId: string;
  name: string;
  userId?: string;
  brokerAccountId?: string | null;
  relationshipLabel?: string;
  profileKey?: string;
  displayName?: string;
  philosophy?: string;
  riskPosture?: string;
  now?: Date;
}

export interface ManualReadOnlyHoldingInput {
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  averageCostUsd: number;
  currentPriceUsd?: number;
  marketValueUsd?: number;
}

export interface UpdateReadOnlyWatchlistManualInput {
  cashUsd: number;
  holdings: ManualReadOnlyHoldingInput[];
  now?: Date;
}

export interface ReadOnlyWatchlistManualUpdateResult {
  portfolioId: string;
  cashUsd: number;
  holdingCount: number;
  updatedAt: string;
  readOnly: true;
}

interface LinkedPortfolioAccountRow {
  portfolioId: string;
  accountType: LinkedPortfolioAccountType;
  linkedPortfolioId: string | null;
  relationshipLabel: string | null;
  manualEntryEnabled: number;
  managedByKairox: number;
  readOnly: number;
}

interface PortfolioCopyRow {
  id: string;
  userId: string;
  brokerAccountId: string | null;
  name: string;
  cashUsd: number;
  startingBalanceUsd: number;
  currency: string;
  mode: string;
}

interface PositionCopyRow {
  symbol: string;
  assetClass: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
}

interface GoalCopyRow {
  objective: string;
  targetDescription: string;
}

interface RiskCopyRow {
  riskLevel: string;
  maxPositionPct: number;
  maxDailyLossPct: number;
  leverageAllowed: number;
  optionsAllowed: number;
  futuresAllowed: number;
}

const DEFAULT_ACCOUNT: LinkedPortfolioAccount = {
  portfolioId: "",
  accountType: "paper",
  linkedPortfolioId: null,
  relationshipLabel: "Standalone paper portfolio",
  manualEntryEnabled: false,
  managedByKairox: true,
  readOnly: false,
  badgeLabel: "Paper",
  tradingAllowed: true,
  orderGenerationAllowed: true,
  rebalanceAllowed: true
};

export async function getLinkedPortfolioAccount(db: D1Database, portfolioId: string): Promise<LinkedPortfolioAccount> {
  try {
    const row = await db.prepare(
      `SELECT portfolio_id AS portfolioId, account_type AS accountType,
        linked_portfolio_id AS linkedPortfolioId, relationship_label AS relationshipLabel,
        manual_entry_enabled AS manualEntryEnabled, managed_by_kairox AS managedByKairox,
        read_only AS readOnly
       FROM linked_portfolio_accounts
       WHERE portfolio_id = ?`
    ).bind(portfolioId).first<LinkedPortfolioAccountRow>();
    return classifyLinkedPortfolioAccount(row, portfolioId);
  } catch (error) {
    if (isMissingLinkedPortfolioTable(error)) {
      return { ...DEFAULT_ACCOUNT, portfolioId };
    }
    throw error;
  }
}

export async function listLinkedPortfolioAccounts(db: D1Database, portfolioIds: string[]): Promise<Map<string, LinkedPortfolioAccount>> {
  const unique = [...new Set(portfolioIds.filter(Boolean))];
  const accounts = new Map<string, LinkedPortfolioAccount>();
  for (const portfolioId of unique) {
    accounts.set(portfolioId, await getLinkedPortfolioAccount(db, portfolioId));
  }
  return accounts;
}

export async function assertPortfolioAllowsTradingActions(db: D1Database, portfolioId: string, action: string): Promise<LinkedPortfolioAccount> {
  const account = await getLinkedPortfolioAccount(db, portfolioId);
  if (account.readOnly || !account.tradingAllowed || !account.orderGenerationAllowed || !account.rebalanceAllowed) {
    throw new Error(`${account.badgeLabel} portfolios cannot ${action}.`);
  }
  return account;
}

export async function createPaperPortfolioTwinFromReadOnly(db: D1Database, input: CreatePaperPortfolioTwinInput): Promise<LinkedPortfolioAccount> {
  const sourceAccount = await getLinkedPortfolioAccount(db, input.sourcePortfolioId);
  if (!sourceAccount.readOnly) {
    throw new Error("Paper Portfolio Twins must start from a Read Only watchlist.");
  }
  const source = await db.prepare(
    `SELECT id, user_id AS userId, broker_account_id AS brokerAccountId, name,
      cash_usd AS cashUsd, starting_balance_usd AS startingBalanceUsd, currency, mode
     FROM portfolios
     WHERE id = ?`
  ).bind(input.sourcePortfolioId).first<PortfolioCopyRow>();
  if (!source) {
    throw new Error("Source Read Only watchlist portfolio not found.");
  }
  if (source.mode !== "paper") {
    throw new Error("Linked portfolios must remain within the paper-only portfolio storage model.");
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const [positions, goals, risks] = await Promise.all([
    allRows<PositionCopyRow>(db.prepare(
      `SELECT symbol, asset_class AS assetClass, quantity,
        avg_entry_price_usd AS avgEntryPriceUsd, current_price_usd AS currentPriceUsd,
        market_value_usd AS marketValueUsd
       FROM positions
       WHERE portfolio_id = ? AND quantity > 0
       ORDER BY symbol`
    ).bind(input.sourcePortfolioId)),
    allRows<GoalCopyRow>(db.prepare(
      `SELECT objective, target_description AS targetDescription
       FROM portfolio_goals
       WHERE portfolio_id = ?
       ORDER BY created_at, id`
    ).bind(input.sourcePortfolioId)),
    allRows<RiskCopyRow>(db.prepare(
      `SELECT risk_level AS riskLevel, max_position_pct AS maxPositionPct,
        max_daily_loss_pct AS maxDailyLossPct, leverage_allowed AS leverageAllowed,
        options_allowed AS optionsAllowed, futures_allowed AS futuresAllowed
       FROM risk_profiles
       WHERE portfolio_id = ?
       ORDER BY created_at, id`
    ).bind(input.sourcePortfolioId))
  ]);

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO portfolios (
        id, user_id, broker_account_id, name, cash_usd, starting_balance_usd, currency, mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'paper', ?, ?)`
    ).bind(
      input.twinPortfolioId,
      input.userId ?? source.userId,
      "brokerAccountId" in input ? input.brokerAccountId ?? null : source.brokerAccountId,
      input.name,
      source.cashUsd,
      source.startingBalanceUsd,
      source.currency,
      nowIso,
      nowIso
    ),
    db.prepare(
      `INSERT INTO linked_portfolio_accounts (
        portfolio_id, account_type, linked_portfolio_id, relationship_label,
        manual_entry_enabled, managed_by_kairox, read_only, created_at, updated_at
      ) VALUES (?, 'paper_portfolio_twin', ?, ?, 0, 1, 0, ?, ?)`
    ).bind(
      input.twinPortfolioId,
      input.sourcePortfolioId,
      input.relationshipLabel ?? `Paper-managed twin of ${source.name}`,
      nowIso,
      nowIso
    )
  ];

  positions.forEach((position, index) => {
    statements.push(db.prepare(
      `INSERT INTO positions (
        id, portfolio_id, symbol, asset_class, quantity, avg_entry_price_usd,
        current_price_usd, market_value_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `${sanitizeId(input.twinPortfolioId)}_${sanitizeId(position.symbol)}_${index + 1}`,
      input.twinPortfolioId,
      position.symbol,
      position.assetClass,
      position.quantity,
      position.avgEntryPriceUsd,
      position.currentPriceUsd,
      position.marketValueUsd,
      nowIso
    ));
  });

  goals.forEach((goal, index) => {
    statements.push(db.prepare(
      `INSERT INTO portfolio_goals (id, portfolio_id, objective, target_description, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(`goal_${sanitizeId(input.twinPortfolioId)}_${index + 1}`, input.twinPortfolioId, goal.objective, goal.targetDescription, nowIso));
  });

  risks.forEach((risk, index) => {
    statements.push(db.prepare(
      `INSERT INTO risk_profiles (
        id, portfolio_id, risk_level, max_position_pct, max_daily_loss_pct,
        leverage_allowed, options_allowed, futures_allowed, live_trading_allowed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      `risk_${sanitizeId(input.twinPortfolioId)}_${index + 1}`,
      input.twinPortfolioId,
      risk.riskLevel,
      risk.maxPositionPct,
      risk.maxDailyLossPct,
      risk.leverageAllowed,
      risk.optionsAllowed,
      risk.futuresAllowed,
      nowIso
    ));
  });

  if (input.profileKey) {
    const startingEquity = source.cashUsd + positions.reduce((sum, position) => sum + position.marketValueUsd, 0);
    statements.push(db.prepare(
      `INSERT INTO portfolio_profiles (
        id, portfolio_id, profile_key, display_name, philosophy, risk_posture,
        comparison_start_timestamp, comparison_start_equity_usd, normalized_start_index,
        parameters_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, '{}', 1, ?, ?)`
    ).bind(
      `portfolio_profile_${sanitizeId(input.profileKey)}`,
      input.twinPortfolioId,
      input.profileKey,
      input.displayName ?? input.name,
      input.philosophy ?? "Paper-managed twin for comparison against a read-only baseline.",
      input.riskPosture ?? "managed",
      nowIso,
      startingEquity,
      nowIso,
      nowIso
    ));
  }

  await db.batch(statements);
  return getLinkedPortfolioAccount(db, input.twinPortfolioId);
}

export async function updateReadOnlyWatchlistManualHoldings(db: D1Database, portfolioId: string, input: UpdateReadOnlyWatchlistManualInput): Promise<ReadOnlyWatchlistManualUpdateResult> {
  const account = await getLinkedPortfolioAccount(db, portfolioId);
  if (!account.readOnly || !account.manualEntryEnabled) {
    throw new Error("Manual holdings maintenance is restricted to Read Only watchlists.");
  }
  if (!Number.isFinite(input.cashUsd) || input.cashUsd < 0) {
    throw new Error("Cash must be a non-negative finite number.");
  }
  if (!Array.isArray(input.holdings)) {
    throw new Error("Holdings must be provided as an array.");
  }

  const holdings = input.holdings.map(normalizeManualHolding);
  const nowIso = (input.now ?? new Date()).toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE portfolios SET cash_usd = ?, updated_at = ? WHERE id = ?").bind(input.cashUsd, nowIso, portfolioId),
    db.prepare("DELETE FROM positions WHERE portfolio_id = ?").bind(portfolioId)
  ];

  holdings.forEach((holding, index) => {
    statements.push(db.prepare(
      `INSERT INTO positions (
        id, portfolio_id, symbol, asset_class, quantity, avg_entry_price_usd,
        current_price_usd, market_value_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `manual_${sanitizeId(portfolioId)}_${sanitizeId(holding.symbol)}_${index + 1}`,
      portfolioId,
      holding.symbol,
      holding.assetClass,
      holding.quantity,
      holding.averageCostUsd,
      holding.currentPriceUsd,
      holding.marketValueUsd,
      nowIso
    ));
  });

  await db.batch(statements);
  return { portfolioId, cashUsd: input.cashUsd, holdingCount: holdings.length, updatedAt: nowIso, readOnly: true };
}

export function classifyLinkedPortfolioAccount(row: LinkedPortfolioAccountRow | null | undefined, portfolioId: string): LinkedPortfolioAccount {
  const accountType = row?.accountType ?? "paper";
  const readOnly = accountType === "read_only_watchlist" || row?.readOnly === 1;
  const paperTwin = accountType === "paper_portfolio_twin";
  return {
    portfolioId,
    accountType,
    linkedPortfolioId: row?.linkedPortfolioId ?? null,
    relationshipLabel: row?.relationshipLabel ?? (paperTwin ? "Linked to read-only baseline" : readOnly ? "Read-only real holdings baseline" : "Standalone paper portfolio"),
    manualEntryEnabled: readOnly || row?.manualEntryEnabled === 1,
    managedByKairox: paperTwin || (accountType === "paper" && row?.managedByKairox !== 0),
    readOnly,
    badgeLabel: readOnly ? "Read Only" : paperTwin ? "Paper Managed" : "Paper",
    tradingAllowed: !readOnly,
    orderGenerationAllowed: !readOnly,
    rebalanceAllowed: !readOnly
  };
}

function isMissingLinkedPortfolioTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /linked_portfolio_accounts|no such table/i.test(message);
}

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
}

function normalizeManualHolding(input: ManualReadOnlyHoldingInput): Required<ManualReadOnlyHoldingInput> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,24}$/.test(symbol)) {
    throw new Error("Holding symbol is invalid.");
  }
  if (!isSupportedAssetClass(input.assetClass)) {
    throw new Error(`Unsupported asset class for ${symbol}.`);
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error(`Quantity for ${symbol} must be a positive finite number.`);
  }
  if (!Number.isFinite(input.averageCostUsd) || input.averageCostUsd < 0) {
    throw new Error(`Average cost for ${symbol} must be a non-negative finite number.`);
  }
  const currentPriceUsd = input.currentPriceUsd ?? input.averageCostUsd;
  if (!Number.isFinite(currentPriceUsd) || currentPriceUsd < 0) {
    throw new Error(`Current price for ${symbol} must be a non-negative finite number.`);
  }
  const marketValueUsd = input.marketValueUsd ?? input.quantity * currentPriceUsd;
  if (!Number.isFinite(marketValueUsd) || marketValueUsd < 0) {
    throw new Error(`Market value for ${symbol} must be a non-negative finite number.`);
  }
  return {
    symbol,
    assetClass: input.assetClass,
    quantity: input.quantity,
    averageCostUsd: input.averageCostUsd,
    currentPriceUsd,
    marketValueUsd
  };
}

function isSupportedAssetClass(value: string): value is AssetClass {
  return ["stock", "etf", "mutual_fund", "crypto", "reit", "bond_fund", "money_market", "index", "yield"].includes(value);
}
