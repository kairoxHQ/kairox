import type { AssetClass } from "../shared/types.ts";
import type { MarketHoursMode } from "./assets.ts";

export function canExecuteAt(
  assetClass: AssetClass,
  now: Date,
  marketHoursMode: MarketHoursMode = defaultMarketHoursMode(assetClass)
): { allowed: boolean; reason?: string } {
  if (marketHoursMode === "disabled") {
    return { allowed: false, reason: "This asset is disabled for paper execution." };
  }

  if (marketHoursMode === "continuous") {
    return { allowed: true };
  }

  if (marketHoursMode === "us_regular") {
    return isRegularUsMarketHours(now)
      ? { allowed: true }
      : { allowed: false, reason: "Regular US market hours are closed, so this paper execution is blocked." };
  }

  if (marketHoursMode === "fund_end_of_day") {
    return isRegularUsMarketHours(now)
      ? { allowed: true }
      : { allowed: false, reason: "Fund paper execution is limited to regular US market hours and end-of-day pricing." };
  }

  if (marketHoursMode === "cash_equivalent") {
    return { allowed: false, reason: "Cash-equivalent assets are tracked but not opened by the paper strategy." };
  }

  return { allowed: false, reason: "This asset class is not enabled for paper execution yet." };
}

function defaultMarketHoursMode(assetClass: AssetClass): MarketHoursMode {
  if (assetClass === "crypto") {
    return "continuous";
  }
  if (assetClass === "stock" || assetClass === "etf" || assetClass === "reit" || assetClass === "bond_fund") {
    return "us_regular";
  }
  if (assetClass === "mutual_fund") {
    return "fund_end_of_day";
  }
  return "cash_equivalent";
}

export function isRegularUsMarketHours(now: Date): boolean {
  const eastern = partsInTimeZone(now, "America/New_York");
  const day = eastern.weekday;
  if (day === 0 || day === 6) {
    return false;
  }

  const minutes = eastern.hour * 60 + eastern.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function partsInTimeZone(date: Date, timeZone: string): { weekday: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const weekdayText = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[weekdayText] ?? 0, hour, minute };
}
