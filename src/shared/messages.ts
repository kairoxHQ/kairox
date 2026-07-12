const TECHNICAL_PATTERNS = [
  /Illegal invocation/i,
  /https?:\/\/\S+/i,
  /HTTP \d{3}/i,
  /stack/i,
  /Cloudflare/i,
  /fallback failed/i,
  /browser verification/i
];

export function userMessageForMarketData(symbol: string, reason?: string): string {
  const text = reason ?? "";
  if (/stale/i.test(text)) {
    return `${symbol} evaluation deferred because the latest quote was stale.`;
  }

  if (/market.*closed|stock-market hours|regular US/i.test(text)) {
    return "Market is closed; no stock trade was allowed.";
  }

  return "Market data temporarily unavailable; no trade was made.";
}

export function sanitizeForUser(message: string | null | undefined, fallback = "No action was taken."): string {
  if (!message) {
    return fallback;
  }

  if (TECHNICAL_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }

  return message;
}

export function isTechnicalMessage(message: string | null | undefined): boolean {
  return !!message && TECHNICAL_PATTERNS.some((pattern) => pattern.test(message));
}
