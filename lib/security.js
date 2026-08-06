import crypto from "node:crypto";

const EVENTS = new Set(["entry", "move_stop", "stop_filled", "market_close"]);

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clientOrderId(tradeId) {
  const digest = crypto.createHash("sha256").update(String(tradeId)).digest("hex").slice(0, 24);
  return `tv-spy-${digest}`;
}

export function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  throw new Error("Request body must be valid JSON");
}

export function validateAlert(payload, config, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Alert must be a JSON object");
  }

  const event = String(payload.event || "");
  const ticker = String(payload.ticker || "").toUpperCase();
  const tradeId = String(payload.trade_id || "");
  const side = String(payload.side || "").toLowerCase();
  const barTime = Number(payload.bar_time);
  const stop = payload.stop === null || payload.stop === undefined ? null : Number(payload.stop);

  if (!EVENTS.has(event)) throw new Error("Unsupported event");
  if (ticker !== config.allowedSymbol) throw new Error("Rejected symbol");
  if (!tradeId || tradeId.length > 200) throw new Error("Invalid trade_id");
  if (!Number.isFinite(barTime) || barTime <= 0) throw new Error("Invalid bar_time");

  const ageMs = now - barTime;
  if (ageMs < -60_000 || ageMs > config.maxAlertAgeSeconds * 1000) {
    throw new Error("Stale or future-dated alert");
  }

  if (event === "entry") {
    if (side !== "buy" && side !== "sell") throw new Error("Entry side must be buy or sell");
    if (!Number.isFinite(stop) || stop <= 0) throw new Error("Entry requires a valid stop");
  }
  if (event === "move_stop" || event === "stop_filled") {
    if (side !== "buy" && side !== "sell") throw new Error("Exit side must be buy or sell");
    if (!Number.isFinite(stop) || stop <= 0) throw new Error(`${event} requires a valid stop`);
  }
  if (event === "market_close" && side !== "buy" && side !== "sell") {
    throw new Error("Market-close side must be buy or sell");
  }

  return { event, ticker, tradeId, side, barTime, stop };
}
