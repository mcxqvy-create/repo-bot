const PAPER_API_URL = "https://paper-api.alpaca.markets";

function boolEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function positiveNumber(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

export function getConfig({ requireCredentials = true } = {}) {
  const apiBaseUrl = (process.env.APCA_API_BASE_URL || PAPER_API_URL).replace(/\/$/, "");
  if (apiBaseUrl !== PAPER_API_URL) {
    throw new Error("Safety block: APCA_API_BASE_URL must be the Alpaca paper endpoint");
  }

  const config = {
    apiKey: process.env.APCA_API_KEY_ID || "",
    apiSecret: process.env.APCA_API_SECRET_KEY || "",
    apiBaseUrl,
    dataBaseUrl: (process.env.APCA_DATA_BASE_URL || "https://data.alpaca.markets").replace(/\/$/, ""),
    webhookSecret: process.env.TRADINGVIEW_WEBHOOK_SECRET || "",
    botEnabled: boolEnv(process.env.BOT_ENABLED, false),
    dryRun: boolEnv(process.env.DRY_RUN, true),
    allowedSymbol: (process.env.ALLOWED_SYMBOL || "SPY").toUpperCase(),
    maxAlertAgeSeconds: positiveNumber(process.env.MAX_ALERT_AGE_SECONDS, 900, "MAX_ALERT_AGE_SECONDS"),
    maxOrderQuantity: Math.floor(positiveNumber(process.env.MAX_ORDER_QUANTITY, 100000, "MAX_ORDER_QUANTITY"))
  };

  if (config.allowedSymbol !== "SPY") {
    throw new Error("Safety block: this bot only permits SPY");
  }
  if (config.webhookSecret.length < 24) {
    throw new Error("TRADINGVIEW_WEBHOOK_SECRET must contain at least 24 characters");
  }
  if (requireCredentials && (!config.apiKey || !config.apiSecret)) {
    throw new Error("Missing Alpaca paper API credentials");
  }

  return config;
}

export { PAPER_API_URL };
