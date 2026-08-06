import test from "node:test";
import assert from "node:assert/strict";
import { clientOrderId, safeEqual, validateAlert } from "../lib/security.js";

const config = { allowedSymbol: "SPY", maxAlertAgeSeconds: 900 };
const now = 1_800_000_000_000;

test("client order IDs are deterministic and Alpaca-safe length", () => {
  const first = clientOrderId("SPY-123");
  assert.equal(first, clientOrderId("SPY-123"));
  assert.notEqual(first, clientOrderId("SPY-124"));
  assert.ok(first.length <= 48);
});

test("constant-time secret comparison returns expected result", () => {
  assert.equal(safeEqual("correct-secret", "correct-secret"), true);
  assert.equal(safeEqual("correct-secret", "wrong-secret"), false);
});

test("valid entry alert is accepted", () => {
  const alert = validateAlert({ event: "entry", ticker: "SPY", trade_id: "SPY-1", side: "buy", stop: 599, bar_time: now - 300000 }, config, now);
  assert.equal(alert.event, "entry");
  assert.equal(alert.stop, 599);
});

test("wrong symbols and stale alerts are rejected", () => {
  assert.throws(() => validateAlert({ event: "entry", ticker: "QQQ", trade_id: "x", side: "buy", stop: 1, bar_time: now }, config, now), /Rejected symbol/);
  assert.throws(() => validateAlert({ event: "entry", ticker: "SPY", trade_id: "x", side: "buy", stop: 1, bar_time: now - 901000 }, config, now), /Stale/);
});
