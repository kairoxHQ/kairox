const MONEY_SCALE = 1_000_000;

export function toMoneyUnits(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * MONEY_SCALE);
}

export function fromMoneyUnits(value: number): number {
  return roundMoney(value / MONEY_SCALE);
}

export function addMoney(...values: number[]): number {
  return fromMoneyUnits(values.reduce((sum, value) => sum + toMoneyUnits(value), 0));
}

export function subtractMoney(left: number, right: number): number {
  return fromMoneyUnits(toMoneyUnits(left) - toMoneyUnits(right));
}

export function multiplyMoney(value: number, multiplier: number): number {
  return fromMoneyUnits(Math.round(toMoneyUnits(value) * multiplier));
}

export function divideMoney(left: number, right: number): number {
  if (!Number.isFinite(right) || right === 0) {
    return 0;
  }
  return roundMoney(left / right);
}

export function pctChange(start: number, end: number): number {
  if (!Number.isFinite(start) || start === 0) {
    return 0;
  }
  return roundRatio((end - start) / start);
}

export function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function roundRatio(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}
