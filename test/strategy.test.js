import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSession, trailingStop } from "../lib/strategy.js";

const config = { maxOpeningRange: 2.4, minVwapDistance: 0, maxVwapDistance: 1 };

function bar(time, open, high, low, close, volume = 1000) {
  return { t: time, o: open, h: high, l: low, c: close, v: volume };
}

const opening = [
  bar("2026-08-05T13:30:00.000Z", 99.4, 100, 99, 99.6),
  bar("2026-08-05T13:35:00.000Z", 99.6, 99.9, 99.2, 99.5),
  bar("2026-08-05T13:40:00.000Z", 99.5, 99.8, 99.1, 99.7)
];

test("accepts the first confirmed directional breakout and uses the opposite range end", () => {
  const bars = [...opening, bar("2026-08-05T13:45:00.000Z", 99.8, 100.3, 99.7, 100.1)];
  const result = analyzeSession(bars, config, "2026-08-05T13:51:00.000Z");

  assert.equal(result.accepted, true);
  assert.equal(result.direction, "long");
  assert.equal(result.originalStop, 99);
  assert.equal(result.signalAgeSeconds, 60);
});

test("a rejected first breakout prevents a later breakout from becoming the signal", () => {
  const bars = [
    ...opening,
    bar("2026-08-05T13:45:00.000Z", 99.8, 100.5, 99.7, 100.4),
    bar("2026-08-05T13:50:00.000Z", 100.4, 100.8, 100.3, 100.7)
  ];
  const result = analyzeSession(bars, { ...config, maxOpeningRange: 0.5 }, "2026-08-05T13:56:00.000Z");

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "first_breakout_rejected");
  assert.equal(result.signalClose, 100.4);
});

test("half-R stair-step moves to breakeven, then locks another half-R", () => {
  const atHalfR = trailingStop({
    direction: "long",
    entryPrice: 100,
    originalStop: 98,
    bars: [bar("2026-08-05T14:00:00.000Z", 100, 101, 99.9, 100.8)]
  });
  assert.equal(atHalfR.stop, 100);

  const atOneR = trailingStop({
    direction: "long",
    entryPrice: 100,
    originalStop: 98,
    bars: [bar("2026-08-05T14:00:00.000Z", 100, 102, 99.9, 101.8)]
  });
  assert.equal(atOneR.stop, 101);
});
