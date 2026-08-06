const NY_TIMEZONE = "America/New_York";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nyParts(value) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function normalizeBar(bar) {
  const timestamp = Date.parse(bar?.t);
  const normalized = {
    timestamp,
    time: bar?.t,
    open: number(bar?.o),
    high: number(bar?.h),
    low: number(bar?.l),
    close: number(bar?.c),
    volume: number(bar?.v)
  };
  if (!Number.isFinite(timestamp) || [normalized.open, normalized.high, normalized.low, normalized.close, normalized.volume].some((v) => v === null)) {
    return null;
  }
  return normalized;
}

export function analyzeSession(rawBars, config, now = Date.now()) {
  const nowMs = new Date(now).getTime();
  const sessionDate = nyParts(nowMs).date;
  const bars = rawBars
    .map(normalizeBar)
    .filter(Boolean)
    .filter((bar) => {
      const time = nyParts(bar.timestamp);
      const regular = (time.hour === 9 && time.minute >= 30) || (time.hour > 9 && time.hour < 16);
      return time.date === sessionDate && regular && bar.timestamp + FIVE_MINUTES_MS <= nowMs;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const openingTimes = new Set(["9:30", "9:35", "9:40"]);
  const openingBars = bars.filter((bar) => {
    const time = nyParts(bar.timestamp);
    return openingTimes.has(`${time.hour}:${time.minute}`);
  });
  if (openingBars.length !== 3) {
    return { ready: false, reason: "opening_range_incomplete", sessionDate, completedBars: bars.length };
  }

  const openingHigh = Math.max(...openingBars.map((bar) => bar.high));
  const openingLow = Math.min(...openingBars.map((bar) => bar.low));
  const openingRange = openingHigh - openingLow;
  let cumulativeVolume = 0;
  let cumulativeTypicalValue = 0;

  for (const bar of bars) {
    cumulativeVolume += bar.volume;
    cumulativeTypicalValue += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    const time = nyParts(bar.timestamp);
    const afterOpeningRange = time.hour > 9 || (time.hour === 9 && time.minute >= 45);
    if (!afterOpeningRange) continue;

    const longBreakout = bar.close > openingHigh && bar.close > bar.open;
    const shortBreakout = bar.close < openingLow && bar.close < bar.open;
    if (!longBreakout && !shortBreakout) continue;

    const direction = longBreakout ? "long" : "short";
    const side = longBreakout ? "buy" : "sell";
    const vwap = cumulativeVolume > 0 ? cumulativeTypicalValue / cumulativeVolume : null;
    const vwapDistancePct = vwap ? Math.abs(bar.close - vwap) / vwap * 100 : null;
    const rangeValid = openingRange <= config.maxOpeningRange;
    const vwapValid = vwapDistancePct !== null && vwapDistancePct >= config.minVwapDistance && vwapDistancePct <= config.maxVwapDistance;
    const vwapSideValid = vwap !== null && (longBreakout ? bar.close > vwap : bar.close < vwap);
    const accepted = rangeValid && vwapValid && vwapSideValid;
    const barCloseTime = bar.timestamp + FIVE_MINUTES_MS;

    return {
      ready: true,
      accepted,
      reason: accepted ? "accepted" : "first_breakout_rejected",
      sessionDate,
      direction,
      side,
      exitSide: longBreakout ? "sell" : "buy",
      tradeId: `SPY-${sessionDate}-${bar.timestamp}`,
      signalBarTime: bar.timestamp,
      barCloseTime,
      signalAgeSeconds: Math.max(0, (nowMs - barCloseTime) / 1000),
      signalClose: bar.close,
      originalStop: longBreakout ? openingLow : openingHigh,
      openingHigh,
      openingLow,
      openingRange,
      vwap,
      vwapDistancePct,
      checks: { rangeValid, vwapValid, vwapSideValid }
    };
  }

  return {
    ready: true,
    accepted: false,
    reason: "no_breakout_yet",
    sessionDate,
    openingHigh,
    openingLow,
    openingRange
  };
}

export function trailingStop({ direction, entryPrice, originalStop, bars }) {
  const entry = number(entryPrice);
  const initialStop = number(originalStop);
  if (!entry || !initialStop) throw new Error("Cannot calculate trailing stop without entry and initial stop");
  const risk = Math.abs(entry - initialStop);
  if (risk <= 0) throw new Error("Initial risk must be positive");

  const normalizedBars = bars.map(normalizeBar).filter(Boolean);
  const bestPrice = direction === "long"
    ? Math.max(entry, ...normalizedBars.map((bar) => bar.high))
    : Math.min(entry, ...normalizedBars.map((bar) => bar.low));
  const favorableMove = direction === "long" ? bestPrice - entry : entry - bestPrice;
  const reachedSteps = Math.floor((favorableMove / risk + 1e-9) / 0.5);
  if (reachedSteps < 1) return { reachedSteps, stop: initialStop, risk, bestPrice, shouldMove: false };

  const lockedR = (reachedSteps - 1) * 0.5;
  const stop = direction === "long" ? entry + lockedR * risk : entry - lockedR * risk;
  return { reachedSteps, stop, risk, bestPrice, shouldMove: true };
}

export { FIVE_MINUTES_MS, NY_TIMEZONE };
