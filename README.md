# SPY NY Open Autonomous Paper Bot

This is a zero-recurring-cost automation path for the supplied SPY strategy. TradingView is optional and is used only for charting/backtests. A free cron-job.org schedule calls the Vercel endpoint once per minute; the endpoint reads Alpaca IEX bars, evaluates the strategy, and manages Alpaca Paper orders.

The code is hard-blocked to `https://paper-api.alpaca.markets` and `SPY`.

## Strategy implemented by the server

- SPY regular session, New York time.
- Opening range is exactly the 09:30, 09:35, and 09:40 five-minute bars.
- Maximum opening range: 2.40 points.
- Only the first confirmed directional-body breakout from 09:45 onward is considered.
- Entry requires the closing price to be on the correct side of anchored session VWAP and 0.05%–0.15% away from it.
- Initial stop is the opposite end of the opening range.
- At +0.5R, stop moves to breakeven. Every additional +0.5R raises/lowers the stop another 0.5R.
- The position is flattened five minutes before the regular-session close.
- Risk is $1,000 when equity is at or below $100,000; above $100,000 it is 1% of current equity.

## Safety and execution behavior

- Entries use an OTO order with a broker-side stop already attached.
- Quantity is rounded down to whole shares and capped by buying power.
- Deterministic client order IDs make repeated scheduler calls harmless.
- The bot never loosens an existing stop.
- `BOT_ENABLED=false` plus `DRY_RUN=true` calculates and reports actions without placing orders.
- Do not make manual SPY trades in the same Alpaca paper account.

## 1. Upload and deploy

1. Extract the ZIP.
2. Create a private GitHub repository and upload the contents of `spy-paper-bot` (not the outer folder).
3. In Vercel, choose **Add New > Project**, import that repository, and deploy it.
4. In the Vercel project, open **Settings > Environment Variables**.
5. Add the variables below to **Production** and redeploy.

```text
APCA_API_KEY_ID=YOUR_ALPACA_PAPER_KEY
APCA_API_SECRET_KEY=YOUR_ALPACA_PAPER_SECRET
APCA_API_BASE_URL=https://paper-api.alpaca.markets
APCA_DATA_BASE_URL=https://data.alpaca.markets
AUTOMATION_SECRET=AT_LEAST_32_RANDOM_CHARACTERS
BOT_ENABLED=false
DRY_RUN=true
ALLOWED_SYMBOL=SPY
MAX_ALERT_AGE_SECONDS=900
MAX_ORDER_QUANTITY=100000
MAX_OPENING_RANGE=2.40
MIN_VWAP_DISTANCE=0.05
MAX_VWAP_DISTANCE=0.15
MAX_SIGNAL_DELAY_SECONDS=180
MAX_DATA_LAG_SECONDS=420
CLOSE_BEFORE_MINUTES=5
```

If you already set `TRADINGVIEW_WEBHOOK_SECRET`, you can initially use that same value as `AUTOMATION_SECRET`. Never put Alpaca keys in the scheduler URL.

Generate a new automation secret in PowerShell:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

## 2. Verify Vercel

Use the exact production domain shown under Vercel **Settings > Domains**. Do not use an old deployment URL that redirects, because that was the cause of the earlier HTTP 308 response.

Open:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

Expected fields include:

```json
{
  "ok": true,
  "version": "2.0.0",
  "mode": "autonomous-alpaca-polling",
  "paperOnly": true,
  "botEnabled": false,
  "dryRun": true,
  "allowedSymbol": "SPY",
  "schedulerConfigured": true
}
```

Then test one autonomous scan in PowerShell:

```powershell
$BotUrl = "https://YOUR-PROJECT.vercel.app"
$AutomationSecret = "YOUR_AUTOMATION_SECRET"
Invoke-RestMethod -Uri "$BotUrl/api/run?secret=$AutomationSecret" -Method Get
```

Outside market hours, `action` should be `market_closed`. During the opening-range period it will normally be `scan` with `opening_range_incomplete` or `no_breakout_yet`. A valid fresh signal returns a proposed `entry` while dry-run is enabled.

## 3. Create the free once-per-minute schedule

1. Create a free account at [cron-job.org](https://cron-job.org/).
2. Open **Cronjobs > Create cronjob**.
3. Title it `SPY paper bot`.
4. Use this URL, with your real values:

```text
https://YOUR-PROJECT.vercel.app/api/run?secret=YOUR_AUTOMATION_SECRET
```

5. Set execution to **Every minute**.
6. Keep the request method as **GET**.
7. Save it, enable it, then use **Test run**.
8. Check the execution history for HTTP 200 responses.

The endpoint itself checks Alpaca's market clock, so calls at night, on weekends, and on exchange holidays are harmless no-ops. The secret in the URL is sensitive: do not share screenshots of the complete cron URL.

## 4. Observe dry-run, then enable paper orders

Keep these safe values for at least one market session:

```text
BOT_ENABLED=false
DRY_RUN=true
```

Review cron-job.org execution history and Vercel **Logs**. When the first breakout appears, verify that the response's direction, opening range, VWAP distance, stop, quantity, and risk budget match your chart.

When satisfied, change the Vercel Production variables to:

```text
BOT_ENABLED=true
DRY_RUN=false
```

Redeploy, open `/api/health`, and confirm `paperOnly: true`, `botEnabled: true`, and `dryRun: false`. The next valid setup can then place an Alpaca Paper order autonomously.

## What scheduler responses mean

| `action` | Meaning |
|---|---|
| `market_closed` | No action; Alpaca says the regular market is closed. |
| `scan` | The bot evaluated today but has no fresh accepted signal. |
| `stale_market_data` | Alpaca's newest IEX bar is too old, so the bot fails closed and places nothing. |
| `entry` | A risk-sized OTO entry was proposed or submitted. |
| `manage_position` | Position exists, but the next 0.5R level has not been reached. |
| `move_stop` | The broker-side stop was tightened to the latest 0.5R level. |
| `polling_stop_flatten` | Price was already through the newly calculated stop when polled, so the bot flattened. |
| `market_close_flatten` | The bot closed the position before the regular-session close. |

## Important limitation of the zero-cost version

The scheduler checks once per minute, not on every market tick. The initial stop is broker-side and remains active continuously, but a newly earned 0.5R trailing level may be recognized up to roughly one minute late. A fast move can therefore fill worse than a tick-driven system. If the market is already beyond the newly earned stop when a poll arrives, the bot sends a flatten request instead of placing an invalid stop.

The free Alpaca feed used here is IEX-only, while a TradingView chart may use consolidated market data. Opening-range, VWAP, volume, and breakout values can therefore differ. The response includes `dataFreshness`; if Alpaca does not supply a recent bar, the bot returns `stale_market_data` and refuses to enter rather than trading an old signal.

The legacy `/api/tradingview` endpoint remains in the project but is not needed for this setup.

## Local verification

With Node.js 20 or newer:

```bash
npm test
npm run check
```
