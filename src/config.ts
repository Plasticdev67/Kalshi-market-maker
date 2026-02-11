/**
 * Configuration loaded from .env
 */

import "dotenv/config";

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? Number(v) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

export const config = {
  // Mode
  paperTrade: envBool("PAPER_TRADE", true),
  tradingEnabled: envBool("TRADING_ENABLED", true),

  // Kalshi credentials
  apiKey: envStr("KALSHI_API_KEY", ""),
  privateKeyPath: envStr("KALSHI_PRIVATE_KEY_PATH", "./kalshi_private_key.pem"),

  // API URLs -- always use production for market data (public, no auth needed)
  // Demo API returns stale/incorrect data. Only use demo for order placement.
  baseUrl: "https://api.elections.kalshi.com/trade-api/v2",
  orderUrl: envBool("PAPER_TRADE", true)
    ? "https://demo-api.kalshi.co/trade-api/v2"
    : "https://api.elections.kalshi.com/trade-api/v2",
  wsUrl: "wss://api.elections.kalshi.com/trade-api/ws/v2",

  // Spread & sizing -- aggressive for paper trading data collection
  minSpreadThreshold: envNum("MIN_SPREAD_THRESHOLD", 1),  // cents (was 3)
  orderSizeDefault: envNum("ORDER_SIZE_DEFAULT", 25),      // contracts (was 10)
  maxExposurePerMarket: envNum("MAX_EXPOSURE_PER_MARKET", 200),  // (was 50)
  maxTotalExposure: envNum("MAX_TOTAL_EXPOSURE", 5000),    // dollars (was 500)

  // Timing
  pairTimeoutSeconds: envNum("PAIR_TIMEOUT_SECONDS", 45),  // (was 60)
  resolutionBufferSeconds: envNum("RESOLUTION_BUFFER_SECONDS", 120),
  cancelDeadlineSeconds: envNum("CANCEL_DEADLINE_SECONDS", 90),
  scanIntervalSeconds: envNum("SCAN_INTERVAL_SECONDS", 10),  // (was 15)

  // Risk -- very lenient for paper mode data collection
  maxOneSidedFillsBeforeHalt: envNum("MAX_ONE_SIDED_FILLS_BEFORE_HALT", 50),  // (was 3)

  // Assets
  assets: envStr("ASSETS", "BTC,ETH,SOL,XRP").split(",").map(a => a.trim()),

  // Ticker prefix for 15-min markets
  tickerPrefix15m: "KX",      // e.g. KXBTC15M
  tickerSuffix15m: "15M",

  // Alerts
  telegramBotToken: envStr("TELEGRAM_BOT_TOKEN", ""),
  telegramChatId: envStr("TELEGRAM_CHAT_ID", ""),

  // Dashboard
  dashboardPort: envNum("DASHBOARD_PORT", 8052),

  // Database
  dbPath: envStr("DB_PATH", "kalshi_mm.db"),

  // Logging
  logLevel: envStr("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",
} as const;

// Kalshi fee calculation
// Maker fee = round_up(0.0175 * contracts * price * (1 - price))
// Price is in dollars (0-1), but we work in cents internally
export function makerFeeCents(priceInCents: number, contracts: number): number {
  const p = priceInCents / 100;
  return Math.ceil(0.0175 * contracts * p * (1 - p) * 100) / 100;
}

export function takerFeeCents(priceInCents: number, contracts: number): number {
  const p = priceInCents / 100;
  return Math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100;
}
