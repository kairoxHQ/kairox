import type { AssetClass } from "../shared/types.ts";
import type { MarketHoursMode } from "./assets.ts";

const TIMEZONE = "America/New_York";
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_CLOSE_MINUTES = 13 * 60;

export type UsEquityMarketPhase = "pre_market" | "regular" | "after_hours" | "weekend" | "holiday";

export interface UsEquityMarketSession {
  date: string;
  openMinutes: number;
  closeMinutes: number;
  earlyClose: boolean;
  holidayName?: string;
}

export interface UsEquityMarketStatus {
  phase: UsEquityMarketPhase;
  marketDate: string;
  isTradingDay: boolean;
  isRegularOpen: boolean;
  isEarlyClose: boolean;
  holidayName?: string;
  currentSession: UsEquityMarketSession | null;
  nextSession: UsEquityMarketSession;
  message: string;
}

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
  const status = getUsEquityMarketStatus(now);
  if (!status.isTradingDay) {
    return false;
  }
  const minutes = partsInTimeZone(now, TIMEZONE).minutes;
  return minutes >= REGULAR_OPEN_MINUTES && minutes < status.currentSession!.closeMinutes;
}

export function getUsEquityMarketStatus(now: Date): UsEquityMarketStatus {
  const eastern = partsInTimeZone(now, TIMEZONE);
  const marketDate = eastern.date;
  const currentSession = sessionForDate(marketDate);
  const nextSession = nextTradingSession(marketDate, currentSession && eastern.minutes < currentSession.openMinutes ? 0 : 1);

  if (!currentSession) {
    const holidayName = holidayNameForDate(marketDate);
    const weekend = eastern.weekday === 0 || eastern.weekday === 6;
    const phase: UsEquityMarketPhase = holidayName ? "holiday" : "weekend";
    return {
      phase,
      marketDate,
      isTradingDay: false,
      isRegularOpen: false,
      isEarlyClose: false,
      holidayName: holidayName ?? undefined,
      currentSession: null,
      nextSession,
      message: closedMessage(phase, holidayName, nextSession)
    };
  }

  if (eastern.minutes < currentSession.openMinutes) {
    return {
      phase: "pre_market",
      marketDate,
      isTradingDay: true,
      isRegularOpen: false,
      isEarlyClose: currentSession.earlyClose,
      currentSession,
      nextSession: currentSession,
      message: preMarketMessage(now, currentSession)
    };
  }

  if (eastern.minutes < currentSession.closeMinutes) {
    return {
      phase: "regular",
      marketDate,
      isTradingDay: true,
      isRegularOpen: true,
      isEarlyClose: currentSession.earlyClose,
      currentSession,
      nextSession: nextTradingSession(marketDate, 1),
      message: currentSession.earlyClose
        ? `Markets close early today at ${formatEtTime(currentSession.closeMinutes)}.`
        : `Markets are open. Regular trading ends at ${formatEtTime(currentSession.closeMinutes)}.`
    };
  }

  return {
    phase: "after_hours",
    marketDate,
    isTradingDay: true,
    isRegularOpen: false,
    isEarlyClose: currentSession.earlyClose,
    currentSession,
    nextSession,
    message: afterHoursMessage(currentSession, nextSession)
  };
}

export function isUsEquityMarketHoliday(marketDate: string): boolean {
  return holidayNameForDate(marketDate) !== null;
}

export function usEquityHolidayName(marketDate: string): string | null {
  return holidayNameForDate(marketDate);
}

function sessionForDate(date: string): UsEquityMarketSession | null {
  const weekday = weekdayForDate(date);
  if (weekday === 0 || weekday === 6) {
    return null;
  }
  const holidayName = holidayNameForDate(date);
  if (holidayName) {
    return null;
  }
  return {
    date,
    openMinutes: REGULAR_OPEN_MINUTES,
    closeMinutes: EARLY_CLOSES[date] ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES,
    earlyClose: Boolean(EARLY_CLOSES[date])
  };
}

function nextTradingSession(fromDate: string, dayOffset: number): UsEquityMarketSession {
  let date = addDays(fromDate, dayOffset);
  for (let guard = 0; guard < 14; guard += 1) {
    const session = sessionForDate(date);
    if (session) {
      return session;
    }
    date = addDays(date, 1);
  }
  throw new Error("Unable to locate next U.S. equities trading session.");
}

function preMarketMessage(now: Date, session: UsEquityMarketSession): string {
  const minutesUntilOpen = Math.round((etDateTimeToUtc(session.date, session.openMinutes).getTime() - now.getTime()) / 60000);
  if (minutesUntilOpen > 0 && minutesUntilOpen <= 60) {
    return `Markets open in ${minutesUntilOpen} minute${minutesUntilOpen === 1 ? "" : "s"}.`;
  }
  return `Markets open today at ${formatEtTime(session.openMinutes)}.`;
}

function afterHoursMessage(currentSession: UsEquityMarketSession, nextSession: UsEquityMarketSession): string {
  const prefix = currentSession.earlyClose ? `Markets closed early today at ${formatEtTime(currentSession.closeMinutes)}. ` : "";
  if (nextSession.date === addDays(currentSession.date, 1)) {
    return `${prefix}Markets reopen tomorrow at ${formatEtTime(nextSession.openMinutes)}.`;
  }
  return `${prefix}Markets reopen ${formatSessionDay(nextSession.date)} at ${formatEtTime(nextSession.openMinutes)}.`;
}

function closedMessage(phase: "weekend" | "holiday", holidayName: string | null, nextSession: UsEquityMarketSession): string {
  if (phase === "holiday") {
    return `U.S. markets are closed today for ${holidayName ?? "a market holiday"}. They reopen ${formatSessionDay(nextSession.date)} at ${formatEtTime(nextSession.openMinutes)}.`;
  }
  return `U.S. markets are closed for the weekend. They reopen ${formatSessionDay(nextSession.date)} at ${formatEtTime(nextSession.openMinutes)}.`;
}

function holidayNameForDate(date: string): string | null {
  return HOLIDAYS[date] ?? null;
}

function formatEtTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period} ET`;
}

function formatSessionDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00.000Z`));
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekdayForDate(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function etDateTimeToUtc(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  let candidate = new Date(Date.UTC(year, month - 1, day, hour + 5, minute));
  for (let guard = 0; guard < 4; guard += 1) {
    const parts = partsInTimeZone(candidate, TIMEZONE);
    const deltaMinutes = parts.date === date ? minutes - parts.minutes : 24 * 60;
    if (parts.date === date && parts.minutes === minutes) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + deltaMinutes * 60000);
  }
  return candidate;
}

function partsInTimeZone(date: Date, timeZone: string): { date: string; weekday: number; hour: number; minute: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const weekdayText = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${year}-${month}-${day}`, weekday: weekdays[weekdayText] ?? 0, hour, minute, minutes: hour * 60 + minute };
}

const HOLIDAYS: Record<string, string> = {
  "2025-01-01": "New Year's Day",
  "2025-01-20": "Martin Luther King, Jr. Day",
  "2025-02-17": "Washington's Birthday",
  "2025-04-18": "Good Friday",
  "2025-05-26": "Memorial Day",
  "2025-06-19": "Juneteenth National Independence Day",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving Day",
  "2025-12-25": "Christmas Day",
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King, Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth National Independence Day",
  "2026-07-03": "Independence Day observed",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-01-18": "Martin Luther King, Jr. Day",
  "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth National Independence Day observed",
  "2027-07-05": "Independence Day observed",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day observed",
  "2028-01-17": "Martin Luther King, Jr. Day",
  "2028-02-21": "Washington's Birthday",
  "2028-04-14": "Good Friday",
  "2028-05-29": "Memorial Day",
  "2028-06-19": "Juneteenth National Independence Day",
  "2028-07-04": "Independence Day",
  "2028-09-04": "Labor Day",
  "2028-11-23": "Thanksgiving Day",
  "2028-12-25": "Christmas Day"
};

const EARLY_CLOSES: Record<string, true> = {
  "2025-07-03": true,
  "2025-11-28": true,
  "2025-12-24": true,
  "2026-11-27": true,
  "2026-12-24": true,
  "2027-11-26": true,
  "2028-07-03": true,
  "2028-11-24": true
};
