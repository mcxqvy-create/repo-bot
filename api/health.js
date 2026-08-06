import { getConfig, PAPER_API_URL } from "../lib/config.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const config = getConfig({ requireCredentials: false });
    return res.status(200).json({
      ok: true,
      service: "spy-ny-open-paper-bot",
      version: "1.0.0",
      paperOnly: config.apiBaseUrl === PAPER_API_URL,
      botEnabled: config.botEnabled,
      dryRun: config.dryRun,
      allowedSymbol: config.allowedSymbol
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error.message });
  }
}
