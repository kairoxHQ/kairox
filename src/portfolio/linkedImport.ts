import { formatCurrency } from "../shared/displayFormat.ts";
import {
  createPaperPortfolioTwinFromReadOnly,
  createReadOnlyWatchlistFromReviewedImport,
  type CreateReadOnlyWatchlistInput,
  type LinkedPortfolioAccount,
  type ReviewedLinkedPortfolioHoldingInput
} from "./accountTypes.ts";

export interface LinkedPortfolioImportPreviewHolding extends ReviewedLinkedPortfolioHoldingInput {
  companyName: string;
  quantity: number;
  averageCostUsd: number;
  totalCostUsd: number;
  marketValueUsd: number;
  todayGainLossUsd: number | null;
  totalGainLossUsd: number | null;
  dividendIncomeUsd: number | null;
}

export interface LinkedPortfolioImportApprovalInput {
  cashUsd: number;
  holdings: LinkedPortfolioImportPreviewHolding[];
  expectedTotals: LinkedPortfolioImportExpectedTotals;
}

export interface LinkedPortfolioImportExpectedTotals {
  portfolioTotalUsd: number;
  totalCostBasisUsd: number;
  todayGainLossUsd: number;
  totalGainLossUsd?: number;
}

export interface LinkedPortfolioImportValidationIssue {
  severity: "error" | "warning";
  message: string;
  symbol?: string;
  field?: string;
}

export interface LinkedPortfolioImportValidationResult {
  passed: boolean;
  confidence: "High" | "Medium" | "Low";
  holdingCount: number;
  issues: LinkedPortfolioImportValidationIssue[];
  sums: Required<LinkedPortfolioImportExpectedTotals>;
}

export interface LinkedPortfolioImportApprovalResult {
  watchlist: LinkedPortfolioAccount;
  watchlistPortfolioId: string;
  watchlistName: string;
  holdingCount: number;
  cashUsd: number;
  totalCostUsd: number;
  currentMarketValueUsd: number;
  createTwinLabel: "Create Paper Twin";
}

export const TIM_REAL_WATCHLIST_PORTFOLIO_ID = "portfolio_tim_real_watchlist";
export const TIM_REAL_WATCHLIST_NAME = "Tim Real Watchlist";
export const TIM_REAL_TWIN_PORTFOLIO_ID = "portfolio_tim_real_portfolio";
export const TIM_REAL_TWIN_NAME = "Tim Real Portfolio";

const SCREENSHOT_IMPORT_PREVIEW = {
  detectedAt: "May 21, 2026 at 4:17 PM",
  cashUsd: 0,
  expectedTotals: {
    portfolioTotalUsd: 404.67,
    totalCostBasisUsd: 942.21,
    todayGainLossUsd: -0.24,
    totalGainLossUsd: -537.54
  },
  holdings: [
    { symbol: "GEN", companyName: "Gen Digital", assetClass: "stock", quantity: 1.386, averageCostUsd: 193.6, totalCostUsd: 268.43, marketValueUsd: 202.68, todayGainLossUsd: -0.2, totalGainLossUsd: -65.75, dividendIncomeUsd: 0 },
    { symbol: "FXAIX", companyName: "Fidelity 500 Index Fund", assetClass: "mutual_fund", quantity: 3.411, averageCostUsd: 162.61, totalCostUsd: 554.6, marketValueUsd: 547.11, todayGainLossUsd: 2.39, totalGainLossUsd: -7.49, dividendIncomeUsd: 0 },
    { symbol: "SOXX", companyName: "iShares Semiconductor ETF", assetClass: "etf", quantity: 2.078, averageCostUsd: 24.87, totalCostUsd: 51.69, marketValueUsd: 36.87, todayGainLossUsd: -0.54, totalGainLossUsd: -14.82, dividendIncomeUsd: 0 },
    { symbol: "MSFT", companyName: "Microsoft", assetClass: "stock", quantity: 0.09296, averageCostUsd: 368.6, totalCostUsd: 34.25, marketValueUsd: 34.44, todayGainLossUsd: 0.19, totalGainLossUsd: 0.19, dividendIncomeUsd: 0.04 },
    { symbol: "VOO", companyName: "Vanguard S&P 500 ETF", assetClass: "etf", quantity: 0.020406, averageCostUsd: 490.17, totalCostUsd: 10, marketValueUsd: 10.71, todayGainLossUsd: -0.01, totalGainLossUsd: 0.71, dividendIncomeUsd: 0 },
    { symbol: "KO", companyName: "Coca-Cola", assetClass: "stock", quantity: 0.15904, averageCostUsd: 69.23, totalCostUsd: 11.01, marketValueUsd: 10.83, todayGainLossUsd: 0.02, totalGainLossUsd: -0.18, dividendIncomeUsd: 0.01 },
    { symbol: "VOOG", companyName: "Vanguard S&P 500 Growth ETF", assetClass: "etf", quantity: 0.01328, averageCostUsd: 104.33, totalCostUsd: 1.38, marketValueUsd: 1.36, todayGainLossUsd: 0, totalGainLossUsd: -0.02, dividendIncomeUsd: 0 },
    { symbol: "ETH-USD", companyName: "Ethereum", assetClass: "crypto", quantity: 0.00314, averageCostUsd: 3251.7, totalCostUsd: 10.2, marketValueUsd: 8.48, todayGainLossUsd: -0.08, totalGainLossUsd: -1.72, dividendIncomeUsd: 0 },
    { symbol: "BTC-USD", companyName: "Bitcoin", assetClass: "crypto", quantity: 0.000017, averageCostUsd: 79430, totalCostUsd: 1.35, marketValueUsd: 1.31, todayGainLossUsd: -0.01, totalGainLossUsd: -0.04, dividendIncomeUsd: 0 }
  ] satisfies LinkedPortfolioImportPreviewHolding[]
};

export async function approveLinkedPortfolioImport(db: D1Database, input: LinkedPortfolioImportApprovalInput, now = new Date()): Promise<LinkedPortfolioImportApprovalResult> {
  const normalized = normalizeImportApproval(input);
  const validation = validateLinkedPortfolioImport(normalized);
  if (!validation.passed) {
    throw new Error(`Linked Portfolio import validation failed: ${validation.issues.map((issue) => issue.message).join(" ")}`);
  }
  const watchlist = await createReadOnlyWatchlistFromReviewedImport(db, {
    portfolioId: TIM_REAL_WATCHLIST_PORTFOLIO_ID,
    name: TIM_REAL_WATCHLIST_NAME,
    cashUsd: normalized.cashUsd,
    holdings: normalized.holdings,
    now
  });
  await recordImportAudit(db, TIM_REAL_WATCHLIST_PORTFOLIO_ID, validation, now);

  return {
    watchlist,
    watchlistPortfolioId: TIM_REAL_WATCHLIST_PORTFOLIO_ID,
    watchlistName: TIM_REAL_WATCHLIST_NAME,
    holdingCount: normalized.holdings.length,
    cashUsd: normalized.cashUsd,
    totalCostUsd: normalized.holdings.reduce((sum, holding) => sum + holding.totalCostUsd, 0),
    currentMarketValueUsd: normalized.holdings.reduce((sum, holding) => sum + holding.marketValueUsd, 0),
    createTwinLabel: "Create Paper Twin"
  };
}

export function validateLinkedPortfolioImport(input: LinkedPortfolioImportApprovalInput): LinkedPortfolioImportValidationResult {
  const issues: LinkedPortfolioImportValidationIssue[] = [];
  const holdings = Array.isArray(input.holdings) ? input.holdings : [];
  const cashUsd = input.cashUsd;
  const expected = input.expectedTotals;

  if (!Number.isFinite(cashUsd) || cashUsd < 0) {
    issues.push({ severity: "error", field: "cashUsd", message: "Cash must be a non-negative number." });
  }
  if (!expected || !["portfolioTotalUsd", "totalCostBasisUsd", "todayGainLossUsd"].every((field) => Number.isFinite(expected[field as keyof LinkedPortfolioImportExpectedTotals]))) {
    issues.push({ severity: "error", field: "expectedTotals", message: "Reconciliation target totals are required." });
  }

  const seen = new Set<string>();
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase();
    if (!symbol) {
      issues.push({ severity: "error", field: "symbol", message: "Every holding needs a symbol." });
      continue;
    }
    if (seen.has(symbol)) {
      issues.push({ severity: "error", symbol, field: "symbol", message: `${symbol} is duplicated.` });
    }
    seen.add(symbol);
    for (const field of ["quantity", "averageCostUsd", "totalCostUsd", "marketValueUsd"] as const) {
      if (!Number.isFinite(holding[field])) {
        issues.push({ severity: "error", symbol, field, message: `${symbol} is missing ${displayField(field)}.` });
      }
    }
    if (!Number.isFinite(holding.quantity) || holding.quantity <= 0) {
      issues.push({ severity: "error", symbol, field: "quantity", message: `${symbol} must have a positive share quantity.` });
    }
    if (!["crypto", "stock", "etf", "mutual_fund", "reit", "bond_fund", "money_market"].includes(holding.assetClass)) {
      issues.push({ severity: "error", symbol, field: "assetClass", message: `${symbol} has an unsupported asset class.` });
    }
    for (const field of ["todayGainLossUsd", "totalGainLossUsd"] as const) {
      if (!Number.isFinite(holding[field])) {
        issues.push({ severity: "error", symbol, field, message: `${symbol} is missing ${displayField(field)}.` });
      }
    }
    if (holding.dividendIncomeUsd !== null && holding.dividendIncomeUsd !== undefined && !Number.isFinite(holding.dividendIncomeUsd)) {
      issues.push({ severity: "error", symbol, field: "dividendIncomeUsd", message: `${symbol} has an invalid ${displayField("dividendIncomeUsd")}.` });
    }
  }

  if (holdings.length === 0) {
    issues.push({ severity: "error", field: "holdings", message: "At least one holding must be reviewed." });
  }

  const reconciledHoldings = holdings.filter((holding) => holding.symbol?.trim());
  const sums = sumImportValues({ cashUsd: Number.isFinite(cashUsd) ? cashUsd : 0, expectedTotals: expected ?? zeroExpectedTotals(), holdings: reconciledHoldings });
  if (expected) {
    checkTolerance(issues, sums.portfolioTotalUsd, expected.portfolioTotalUsd, "Market values plus cash do not match the portfolio total.");
    checkTolerance(issues, sums.totalCostBasisUsd, expected.totalCostBasisUsd, "Total costs do not match the cost basis.");
    checkTolerance(issues, sums.todayGainLossUsd, expected.todayGainLossUsd, "Today's gain/loss does not reconcile.");
    if (Number.isFinite(expected.totalGainLossUsd) && Math.abs(sums.totalGainLossUsd - (expected.totalGainLossUsd as number)) > 0.05) {
      issues.push({
        severity: "warning",
        field: "totalGainLossUsd",
        message: "Screenshot total gain/loss differs from the calculated row total. Reviewed rows remain authoritative."
      });
    }
  }

  const confidence = issues.some((issue) => issue.severity === "error") ? "Low" : issues.length ? "Medium" : "High";
  return { passed: !issues.some((issue) => issue.severity === "error"), confidence, holdingCount: holdings.length, issues, sums };
}

export async function createTimRealPortfolioTwin(db: D1Database, now = new Date()): Promise<LinkedPortfolioAccount> {
  return createPaperPortfolioTwinFromReadOnly(db, {
    sourcePortfolioId: TIM_REAL_WATCHLIST_PORTFOLIO_ID,
    twinPortfolioId: TIM_REAL_TWIN_PORTFOLIO_ID,
    name: TIM_REAL_TWIN_NAME,
    profileKey: "tim_real_portfolio",
    displayName: TIM_REAL_TWIN_NAME,
    relationshipLabel: `Paper-managed twin of ${TIM_REAL_WATCHLIST_NAME}`,
    philosophy: "Paper-managed comparison portfolio cloned once from Tim's real holdings baseline.",
    riskPosture: "managed",
    brokerAccountId: null,
    now
  });
}

export function renderLinkedPortfolioImportPreview(): Response {
  const previewValidation = validateLinkedPortfolioImport({
    cashUsd: SCREENSHOT_IMPORT_PREVIEW.cashUsd,
    expectedTotals: SCREENSHOT_IMPORT_PREVIEW.expectedTotals,
    holdings: SCREENSHOT_IMPORT_PREVIEW.holdings
  });
  return htmlPage("Linked Portfolio Import Preview", `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Linked Portfolios</p>
        <h1>Review Tim Real Watchlist Import</h1>
        <p class="lede">The screenshot is only a temporary starting point. Verify or correct every field before creating the Read Only watchlist.</p>
      </section>
      <section class="notice">
        <strong>No database records are created from this page until you approve the reviewed values.</strong>
        <span>Do not treat screenshot extraction as authoritative. The approved form values become the source of truth.</span>
      </section>
      <section class="panel summary">
        <div><span>Source</span><strong>Screenshot Upload</strong></div>
        <div><span>Detected</span><strong>${escapeHtml(SCREENSHOT_IMPORT_PREVIEW.detectedAt)}</strong></div>
        <div><span>Holdings</span><strong>${SCREENSHOT_IMPORT_PREVIEW.holdings.length} securities + cash</strong></div>
        <div><span>Cash</span><strong>${formatCurrency(SCREENSHOT_IMPORT_PREVIEW.cashUsd)}</strong></div>
        <div><span>Displayed portfolio total</span><strong>${formatCurrency(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.portfolioTotalUsd)}</strong></div>
        <div><span>Displayed cost basis</span><strong>${formatCurrency(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.totalCostBasisUsd)}</strong></div>
        <div><span>Displayed total gain/loss</span><strong>${formatCurrency(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.totalGainLossUsd)}</strong></div>
        <div><span>Displayed today's gain/loss</span><strong>${formatCurrency(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.todayGainLossUsd)}</strong></div>
      </section>
      <form id="import-form" class="panel">
        <section id="validation-card" class="validation-card" aria-live="polite">
          <h2>Import Validation</h2>
          <div id="validation-summary"></div>
          <button type="button" id="next-issue">Go to next issue</button>
        </section>
        <section class="targets">
          <h2>Reconciliation Targets</h2>
          <div class="form-row">
            <label>Displayed portfolio total<input name="portfolioTotalUsd" inputmode="decimal" value="${moneyInput(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.portfolioTotalUsd)}"></label>
            <label>Displayed cost basis<input name="totalCostBasisUsd" inputmode="decimal" value="${moneyInput(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.totalCostBasisUsd)}"></label>
            <label>Displayed today's gain/loss<input name="todayGainLossUsd" inputmode="decimal" value="${signedMoneyInput(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.todayGainLossUsd)}"></label>
            <label>Calculated total gain/loss<input name="totalGainLossUsd" readonly data-screenshot-total="${signedMoneyInput(SCREENSHOT_IMPORT_PREVIEW.expectedTotals.totalGainLossUsd)}" value="${signedMoneyInput(previewValidation.sums.totalGainLossUsd)}"></label>
          </div>
        </section>
        <div class="form-row">
          <label>Account name<input value="${escapeHtml(TIM_REAL_WATCHLIST_NAME)}" disabled></label>
          <label>Type<input value="Read Only Watchlist" disabled></label>
          <label>Cash balance<input name="cashUsd" inputmode="decimal" value="${moneyInput(SCREENSHOT_IMPORT_PREVIEW.cashUsd)}"></label>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company / ETF</th>
                <th>Shares</th>
                <th>Average Cost/Share</th>
                <th>Total Cost</th>
                <th>Market Value</th>
                <th>Today's Gain/Loss</th>
                <th>Total Gain/Loss</th>
                <th>Dividend Income</th>
                <th>Asset Class</th>
              </tr>
            </thead>
            <tbody id="holding-rows">
              ${SCREENSHOT_IMPORT_PREVIEW.holdings.map((holding, index) => holdingRow(index, holding)).join("")}
              ${Array.from({ length: 3 }, (_, index) => holdingRow(SCREENSHOT_IMPORT_PREVIEW.holdings.length + index)).join("")}
            </tbody>
          </table>
        </div>
        <div class="actions">
          <button type="button" id="add-row">Add Row</button>
          <label class="secret">Protected action secret<input id="secret" type="password" autocomplete="off"></label>
          <button type="submit" id="approve-button" disabled>Approve And Create Read Only Watchlist</button>
        </div>
        <p id="status" class="status" role="status"></p>
      </form>
    </main>
    <script>
      const rows = document.getElementById("holding-rows");
      const status = document.getElementById("status");
      const approveButton = document.getElementById("approve-button");
      const validationSummary = document.getElementById("validation-summary");
      const nextIssueButton = document.getElementById("next-issue");
      const totalGainLossInput = document.querySelector("[name=totalGainLossUsd]");
      const screenshotTotalGainLoss = numeric(totalGainLossInput.dataset.screenshotTotal);
      const tolerance = 0.05;
      let issueRows = [];
      let issueIndex = -1;
      const addRow = () => {
        const index = rows.querySelectorAll("tr").length;
        rows.insertAdjacentHTML("beforeend", ${JSON.stringify(holdingRow("__INDEX__")).replace(/__INDEX__/g, '" + index + "')});
        bindRow(rows.lastElementChild);
        runValidation();
      };
      document.getElementById("add-row").addEventListener("click", addRow);
      document.querySelectorAll("input, select").forEach((element) => element.addEventListener("input", () => {
        if (element.dataset.confidence) {
          element.dataset.confidence = "Verified by user";
          element.closest("td")?.setAttribute("data-confidence", "Verified by user");
        }
        runValidation();
      }));
      nextIssueButton.addEventListener("click", () => {
        if (!issueRows.length) return;
        issueIndex = (issueIndex + 1) % issueRows.length;
        issueRows[issueIndex].scrollIntoView({ block: "center", behavior: "smooth" });
        issueRows[issueIndex].querySelector("input, select")?.focus();
      });
      document.getElementById("import-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const validation = runValidation();
        if (!validation.passed) {
          status.textContent = "Correct the validation issues before approval.";
          return;
        }
        status.textContent = "Submitting reviewed values...";
        const secret = document.getElementById("secret").value;
        const response = await fetch("/linked-portfolios/import-preview/approve", {
          method: "POST",
          headers: { "content-type": "application/json", "accept": "text/html", "x-cryptolab-paper-secret": secret },
          body: JSON.stringify(approvalPayload())
        });
        const body = await response.text();
        if (!response.ok) {
          status.textContent = body;
          return;
        }
        document.open();
        document.write(body);
        document.close();
      });
      runValidation();
      function bindRow(row) {
        row.querySelectorAll("input, select").forEach((element) => {
          element.addEventListener("input", () => {
            if (element.dataset.confidence) {
              element.dataset.confidence = "Verified by user";
              element.closest("td")?.setAttribute("data-confidence", "Verified by user");
            }
            runValidation();
          });
        });
      }
      function collectInput() {
        const cashUsd = numeric(document.querySelector("[name=cashUsd]").value);
        const expectedTotals = {
          portfolioTotalUsd: numeric(document.querySelector("[name=portfolioTotalUsd]").value),
          totalCostBasisUsd: numeric(document.querySelector("[name=totalCostBasisUsd]").value),
          todayGainLossUsd: numeric(document.querySelector("[name=todayGainLossUsd]").value),
          totalGainLossUsd: numeric(totalGainLossInput.value)
        };
        const holdings = [...rows.querySelectorAll("tr")].map((row) => ({
          symbol: text(row, "symbol"),
          companyName: text(row, "companyName"),
          quantity: numeric(value(row, "quantity")),
          averageCostUsd: numeric(value(row, "averageCostUsd")),
          totalCostUsd: numeric(value(row, "totalCostUsd")),
          marketValueUsd: numeric(value(row, "marketValueUsd")),
          todayGainLossUsd: optionalNumeric(value(row, "todayGainLossUsd")),
          totalGainLossUsd: optionalNumeric(value(row, "totalGainLossUsd")),
          dividendIncomeUsd: optionalNumeric(value(row, "dividendIncomeUsd")),
          assetClass: value(row, "assetClass") || "stock",
          row
        })).filter((holding) => holding.symbol || [...holding.row.querySelectorAll("input")].some((input) => input.value.trim()));
        return { cashUsd, expectedTotals, holdings };
      }
      function approvalPayload() {
        const input = collectInput();
        return {
          cashUsd: input.cashUsd,
          expectedTotals: input.expectedTotals,
          holdings: input.holdings.map(({ row, ...holding }) => holding)
        };
      }
      function runValidation() {
        const input = collectInput();
        const issues = [];
        const duplicateSymbols = new Set();
        const seen = new Set();
        const rowBySymbol = new Map();
        input.holdings.forEach((holding) => {
          const symbol = holding.symbol.trim().toUpperCase();
          if (symbol) {
            if (seen.has(symbol)) duplicateSymbols.add(symbol);
            seen.add(symbol);
            rowBySymbol.set(symbol, holding.row);
          }
          if (!symbol) issues.push({ message: "A row has values but no symbol.", row: holding.row });
          for (const field of ["quantity", "averageCostUsd", "totalCostUsd", "marketValueUsd"]) {
            if (!Number.isFinite(holding[field])) issues.push({ message: (symbol || "A row") + " is missing " + field + ".", row: holding.row });
          }
          for (const field of ["todayGainLossUsd", "totalGainLossUsd"]) {
            if (!Number.isFinite(holding[field])) issues.push({ message: (symbol || "A row") + " is missing " + field + ".", row: holding.row });
          }
          if (!Number.isFinite(holding.quantity) || holding.quantity <= 0) issues.push({ message: (symbol || "A row") + " must have a positive share quantity.", row: holding.row });
        });
        duplicateSymbols.forEach((symbol) => issues.push({ message: symbol + " is duplicated.", row: rowBySymbol.get(symbol) }));
        const sums = {
          portfolioTotalUsd: input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.marketValueUsd) ? holding.marketValueUsd : 0), 0) + (Number.isFinite(input.cashUsd) ? input.cashUsd : 0),
          totalCostBasisUsd: input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.totalCostUsd) ? holding.totalCostUsd : 0), 0),
          todayGainLossUsd: input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.todayGainLossUsd) ? holding.todayGainLossUsd : 0), 0),
          totalGainLossUsd: 0
        };
        sums.totalGainLossUsd = calculateTotalGainLoss(sums.portfolioTotalUsd, sums.totalCostBasisUsd);
        totalGainLossInput.value = moneyValue(sums.totalGainLossUsd);
        if (!near(sums.portfolioTotalUsd, input.expectedTotals.portfolioTotalUsd)) flagReconcile("Market values plus cash do not match the displayed portfolio total.");
        if (!near(sums.totalCostBasisUsd, input.expectedTotals.totalCostBasisUsd)) flagReconcile("Total costs do not match the displayed cost basis.");
        if (!near(sums.todayGainLossUsd, input.expectedTotals.todayGainLossUsd)) flagReconcile("Today's gain/loss does not reconcile.");
        rows.querySelectorAll("tr").forEach((row) => row.classList.remove("issue-row"));
        issueRows = [...new Set(issues.map((issue) => issue.row).filter(Boolean))];
        issueRows.forEach((row) => row.classList.add("issue-row"));
        const passed = issues.length === 0;
        approveButton.disabled = !passed;
        validationSummary.innerHTML = renderValidationSummary(input, sums, issues, passed);
        return { passed, issues, sums };
        function flagReconcile(message) {
          for (const holding of input.holdings) {
            issues.push({ message, row: holding.row });
          }
        }
      }
      function renderValidationSummary(input, sums, issues, passed) {
        const confidence = passed ? "High" : issues.length > 2 ? "Low" : "Medium";
        const items = [
          [input.holdings.length > 0, "Holdings detected: " + input.holdings.length],
          [Number.isFinite(input.cashUsd), "Cash detected"],
          [near(sums.portfolioTotalUsd, input.expectedTotals.portfolioTotalUsd), "Market values reconcile"],
          [near(sums.totalCostBasisUsd, input.expectedTotals.totalCostBasisUsd), "Cost basis reconciles"],
          [near(sums.todayGainLossUsd, input.expectedTotals.todayGainLossUsd), "Today's gain/loss reconciles"],
          [Number.isFinite(sums.totalGainLossUsd), "Total gain/loss calculated: " + currency(sums.totalGainLossUsd)]
        ];
        const list = items.map(([ok, label]) => '<li class="' + (ok ? 'ok' : 'warn') + '">' + (ok ? '&#10003; ' : '&#9888; ') + label + '</li>').join("");
        const issueText = issues.length ? '<p class="warn">&#9888; ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') + ' require review: ' + issues.map((issue) => issue.message).slice(0, 3).join(" ") + '</p>' : '<p class="ok">&#10003; Validation passed. Approval is available.</p>';
        const comparisonText = Number.isFinite(screenshotTotalGainLoss) && !near(sums.totalGainLossUsd, screenshotTotalGainLoss) ? '<p class="warn">&#9888; Screenshot summary total gain/loss was ' + currency(screenshotTotalGainLoss) + '; calculated reviewed-row total is ' + currency(sums.totalGainLossUsd) + '. This does not block approval.</p>' : '';
        return '<ul>' + list + '</ul>' + issueText + comparisonText + '<p><strong>Overall confidence:</strong> ' + confidence + '</p>';
      }
      function near(actual, expected) { return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance; }
      function calculateTotalGainLoss(portfolioTotalUsd, totalCostBasisUsd) { return Number.isFinite(portfolioTotalUsd) && Number.isFinite(totalCostBasisUsd) ? portfolioTotalUsd - totalCostBasisUsd : NaN; }
      function moneyValue(value) { return Number.isFinite(value) ? value.toFixed(2) : ""; }
      function currency(value) { return (value < 0 ? "-$" : "$") + Math.abs(value).toFixed(2); }
      function value(row, name) { return row.querySelector("[data-field=" + name + "]")?.value ?? ""; }
      function text(row, name) { return value(row, name).trim(); }
      function numeric(raw) { const value = Number(String(raw).replace(/[$,]/g, "")); return Number.isFinite(value) ? value : NaN; }
      function optionalNumeric(raw) { return String(raw).trim() ? numeric(raw) : null; }
    </script>
  `);
}

export function renderLinkedPortfolioImportApproved(result: LinkedPortfolioImportApprovalResult): Response {
  return htmlPage("Tim Real Watchlist Created", `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Read Only</p>
        <h1>${escapeHtml(result.watchlistName)} Created</h1>
        <p class="lede">${result.holdingCount} reviewed holdings were imported as a read-only baseline. No trades, recommendations, orders, fills, or executions were created.</p>
      </section>
      <section class="panel summary">
        <div><span>Cash</span><strong>${formatCurrency(result.cashUsd)}</strong></div>
        <div><span>Total cost basis</span><strong>${formatCurrency(result.totalCostUsd)}</strong></div>
        <div><span>Market value</span><strong>${formatCurrency(result.currentMarketValueUsd)}</strong></div>
      </section>
      <section class="panel">
        <h2>Create Paper Twin</h2>
        <p>This creates ${escapeHtml(TIM_REAL_TWIN_NAME)} as a separate paper-managed copy linked to ${escapeHtml(TIM_REAL_WATCHLIST_NAME)}. It will not keep synchronizing after creation.</p>
        <div class="actions">
          <label class="secret">Protected action secret<input id="secret" type="password" autocomplete="off"></label>
          <button id="create-twin" type="button">${result.createTwinLabel}</button>
          <a href="/portfolio?portfolioId=${encodeURIComponent(result.watchlistPortfolioId)}">View Read Only Watchlist</a>
        </div>
        <p id="status" class="status" role="status"></p>
      </section>
    </main>
    <script>
      document.getElementById("create-twin").addEventListener("click", async () => {
        const status = document.getElementById("status");
        status.textContent = "Creating paper twin...";
        const response = await fetch("/linked-portfolios/${encodeURIComponent(result.watchlistPortfolioId)}/create-paper-twin", {
          method: "POST",
          headers: { "accept": "application/json", "x-cryptolab-paper-secret": document.getElementById("secret").value }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = body.error || body.message || "Paper twin creation failed.";
          return;
        }
        status.innerHTML = 'Paper twin created. <a href="/portfolio?portfolioId=${encodeURIComponent(TIM_REAL_TWIN_PORTFOLIO_ID)}">View Tim Real Portfolio</a>';
      });
    </script>
  `);
}

function normalizeImportApproval(input: LinkedPortfolioImportApprovalInput): LinkedPortfolioImportApprovalInput {
  if (!Number.isFinite(input.cashUsd) || input.cashUsd < 0) {
    throw new Error("Cash balance must be a non-negative number.");
  }
  if (!Array.isArray(input.holdings) || input.holdings.length === 0) {
    throw new Error("Review and approve at least one holding before creating the watchlist.");
  }
  return {
    cashUsd: input.cashUsd,
    expectedTotals: {
      portfolioTotalUsd: finiteNumber(input.expectedTotals?.portfolioTotalUsd, "Displayed portfolio total"),
      totalCostBasisUsd: finiteNumber(input.expectedTotals?.totalCostBasisUsd, "Displayed cost basis"),
      todayGainLossUsd: finiteNumber(input.expectedTotals?.todayGainLossUsd, "Displayed today's gain/loss"),
      totalGainLossUsd: optionalFinite(input.expectedTotals?.totalGainLossUsd, "Displayed total gain/loss") ?? undefined
    },
    holdings: input.holdings.map((holding) => {
      const symbol = holding.symbol.trim().toUpperCase();
      if (!symbol) {
        throw new Error("Every reviewed holding needs a symbol.");
      }
      const quantity = finitePositive(holding.quantity, `${symbol} shares`);
      const averageCostUsd = finiteNonNegative(holding.averageCostUsd, `${symbol} average cost`);
      const totalCostUsd = finiteNonNegative(holding.totalCostUsd, `${symbol} total cost`);
      const marketValueUsd = finiteNonNegative(holding.marketValueUsd, `${symbol} market value`);
      return {
        symbol,
        companyName: holding.companyName?.trim() ?? "",
        assetClass: holding.assetClass || "stock",
        quantity,
        averageCostUsd,
        totalCostUsd,
        marketValueUsd,
        currentPriceUsd: quantity > 0 ? marketValueUsd / quantity : averageCostUsd,
        todayGainLossUsd: optionalFinite(holding.todayGainLossUsd, `${symbol} today's gain/loss`),
        totalGainLossUsd: optionalFinite(holding.totalGainLossUsd, `${symbol} total gain/loss`),
        dividendIncomeUsd: optionalFinite(holding.dividendIncomeUsd, `${symbol} dividend income`)
      };
    })
  };
}

async function recordImportAudit(db: D1Database, portfolioId: string, validation: LinkedPortfolioImportValidationResult, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  await db.prepare(
    `INSERT INTO journey_events (
      id, event_key, portfolio_id, event_type, timestamp, title, description,
      source, severity, metadata_json, created_at
    ) VALUES (?, ?, ?, 'linked_portfolio_import_approved', ?, 'Linked Portfolio import approved',
      'Screenshot import was reviewed and approved by the user.', 'linked_portfolio_import', 'info', ?, ?)`
  ).bind(
    `journey_${sanitizeForId(portfolioId)}_linked_import_${timestamp.replace(/[^0-9]/g, "")}`,
    `${portfolioId}:linked_import:${timestamp}`,
    portfolioId,
    timestamp,
    JSON.stringify({
      importTimestamp: timestamp,
      importSource: "Screenshot",
      holdingsImported: validation.holdingCount,
      validationPassed: validation.passed,
      userApproved: true
    }),
    timestamp
  ).run();
}

function sumImportValues(input: LinkedPortfolioImportApprovalInput): Required<LinkedPortfolioImportExpectedTotals> {
  const portfolioTotalUsd = input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.marketValueUsd) ? holding.marketValueUsd : 0), 0) + input.cashUsd;
  const totalCostBasisUsd = input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.totalCostUsd) ? holding.totalCostUsd : 0), 0);
  return {
    portfolioTotalUsd,
    totalCostBasisUsd,
    todayGainLossUsd: input.holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.todayGainLossUsd ?? NaN) ? holding.todayGainLossUsd ?? 0 : 0), 0),
    totalGainLossUsd: calculateTotalGainLoss(portfolioTotalUsd, totalCostBasisUsd)
  };
}

function calculateTotalGainLoss(portfolioTotalUsd: number, totalCostBasisUsd: number): number {
  return Number.isFinite(portfolioTotalUsd) && Number.isFinite(totalCostBasisUsd) ? portfolioTotalUsd - totalCostBasisUsd : NaN;
}

function checkTolerance(issues: LinkedPortfolioImportValidationIssue[], actual: number, expected: number, message: string): void {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > 0.05) {
    issues.push({ severity: "error", message });
  }
}

function zeroExpectedTotals(): Required<LinkedPortfolioImportExpectedTotals> {
  return { portfolioTotalUsd: 0, totalCostBasisUsd: 0, todayGainLossUsd: 0, totalGainLossUsd: 0 };
}

function displayField(field: string): string {
  return field.replace(/Usd$/, "").replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function sanitizeForId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
}

function holdingRow(index: number | string, holding?: LinkedPortfolioImportPreviewHolding): string {
  const confidence = holding ? "High confidence" : "";
  return `<tr>
    <td data-confidence="${confidence}"><input data-field="symbol" data-confidence="${confidence}" aria-label="Symbol ${index}" value="${escapeHtml(holding?.symbol ?? "")}"></td>
    <td data-confidence="${confidence}"><input data-field="companyName" data-confidence="${confidence}" aria-label="Company or ETF name ${index}" value="${escapeHtml(holding?.companyName ?? "")}"></td>
    <td data-confidence="${confidence}"><input data-field="quantity" data-confidence="${confidence}" inputmode="decimal" aria-label="Shares ${index}" value="${numberInput(holding?.quantity)}"></td>
    <td data-confidence="${confidence}"><input data-field="averageCostUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Average cost per share ${index}" value="${moneyInput(holding?.averageCostUsd)}"></td>
    <td data-confidence="${confidence}"><input data-field="totalCostUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Total cost ${index}" value="${moneyInput(holding?.totalCostUsd)}"></td>
    <td data-confidence="${confidence}"><input data-field="marketValueUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Market value ${index}" value="${moneyInput(holding?.marketValueUsd)}"></td>
    <td data-confidence="${confidence}"><input data-field="todayGainLossUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Today's gain loss ${index}" value="${signedMoneyInput(holding?.todayGainLossUsd)}"></td>
    <td data-confidence="${confidence}"><input data-field="totalGainLossUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Total gain loss ${index}" value="${signedMoneyInput(holding?.totalGainLossUsd)}"></td>
    <td data-confidence="${confidence}"><input data-field="dividendIncomeUsd" data-confidence="${confidence}" inputmode="decimal" aria-label="Dividend income ${index}" value="${moneyInput(holding?.dividendIncomeUsd)}"></td>
    <td><select data-field="assetClass" aria-label="Asset class ${index}">
      ${assetClassOption("stock", "Stock", holding?.assetClass)}
      ${assetClassOption("etf", "ETF", holding?.assetClass)}
      ${assetClassOption("mutual_fund", "Mutual fund", holding?.assetClass)}
      ${assetClassOption("reit", "REIT", holding?.assetClass)}
      ${assetClassOption("bond_fund", "Bond fund", holding?.assetClass)}
      ${assetClassOption("money_market", "Money market", holding?.assetClass)}
      ${assetClassOption("crypto", "Crypto", holding?.assetClass)}
    </select></td>
  </tr>`;
}

function assetClassOption(value: string, label: string, selected?: string): string {
  return `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`;
}

function numberInput(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function moneyInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : value.toFixed(2);
}

function signedMoneyInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : Object.is(value, -0) ? "0.00" : value.toFixed(2);
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function finiteNumber(value: number | undefined, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be numeric.`);
  }
  return value as number;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function optionalFinite(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be numeric when provided.`);
  }
  return value;
}

function htmlPage(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Kairox</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172018; background: #f6f5f1; }
    body { margin: 0; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    .hero { margin-bottom: 20px; }
    .eyebrow { margin: 0 0 6px; color: #59655c; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 3.4rem); letter-spacing: 0; }
    h2 { margin: 0 0 10px; }
    .lede { max-width: 760px; color: #4e5a52; line-height: 1.55; }
    .notice, .panel { background: #ffffff; border: 1px solid #d8ddd3; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .notice { display: grid; gap: 6px; }
    .validation-card { border: 1px solid #d8ddd3; border-radius: 8px; padding: 14px; margin-bottom: 16px; background: #f9faf6; }
    .validation-card ul { display: grid; gap: 6px; list-style: none; padding: 0; margin: 8px 0; }
    .ok { color: #1f6f50; }
    .warn { color: #a94442; }
    .targets { border-bottom: 1px solid #e3e7df; padding-bottom: 14px; margin-bottom: 14px; }
    .form-row, .actions, .summary { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
    label { display: grid; gap: 6px; color: #4e5a52; font-size: 0.9rem; }
    input, select, button { min-height: 38px; border-radius: 6px; border: 1px solid #bac3b8; padding: 0 10px; font: inherit; }
    button { background: #1f6f50; color: #fff; border-color: #1f6f50; cursor: pointer; }
    a { color: #1f6f50; }
    .secret input { width: 260px; }
    .table-wrap { overflow-x: auto; margin: 16px 0; }
    table { min-width: 1120px; width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #e3e7df; padding: 8px; }
    th { font-size: 0.78rem; color: #59655c; }
    td input, td select { width: 100%; box-sizing: border-box; }
    td[data-confidence]::after { content: attr(data-confidence); display: block; margin-top: 3px; font-size: 0.68rem; color: #68756b; }
    tr.issue-row { background: #fff4f2; outline: 2px solid #d66a5d; outline-offset: -2px; }
    .status { color: #4e5a52; }
    .summary div { min-width: 180px; display: grid; gap: 4px; }
    .summary span { color: #59655c; font-size: 0.86rem; }
    .summary strong { font-size: 1.35rem; }
  </style>
</head>
<body>${body}</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
