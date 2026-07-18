export interface DisplayNumberOptions {
  unavailable?: string;
}

export interface CurrencyFormatOptions extends DisplayNumberOptions {
  signed?: boolean;
  currency?: string;
}

export interface PercentFormatOptions extends DisplayNumberOptions {
  signed?: boolean;
}

export interface PriceFormatOptions extends DisplayNumberOptions {
  assetType?: string | null;
  unit?: "usd" | "index" | "percent" | string;
}

const DEFAULT_UNAVAILABLE = "Unavailable";
const CENT = 0.01;
const PERCENT_BASIS_POINT = 0.0001;

export function formatCurrency(value: number | null | undefined, options: CurrencyFormatOptions = {}): string {
  const number = finiteNumber(value);
  if (number === null) {
    return options.unavailable ?? DEFAULT_UNAVAILABLE;
  }
  if (Object.is(number, -0) || number === 0) {
    return `${options.signed ? "" : ""}${currencyPrefix(options.currency)}0.00`;
  }
  if (Math.abs(number) < CENT) {
    return number > 0 ? `< ${currencyPrefix(options.currency)}0.01` : `> -${currencyPrefix(options.currency)}0.01`;
  }
  const normalized = normalizeZero(number, CENT / 2);
  const sign = options.signed ? normalized > 0 ? "+" : "-" : normalized < 0 ? "-" : "";
  return `${sign}${currencyPrefix(options.currency)}${formatFixed(Math.abs(normalized), 2)}`;
}

export function formatSignedCurrency(value: number | null | undefined, options: CurrencyFormatOptions = {}): string {
  return formatCurrency(value, { ...options, signed: true });
}

export function formatPercent(value: number | null | undefined, options: PercentFormatOptions = {}): string {
  const number = finiteNumber(value);
  if (number === null) {
    return options.unavailable ?? DEFAULT_UNAVAILABLE;
  }
  if (Object.is(number, -0) || number === 0) {
    return "0.00%";
  }
  if (Math.abs(number) < PERCENT_BASIS_POINT) {
    return number > 0 ? "< 0.01%" : "> -0.01%";
  }
  const pct = normalizeZero(number * 100, 0.005);
  const sign = options.signed ? pct > 0 ? "+" : "-" : pct < 0 ? "-" : "";
  return `${sign}${formatFixed(Math.abs(pct), 2)}%`;
}

export function formatSignedPercent(value: number | null | undefined, options: PercentFormatOptions = {}): string {
  return formatPercent(value, { ...options, signed: true });
}

export function formatPrice(value: number | null | undefined, options: PriceFormatOptions = {}): string {
  const number = finiteNumber(value);
  if (number === null) {
    return options.unavailable ?? DEFAULT_UNAVAILABLE;
  }
  if (options.unit === "percent") {
    return `${formatAdaptiveDecimal(number, 2, 4)}%`;
  }
  if (options.unit === "index") {
    return formatFixed(normalizeZero(number, 0.005), 2);
  }
  if (options.assetType === "crypto") {
    return `${currencyPrefix()}${formatAdaptiveDecimal(number, 2, 8)}`;
  }
  if (Math.abs(number) > 0 && Math.abs(number) < CENT) {
    return number > 0 ? `< ${currencyPrefix()}0.01` : `> -${currencyPrefix()}0.01`;
  }
  return `${number < 0 ? "-" : ""}${currencyPrefix()}${formatFixed(Math.abs(normalizeZero(number, CENT / 2)), 2)}`;
}

export function formatQuantity(value: number | null | undefined, options: DisplayNumberOptions = {}): string {
  const number = finiteNumber(value);
  if (number === null) {
    return options.unavailable ?? DEFAULT_UNAVAILABLE;
  }
  const normalized = normalizeZero(number, 0.0000000005);
  return formatAdaptiveDecimal(normalized, 0, 8);
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeZero(value: number, threshold: number): number {
  return Math.abs(value) < threshold ? 0 : value;
}

function currencyPrefix(currency = "USD"): string {
  return currency === "USD" ? "$" : `${currency} `;
}

function formatFixed(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatAdaptiveDecimal(value: number, minFractionDigits: number, maxFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits
  }).format(value);
}
