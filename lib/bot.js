import { clientOrderId } from "./security.js";
import { calculateRiskPlan, normalizeStop } from "./risk.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quotePrice(quoteResponse, side) {
  const quote = quoteResponse?.quote || quoteResponse;
  const price = side === "buy" ? number(quote?.ap) : number(quote?.bp);
  if (!price || price <= 0) throw new Error("Alpaca did not return a usable IEX quote");
  return price;
}

function signedPositionQuantity(position) {
  if (!position) return 0;
  const qty = number(position.qty);
  if (qty === null) throw new Error("Position has invalid quantity");
  return position.side === "short" ? -Math.abs(qty) : Math.abs(qty);
}

function findStopLeg(order) {
  if (!order) return null;
  const candidates = [order, ...(Array.isArray(order.legs) ? order.legs : [])];
  return candidates.find((item) => item && item.stop_price !== null && item.stop_price !== undefined) || null;
}

async function cancelSymbolOrders(client, symbol, dryRun) {
  const orders = (await client.listOpenOrders(symbol)) || [];
  const terminalStatuses = new Set(["filled", "canceled", "expired", "rejected", "replaced"]);
  const flattened = orders.flatMap((order) => [order, ...(Array.isArray(order?.legs) ? order.legs : [])]);
  const cancelable = flattened.filter((order) => order?.id && order?.symbol === symbol && !terminalStatuses.has(order.status));
  const unique = [...new Map(cancelable.map((order) => [order.id, order])).values()];
  if (!dryRun) await Promise.all(unique.map((order) => client.cancelOrder(order.id)));
  return unique.map((order) => order.id);
}

export async function handleEntry(alert, config, client) {
  const id = clientOrderId(alert.tradeId);
  const [account, clock, position, quote, existing] = await Promise.all([
    client.getAccount(),
    client.getClock(),
    client.getPosition(alert.ticker),
    client.getLatestQuote(alert.ticker),
    client.getOrderByClientId(id)
  ]);

  if (existing) {
    return { ok: true, duplicate: true, event: "entry", clientOrderId: id, orderId: existing.id, status: existing.status };
  }
  if (position && signedPositionQuantity(position) !== 0) {
    throw new Error("Entry blocked: Alpaca already has an open SPY position");
  }
  if (!clock?.is_open && !config.dryRun) throw new Error("Entry blocked: US equity market is closed");

  const entryReference = quotePrice(quote, alert.side);
  const buyingPower = number(account.daytrading_buying_power) || number(account.buying_power) || number(account.cash);
  const plan = calculateRiskPlan({
    equity: account.equity,
    entryPrice: entryReference,
    stopPrice: alert.stop,
    entrySide: alert.side,
    buyingPower,
    maxQuantity: config.maxOrderQuantity
  });

  const orderRequest = {
    symbol: alert.ticker,
    qty: String(plan.quantity),
    side: alert.side,
    type: "market",
    time_in_force: "day",
    order_class: "oto",
    client_order_id: id,
    stop_loss: { stop_price: plan.stopPrice.toFixed(2) }
  };

  if (config.dryRun) {
    return { ok: true, dryRun: true, event: "entry", marketOpen: Boolean(clock?.is_open), clientOrderId: id, riskPlan: plan, orderRequest };
  }

  const order = await client.createOrder(orderRequest);
  return {
    ok: true,
    dryRun: false,
    event: "entry",
    clientOrderId: id,
    orderId: order.id,
    status: order.status,
    riskPlan: plan
  };
}

export async function handleMoveStop(alert, config, client) {
  const id = clientOrderId(alert.tradeId);
  const [position, parent, quote] = await Promise.all([
    client.getPosition(alert.ticker),
    client.getOrderByClientId(id),
    client.getLatestQuote(alert.ticker)
  ]);

  const positionQty = signedPositionQuantity(position);
  if (positionQty === 0) return { ok: true, noOp: true, event: "move_stop", reason: "position_already_flat" };
  if (!parent) throw new Error("Cannot locate the Alpaca parent order for this trade_id");

  const hasLegs = Array.isArray(parent.legs) && parent.legs.length > 0;
  const refreshedParent = hasLegs ? parent : await client.getOrderById(parent.id);
  const stopLeg = findStopLeg(refreshedParent);
  if (!stopLeg?.id) throw new Error("Cannot locate the active Alpaca stop leg");

  const isLong = positionQty > 0;
  const expectedSide = isLong ? "sell" : "buy";
  if (alert.side !== expectedSide) throw new Error("Stop side does not match the Alpaca position");

  const currentStop = number(stopLeg.stop_price);
  const newStop = normalizeStop(alert.stop, isLong ? "buy" : "sell");
  if (!currentStop) throw new Error("Active stop leg has no stop price");

  if (isLong && newStop < currentStop) throw new Error("Rejected: long stop cannot move downward");
  if (!isLong && newStop > currentStop) throw new Error("Rejected: short stop cannot move upward");
  if (Math.abs(newStop - currentStop) < 0.005) {
    return { ok: true, noOp: true, event: "move_stop", reason: "stop_already_at_level", stop: currentStop };
  }

  const currentQuote = quotePrice(quote, isLong ? "sell" : "buy");
  if (isLong && newStop >= currentQuote) throw new Error("Rejected: long stop must remain below the current bid");
  if (!isLong && newStop <= currentQuote) throw new Error("Rejected: short stop must remain above the current ask");

  if (config.dryRun) {
    return { ok: true, dryRun: true, event: "move_stop", orderId: stopLeg.id, previousStop: currentStop, newStop };
  }

  const replaced = await client.replaceOrder(stopLeg.id, { stop_price: newStop.toFixed(2) });
  return { ok: true, dryRun: false, event: "move_stop", orderId: replaced.id, previousStop: currentStop, newStop, status: replaced.status };
}

export async function handleFlatten(alert, config, client) {
  const position = await client.getPosition(alert.ticker);
  const canceledOrderIds = await cancelSymbolOrders(client, alert.ticker, config.dryRun);

  if (!position || signedPositionQuantity(position) === 0) {
    return { ok: true, event: alert.event, noOp: true, reason: "position_already_flat", canceledOrderIds };
  }

  const positionQty = signedPositionQuantity(position);
  const expectedExitSide = positionQty > 0 ? "sell" : "buy";
  if (alert.side !== expectedExitSide) throw new Error("Flatten side does not match the Alpaca position");

  if (config.dryRun) {
    return { ok: true, dryRun: true, event: alert.event, positionQty, canceledOrderIds };
  }

  const closeOrder = await client.closePosition(alert.ticker);
  return { ok: true, dryRun: false, event: alert.event, positionQty, canceledOrderIds, closeOrderId: closeOrder?.id, status: closeOrder?.status };
}

export async function executeAlert(alert, config, client) {
  if (!config.botEnabled && !config.dryRun) {
    throw new Error("Bot is disabled");
  }
  if (alert.event === "entry") return handleEntry(alert, config, client);
  if (alert.event === "move_stop") return handleMoveStop(alert, config, client);
  if (alert.event === "stop_filled" || alert.event === "market_close") return handleFlatten(alert, config, client);
  throw new Error("Unsupported event");
}
