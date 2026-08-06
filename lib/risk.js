export function riskBudgetForEquity(equity) {
  const value = Number(equity);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid account equity");
  return value > 100000 ? value * 0.01 : 1000;
}

export function normalizeStop(stop, entrySide) {
  const cents = Number(stop) * 100;
  if (!Number.isFinite(cents) || cents <= 0) throw new Error("Invalid stop price");
  // A long entry has a sell stop below price; floor prevents rounding it upward.
  // A short entry has a buy stop above price; ceil prevents rounding it downward.
  const rounded = entrySide === "buy" ? Math.floor(cents + 1e-8) : Math.ceil(cents - 1e-8);
  return rounded / 100;
}

export function calculateRiskPlan({ equity, entryPrice, stopPrice, entrySide, buyingPower, maxQuantity }) {
  const entry = Number(entryPrice);
  const stop = normalizeStop(stopPrice, entrySide);
  const power = Number(buyingPower);
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("Invalid entry reference price");
  if (!Number.isFinite(power) || power <= 0) throw new Error("Invalid buying power");
  if (entrySide !== "buy" && entrySide !== "sell") throw new Error("Invalid entry side");

  const riskPerShare = entrySide === "buy" ? entry - stop : stop - entry;
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    throw new Error("Stop must be below a long entry and above a short entry");
  }

  const riskBudget = riskBudgetForEquity(equity);
  const riskQuantity = Math.floor(riskBudget / riskPerShare);
  const buyingPowerPrice = entrySide === "sell" ? entry * 1.03 : entry;
  const buyingPowerQuantity = Math.floor(power / buyingPowerPrice);
  const quantity = Math.min(riskQuantity, buyingPowerQuantity, maxQuantity);

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Risk plan produced a zero-share order");
  }

  return {
    quantity,
    riskBudget: Number(riskBudget.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(4)),
    estimatedRisk: Number((quantity * riskPerShare).toFixed(2)),
    entryReference: Number(entry.toFixed(4)),
    stopPrice: Number(stop.toFixed(2)),
    cappedByBuyingPower: quantity < riskQuantity,
    requestedRiskQuantity: riskQuantity,
    buyingPowerQuantity
  };
}
