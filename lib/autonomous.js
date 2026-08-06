import { handleEntry, handleFlatten, handleMoveStop } from "./bot.js";
import { clientOrderId } from "./security.js";
import { analyzeSession, trailingStop } from "./strategy.js";

const MINUTE_MS = 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function barsFrom(response) {
  return Array.isArray(response?.bars) ? response.bars : [];
}

function signedPositionQuantity(position) {
  if (!position) return 0;
  const qty = number(position.qty);
  if (qty === null) throw new Error("Position has invalid quantity");
  return position.side === "short" ? -Math.abs(qty) : Math.abs(qty);
}

function currentExitPrice(quoteResponse, direction) {
  const quote = quoteResponse?.quote || quoteResponse;
  const price = direction === "long" ? number(quote?.bp) : number(quote?.ap);
  if (!price || price <= 0) throw new Error("Alpaca did not return a usable IEX quote");
  return price;
}

function lookbackStart(nowMs) {
  return new Date(nowMs - 20 * 60 * 60 * 1000).toISOString();
}

export async function runAutonomous(config, client, now = Date.now()) {
  if (!config.botEnabled && !config.dryRun) throw new Error("Bot is disabled");

  const nowMs = new Date(now).getTime();
  const [clock, position] = await Promise.all([
    client.getClock(),
    client.getPosition(config.allowedSymbol)
  ]);
  const positionQty = signedPositionQuantity(position);
  const nextCloseMs = Date.parse(clock?.next_close);
  const closeWindow = Number.isFinite(nextCloseMs) && nowMs >= nextCloseMs - config.closeBeforeMinutes * MINUTE_MS;

  if (clock?.is_open && closeWindow) {
    if (positionQty === 0) {
      return { ok: true, noOp: true, action: "close_window", reason: "position_already_flat", marketOpen: true };
    }
    const result = await handleFlatten({
      event: "market_close",
      ticker: config.allowedSymbol,
      tradeId: `SPY-close-${nowMs}`,
      side: positionQty > 0 ? "sell" : "buy"
    }, config, client);
    return { ...result, action: "market_close_flatten" };
  }

  if (!clock?.is_open) {
    return {
      ok: true,
      noOp: true,
      action: "market_closed",
      reason: positionQty === 0 ? "market_closed" : "market_closed_with_open_position",
      marketOpen: false,
      nextOpen: clock?.next_open || null
    };
  }

  const end = new Date(nowMs).toISOString();
  const fiveMinuteResponse = await client.getBars(config.allowedSymbol, {
    timeframe: "5Min",
    start: lookbackStart(nowMs),
    end
  });
  const fiveMinuteBars = barsFrom(fiveMinuteResponse);
  const newestTimestamp = Math.max(...fiveMinuteBars.map((bar) => Date.parse(bar?.t)).filter(Number.isFinite));
  const dataLagSeconds = Number.isFinite(newestTimestamp)
    ? Math.max(0, (nowMs - (newestTimestamp + 5 * MINUTE_MS)) / 1000)
    : null;
  const dataFreshness = { dataLagSeconds, maxDataLagSeconds: config.maxDataLagSeconds, feed: "iex" };
  if (dataLagSeconds === null || dataLagSeconds > config.maxDataLagSeconds) {
    return {
      ok: true,
      noOp: true,
      action: "stale_market_data",
      reason: "latest_iex_bar_is_too_old",
      marketOpen: true,
      dataFreshness
    };
  }

  const signal = analyzeSession(fiveMinuteBars, config, nowMs);

  if (positionQty === 0) {
    if (!signal.accepted) {
      return { ok: true, noOp: true, action: "scan", marketOpen: true, dataFreshness, signal };
    }
    if (signal.signalAgeSeconds > config.maxSignalDelaySeconds) {
      return { ok: true, noOp: true, action: "scan", marketOpen: true, reason: "signal_too_old", dataFreshness, signal };
    }

    const result = await handleEntry({
      event: "entry",
      ticker: config.allowedSymbol,
      tradeId: signal.tradeId,
      side: signal.side,
      stop: signal.originalStop
    }, config, client);
    return { ...result, action: "entry", dataFreshness, signal };
  }

  if (!signal.accepted) {
    return {
      ok: true,
      noOp: true,
      action: "manage_position",
      reason: "open_position_does_not_match_today_accepted_signal",
      dataFreshness,
      signal
    };
  }

  const direction = positionQty > 0 ? "long" : "short";
  if (direction !== signal.direction) {
    throw new Error("Open SPY position direction does not match today's strategy signal");
  }

  const parent = await client.getOrderByClientId(clientOrderId(signal.tradeId));
  if (!parent) {
    return { ok: true, noOp: true, action: "manage_position", reason: "strategy_parent_order_not_found", dataFreshness, signal };
  }

  const filledAtMs = Date.parse(parent.filled_at || parent.updated_at || new Date(signal.barCloseTime).toISOString());
  const oneMinuteResponse = await client.getBars(config.allowedSymbol, {
    timeframe: "1Min",
    start: new Date(Number.isFinite(filledAtMs) ? filledAtMs : signal.barCloseTime).toISOString(),
    end
  });
  const trail = trailingStop({
    direction,
    entryPrice: position.avg_entry_price,
    originalStop: signal.originalStop,
    bars: barsFrom(oneMinuteResponse)
  });

  if (!trail.shouldMove) {
    return { ok: true, noOp: true, action: "manage_position", reason: "next_half_r_not_reached", dataFreshness, trail, signal };
  }

  const quote = await client.getLatestQuote(config.allowedSymbol);
  const exitPrice = currentExitPrice(quote, direction);
  const targetAlreadyCrossed = direction === "long" ? trail.stop >= exitPrice : trail.stop <= exitPrice;
  if (targetAlreadyCrossed) {
    const result = await handleFlatten({
      event: "stop_filled",
      ticker: config.allowedSymbol,
      tradeId: signal.tradeId,
      side: signal.exitSide,
      stop: trail.stop
    }, config, client);
    return { ...result, action: "polling_stop_flatten", dataFreshness, trail, exitPrice, signal };
  }

  const result = await handleMoveStop({
    event: "move_stop",
    ticker: config.allowedSymbol,
    tradeId: signal.tradeId,
    side: signal.exitSide,
    stop: trail.stop
  }, config, client);
  return { ...result, action: "move_stop", dataFreshness, trail, signal };
}
