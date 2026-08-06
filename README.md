# SPY NY Open Autonomous Paper Bot

This project receives JSON alerts from the supplied TradingView Pine strategy and executes them in an **Alpaca Paper Trading** account. It is hard-blocked to Alpaca's paper API and to the SPY symbol.

## What it does

- Recalculates position size from Alpaca's actual paper equity.
- Risks $1,000 while equity is at or below $100,000.
- Risks 1% of current equity when equity is above $100,000.
- Rounds down to whole shares and caps quantity at available buying power.
- Creates entries as OTO orders with an attached broker-side stop.
- Only moves stops in the profitable direction.
- Reconciles stop exits and closes remaining positions at market close.
- Uses deterministic client order IDs to make duplicate entry alerts harmless.
- Rejects stale alerts, wrong symbols, wrong directions and live API endpoints.

## 1. Create the Alpaca paper account

1. Create an Alpaca Paper Only account.
2. Reset its starting balance to $100,000.
3. Generate paper API keys.
4. Do not use this account for manual SPY trades.

## 2. Test locally

Install Node.js 20 or newer, then run:

```bash
npm test
npm run check
```

Copy `.env.example` to `.env.local` and add your paper credentials. Keep:

```text
BOT_ENABLED=false
DRY_RUN=true
```

Never commit `.env.local`.

## 3. Deploy to Vercel

1. Create a private GitHub repository and upload this project's files.
2. Import the repository into Vercel.
3. In Vercel, open **Settings > Environment Variables**.
4. Add every variable shown in `.env.example` for Production.
5. Generate `TRADINGVIEW_WEBHOOK_SECRET` with at least 32 random characters.
6. Deploy.
7. Open `https://YOUR-PROJECT.vercel.app/api/health`.

Expected safe response:

```json
{
  "ok": true,
  "paperOnly": true,
  "botEnabled": false,
  "dryRun": true,
  "allowedSymbol": "SPY"
}
```

## 4. Test the webhook in dry-run mode

The alert's `bar_time` must be a current Unix time in milliseconds. Example:

```bash
curl -X POST "https://YOUR-PROJECT.vercel.app/api/tradingview?secret=YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event":"entry","strategy":"spy_ny_open_vwap","trade_id":"manual-test-1","ticker":"SPY","side":"buy","qty":10,"risk_cash":1000,"stop":599.00,"bar_time":REPLACE_WITH_CURRENT_MILLISECONDS}'
```

With `DRY_RUN=true`, the response shows the proposed Alpaca request but submits nothing. Dry-run entry tests also work while the market is closed; the response reports `marketOpen: false`.

## 5. Enable paper execution

Only after dry-run testing, change Vercel variables to:

```text
BOT_ENABLED=true
DRY_RUN=false
```

Redeploy. Verify `/api/health` again. It must still show `paperOnly: true`.

## 6. Create the TradingView alert

1. Use a standard SPY 5-minute candlestick chart.
2. Add the current `SPY NY Open + VWAP Bot Strategy`.
3. Enable TradingView two-factor authentication.
4. Create an alert on the strategy.
5. Choose **Order fills and alert() function calls**.
6. Webhook URL:

```text
https://YOUR-PROJECT.vercel.app/api/tradingview?secret=YOUR_SECRET
```

7. Alert message:

```text
{{strategy.order.alert_message}}
```

8. Choose the longest available expiration and create the alert.

TradingView runs a server-side copy of the strategy. Delete and recreate the alert after changing the Pine code or any strategy input.

## Event behavior

| Event | Bot action |
|---|---|
| `entry` | Checks market/account/position, calculates risk from Alpaca equity and sends a market OTO entry with a stop. |
| `move_stop` | Finds the OTO stop leg and replaces it only if the new stop tightens risk. |
| `stop_filled` | Cancels remaining SPY orders and closes only a still-open residual SPY position. |
| `market_close` | Cancels SPY orders and closes the SPY position. |

## Safety notes

- This project intentionally refuses any Alpaca URL except `https://paper-api.alpaca.markets`.
- It cannot place live trades without source-code changes.
- A broker-side OTO stop is attached at entry; do not remove it manually.
- Alpaca and TradingView can fill at slightly different prices. The bot therefore sizes from Alpaca equity and the current Alpaca IEX quote.
- When buying power cannot support the full risk-based quantity, the bot reduces quantity instead of exceeding buying power.
- Review Vercel logs, TradingView's alert log, and Alpaca's Orders page during every initial test.
