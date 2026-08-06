import test from "node:test";
import assert from "node:assert/strict";
import { handleEntry, handleMoveStop } from "../lib/bot.js";

const baseConfig = { dryRun: true, maxOrderQuantity: 100000 };

test("dry-run entry recalculates quantity from Alpaca equity and attaches an OTO stop", async () => {
  const client = {
    getAccount: async () => ({ equity: "100000", daytrading_buying_power: "400000" }),
    getClock: async () => ({ is_open: true }),
    getPosition: async () => null,
    getLatestQuote: async () => ({ quote: { ap: 600, bp: 599.99 } }),
    getOrderByClientId: async () => null
  };
  const alert = { event: "entry", ticker: "SPY", tradeId: "SPY-1", side: "buy", stop: 597.5 };
  const result = await handleEntry(alert, baseConfig, client);

  assert.equal(result.dryRun, true);
  assert.equal(result.riskPlan.quantity, 400);
  assert.equal(result.riskPlan.estimatedRisk, 1000);
  assert.equal(result.orderRequest.order_class, "oto");
  assert.deepEqual(result.orderRequest.stop_loss, { stop_price: "597.50" });
});

test("duplicate entry is a harmless no-op", async () => {
  const client = {
    getAccount: async () => ({ equity: "100000" }),
    getClock: async () => ({ is_open: true }),
    getPosition: async () => null,
    getLatestQuote: async () => ({ quote: { ap: 600, bp: 599.99 } }),
    getOrderByClientId: async () => ({ id: "existing-order", status: "filled" })
  };
  const result = await handleEntry({ event: "entry", ticker: "SPY", tradeId: "SPY-1", side: "buy", stop: 597.5 }, baseConfig, client);
  assert.equal(result.duplicate, true);
  assert.equal(result.orderId, "existing-order");
});

test("long stop cannot move backward", async () => {
  const client = {
    getPosition: async () => ({ qty: "400", side: "long" }),
    getOrderByClientId: async () => ({ id: "parent", legs: [{ id: "stop-leg", symbol: "SPY", stop_price: "600.00", status: "new" }] }),
    getLatestQuote: async () => ({ quote: { ap: 605.01, bp: 605 } })
  };
  await assert.rejects(
    () => handleMoveStop({ event: "move_stop", ticker: "SPY", tradeId: "SPY-1", side: "sell", stop: 599.5 }, baseConfig, client),
    /cannot move downward/
  );
});
