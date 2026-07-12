import type { AssetClass } from "../shared/types.ts";

export function canExecuteAt(assetClass: AssetClass, now: Date): { allowed: boolean; reason?: string } {
  if (assetClass === "crypto") {
    return { allowed: true };
  }

  if (assetClass === "stock" || assetClass === "etf") {
    return isRegularUsMarketHours(now)
      ? { allowed: true }
      : { allowed: false, reason: "Regular US stock-market hours are closed, so stock and ETF paper executions are blocked." };
  }

  return { allowed: false, reason: "This asset class is not enabled for paper execution yet." };
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
