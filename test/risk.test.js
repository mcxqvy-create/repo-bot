import test from "node:test";
import assert from "node:assert/strict";
import { calculateRiskPlan, riskBudgetForEquity } from "../lib/risk.js";

test("risk stays at $1,000 at and below the starting balance", () => {
  assert.equal(riskBudgetForEquity(100000), 1000);
  assert.equal(riskBudgetForEquity(90000), 1000);
});

test("risk becomes one percent above the starting balance", () => {
  assert.equal(riskBudgetForEquity(105000), 1050);
  assert.equal(riskBudgetForEquity(120000), 1200);
});

test("long size is risk dollars divided by entry-to-stop distance", () => {
  const plan = calculateRiskPlan({ equity: 100000, entryPrice: 600, stopPrice: 597.5, entrySide: "buy", buyingPower: 400000, maxQuantity: 100000 });
  assert.equal(plan.quantity, 400);
  assert.equal(plan.estimatedRisk, 1000);
});

test("short size uses stop above entry", () => {
  const plan = calculateRiskPlan({ equity: 105000, entryPrice: 600, stopPrice: 602.5, entrySide: "sell", buyingPower: 500000, maxQuantity: 100000 });
  assert.equal(plan.quantity, 420);
  assert.equal(plan.estimatedRisk, 1050);
});

test("quantity is capped by broker buying power", () => {
  const plan = calculateRiskPlan({ equity: 100000, entryPrice: 600, stopPrice: 599.5, entrySide: "buy", buyingPower: 120000, maxQuantity: 100000 });
  assert.equal(plan.quantity, 200);
  assert.equal(plan.cappedByBuyingPower, true);
});
