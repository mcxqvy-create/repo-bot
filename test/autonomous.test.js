import test from "node:test";
import assert from "node:assert/strict";
import { runAutonomous } from "../lib/autonomous.js";

const config = {
  botEnabled: false,
  dryRun: true,
  allowedSymbol: "SPY",
  maxOrderQuantity: 100000,
  maxOpeningRange: 2.4,
  minVwapDistance: 0,
  maxVwapDistance: 1,
  maxSignalDelaySeconds: 180,
  maxDataLagSeconds: 420,
  closeBeforeMinutes: 5
};

const bars = [
  { t: "2026-08-05T13:30:00.000Z", o: 99.4, h: 100, l: 99, c: 99.6, v: 1000 },
  { t: "2026-08-05T13:35:00.000Z", o: 99.6, h: 99.9, l: 99.2, c: 99.5, v: 1000 },
  { t: "2026-08-05T13:40:00.000Z", o: 99.5, h: 99.8, l: 99.1, c: 99.7, v: 1000 },
  { t: "2026-08-05T13:45:00.000Z", o: 99.8, h: 100.3, l: 99.7, c: 100.1, v: 1000 }
];

test("autonomous scan creates the same risk-sized dry-run OTO entry", async () => {
  let positionCalls = 0;
  const client = {
    getClock: async () => ({ is_open: true, next_close: "2026-08-05T20:00:00.000Z" }),
    getPosition: async () => { positionCalls += 1; return null; },
    getBars: async () => ({ bars }),
    getAccount: async () => ({ equity: "100000", daytrading_buying_power: "400000" }),
    getLatestQuote: async () => ({ quote: { ap: 100.1, bp: 100.09 } }),
    getOrderByClientId: async () => null
  };

  const result = await runAutonomous(config, client, "2026-08-05T13:51:00.000Z");
  assert.equal(result.action, "entry");
  assert.equal(result.dryRun, true);
  assert.equal(result.orderRequest.stop_loss.stop_price, "99.00");
  assert.equal(result.riskPlan.riskBudget, 1000);
  assert.equal(positionCalls, 2);
});

test("autonomous scan does nothing outside market hours", async () => {
  const client = {
    getClock: async () => ({ is_open: false, next_open: "2026-08-06T13:30:00.000Z" }),
    getPosition: async () => null
  };
  const result = await runAutonomous(config, client, "2026-08-05T22:00:00.000Z");
  assert.equal(result.action, "market_closed");
  assert.equal(result.noOp, true);
});
