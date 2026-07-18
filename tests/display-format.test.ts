import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent
} from "../src/shared/displayFormat.ts";

test("display currency formatting handles signs, separators, zero, and tiny values", () => {
  assert.equal(formatCurrency(2408.7333), "$2,408.73");
  assert.equal(formatSignedCurrency(0.3311), "+$0.33");
  assert.equal(formatSignedCurrency(-6.2196), "-$6.22");
  assert.equal(formatCurrency(0), "$0.00");
  assert.equal(formatCurrency(-0), "$0.00");
  assert.equal(formatSignedCurrency(-0.00001), "> -$0.01");
  assert.equal(formatSignedCurrency(0.004), "< $0.01");
  assert.equal(formatSignedCurrency(-0.004), "> -$0.01");
  assert.equal(formatCurrency(null), "Unavailable");
  assert.equal(formatCurrency(Number.NaN), "Unavailable");
  assert.equal(formatCurrency(Number.POSITIVE_INFINITY), "Unavailable");
});

test("display percent formatting handles signs, negative zero, and tiny values", () => {
  assert.equal(formatPercent(0.55), "55.00%");
  assert.equal(formatSignedPercent(0.003612), "+0.36%");
  assert.equal(formatSignedPercent(-0.012444), "-1.24%");
  assert.equal(formatSignedPercent(-0), "0.00%");
  assert.equal(formatSignedPercent(0.0000004), "< 0.01%");
  assert.equal(formatSignedPercent(-0.0000004), "> -0.01%");
  assert.equal(formatPercent(undefined), "Unavailable");
});

test("display price and quantity formatting adapts for crypto and fractional shares", () => {
  assert.equal(formatPrice(371.1642, { assetType: "etf" }), "$371.16");
  assert.equal(formatPrice(6400.1234, { unit: "index" }), "6,400.12");
  assert.equal(formatPrice(0.00003456, { assetType: "crypto" }), "$0.00003456");
  assert.equal(formatPrice(65000.12345678, { assetType: "crypto" }), "$65,000.12345678");
  assert.equal(formatQuantity(4), "4");
  assert.equal(formatQuantity(1250), "1,250");
  assert.equal(formatQuantity(1.25), "1.25");
  assert.equal(formatQuantity(0.003842), "0.003842");
  assert.equal(formatQuantity(null), "Unavailable");
});
