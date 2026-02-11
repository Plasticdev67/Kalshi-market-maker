/**
 * Market scanner.
 *
 * Discovers 15-minute crypto up/down markets on Kalshi.
 * Ticker format: KX{ASSET}15M-{date_code}
 * Example: KXBTC15M-26FEB120230  (Feb 12, 2:30 AM)
 */

import { config } from "./config.js";
import { authHeaders } from "./auth.js";
import { log } from "./logger.js";
import type { KalshiMarket } from "./types.js";

const cache = new Map<string, KalshiMarket>();

function parseAsset(ticker: string): string | null {
  // KXBTC15M-... -> BTC
  const upper = ticker.toUpperCase();
  for (const asset of config.assets) {
    if (upper.startsWith(`KX${asset}15M`)) {
      return asset;
    }
  }
  return null;
}

function parseCloseTime(market: { close_time?: string; expiration_time?: string }): Date | null {
  const raw = market.close_time || market.expiration_time;
  if (!raw) return null;
  return new Date(raw);
}

export async function scan(): Promise<KalshiMarket[]> {
  const tradeable: KalshiMarket[] = [];

  for (const asset of config.assets) {
    const seriesTicker = `KX${asset}15M`;

    try {
      const path = "/markets";
      const params = new URLSearchParams({
        limit: "50",
        series_ticker: seriesTicker,
        status: "open",
      });
      const url = `${config.baseUrl}${path}?${params}`;

      const headers = authHeaders("GET", `${path}?${params}`);
      const resp = await fetch(url, {
        method: "GET",
        headers: { ...headers, Accept: "application/json" },
      });

      if (!resp.ok) {
        // If auth fails, try without auth (some endpoints may be public)
        if (resp.status === 401 || resp.status === 403) {
          log("warn", "scanner.auth_required", { asset, status: resp.status });
          continue;
        }
        log("warn", "scanner.api_error", { asset, status: resp.status });
        continue;
      }

      const data = await resp.json() as { markets?: Array<Record<string, unknown>> };
      const markets = data.markets ?? [];

      for (const m of markets) {
        const ticker = m.ticker as string;
        if (!ticker) continue;

        const parsedAsset = parseAsset(ticker);
        if (!parsedAsset) continue;

        const closeTime = parseCloseTime(m as { close_time?: string; expiration_time?: string });
        if (!closeTime) continue;

        const secondsUntilClose = (closeTime.getTime() - Date.now()) / 1000;

        // Skip already expired or about to expire
        if (secondsUntilClose <= config.resolutionBufferSeconds) continue;

        const market: KalshiMarket = {
          ticker,
          event_ticker: (m.event_ticker as string) ?? "",
          title: (m.title as string) ?? "",
          subtitle: (m.subtitle as string) ?? "",
          yes_bid: (m.yes_bid as number) ?? 0,
          yes_ask: (m.yes_ask as number) ?? 0,
          no_bid: (m.no_bid as number) ?? 0,
          no_ask: (m.no_ask as number) ?? 0,
          last_price: (m.last_price as number) ?? 0,
          volume: (m.volume as number) ?? 0,
          open_interest: (m.open_interest as number) ?? 0,
          status: (m.status as string) ?? "open",
          close_time: (m.close_time as string) ?? "",
          expiration_time: (m.expiration_time as string) ?? "",
          result: (m.result as string) ?? "",
          category: "crypto",
          asset: parsedAsset,
          seconds_until_close: secondsUntilClose,
        };

        if (!cache.has(ticker)) {
          log("info", "scanner.new_market", {
            ticker,
            asset: parsedAsset,
            title: market.title,
            seconds_left: Math.round(secondsUntilClose),
          });
        }

        cache.set(ticker, market);
        tradeable.push(market);
      }
    } catch (err) {
      log("error", "scanner.fetch_error", { asset, error: String(err) });
    }
  }

  // Prune expired from cache
  const now = Date.now();
  for (const [ticker, m] of cache) {
    const closeTime = new Date(m.close_time || m.expiration_time);
    if (closeTime.getTime() < now) {
      cache.delete(ticker);
    }
  }

  log("info", "scanner.scan_complete", {
    total_found: tradeable.length,
    cached: cache.size,
  });

  return tradeable;
}

export function getCachedMarket(ticker: string): KalshiMarket | undefined {
  return cache.get(ticker);
}
