import { AlpacaClient, AlpacaError } from "../lib/alpaca.js";
import { executeAlert } from "../lib/bot.js";
import { getConfig } from "../lib/config.js";
import { parseBody, safeEqual, validateAlert } from "../lib/security.js";

function statusFor(error) {
  if (error instanceof SyntaxError) return 400;
  if (error instanceof AlpacaError) return error.status >= 400 && error.status < 500 ? 422 : 502;
  const message = String(error?.message || "");
  if (message.includes("disabled")) return 503;
  if (message.includes("blocked") || message.includes("Rejected") || message.includes("already")) return 409;
  return 400;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const config = getConfig();
    const suppliedSecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret;
    if (!safeEqual(suppliedSecret, config.webhookSecret)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const alert = validateAlert(parseBody(req), config);
    const client = new AlpacaClient(config);
    const result = await executeAlert(alert, config, client);
    return res.status(200).json(result);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: error?.message || "Unknown error",
      alpacaStatus: error instanceof AlpacaError ? error.status : undefined,
      alpacaDetails: error instanceof AlpacaError ? error.details : undefined
    }));
    return res.status(statusFor(error)).json({ ok: false, error: error?.message || "Unknown error" });
  }
}
