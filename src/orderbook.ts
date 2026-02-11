/**
 * Order book monitor.
 *
 * Primary: WebSocket for real-time deltas.
 * Fallback: REST polling if WebSocket unavailable.
 *
 * Kalshi WebSocket channels:
 *   - orderbook_delta: real-time book updates
 *   - fill: fill notifications
 */

import WebSocket from "ws";
import { config } from "./config.js";
import { authHeaders } from "./auth.js";
import { log } from "./logger.js";
import type { KalshiMarket, MarketBook, OrderBook, BookLevel } from "./types.js";

const books = new Map<string, OrderBook>();

// ---- REST fallback (always works) ----

async function fetchBookRest(ticker: string): Promise<OrderBook | null> {
  try {
    const path = `/markets/${ticker}/orderbook`;
    const url = `${config.baseUrl}${path}`;
    const headers = authHeaders("GET", path);

    const resp = await fetch(url, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
    });

    if (!resp.ok) {
      log("debug", "orderbook.rest_error", { ticker, status: resp.status });
      return null;
    }

    const data = await resp.json() as {
      orderbook?: {
        yes?: Array<[number, number]>;
        no?: Array<[number, number]>;
      };
    };

    const ob = data.orderbook;
    if (!ob) return null;

    // Kalshi returns [[price, size], ...] sorted by price
    // For YES: bids are buyers (descending), asks implicit from NO side
    // Actually Kalshi gives YES and NO sides directly
    const yesLevels = (ob.yes ?? []).map(([price, size]) => ({ price, size }));
    const noLevels = (ob.no ?? []).map(([price, size]) => ({ price, size }));

    // YES bids = YES levels, YES asks = derived from NO bids (100 - no_bid)
    // NO bids = NO levels, NO asks = derived from YES bids (100 - yes_bid)
    const book: OrderBook = {
      ticker,
      yes_bids: yesLevels.filter(l => l.size > 0),
      yes_asks: noLevels.map(l => ({ price: 100 - l.price, size: l.size })).filter(l => l.size > 0),
      no_bids: noLevels.filter(l => l.size > 0),
      no_asks: yesLevels.map(l => ({ price: 100 - l.price, size: l.size })).filter(l => l.size > 0),
      timestamp: Date.now(),
    };

    // Sort: bids descending, asks ascending
    book.yes_bids.sort((a, b) => b.price - a.price);
    book.yes_asks.sort((a, b) => a.price - b.price);
    book.no_bids.sort((a, b) => b.price - a.price);
    book.no_asks.sort((a, b) => a.price - b.price);

    books.set(ticker, book);
    return book;
  } catch (err) {
    log("error", "orderbook.rest_fetch_error", { ticker, error: String(err) });
    return null;
  }
}

// ---- Public API ----

export async function fetchBooks(markets: KalshiMarket[]): Promise<MarketBook[]> {
  const results: MarketBook[] = [];

  // Fetch all books in parallel
  const fetches = markets.map(async (market) => {
    const book = await fetchBookRest(market.ticker);
    if (!book) return null;

    const bestYesBid = book.yes_bids[0]?.price ?? 0;
    const bestYesAsk = book.yes_asks[0]?.price ?? 100;
    const bestNoBid = book.no_bids[0]?.price ?? 0;
    const bestNoAsk = book.no_asks[0]?.price ?? 100;

    const combinedBid = bestYesBid + bestNoBid;  // what we pay in cents
    const spreadProfit = 100 - combinedBid;        // gross profit in cents

    const minBidSize = Math.min(
      book.yes_bids[0]?.size ?? 0,
      book.no_bids[0]?.size ?? 0,
    );

    return {
      market,
      book,
      best_yes_bid: bestYesBid,
      best_yes_ask: bestYesAsk,
      best_no_bid: bestNoBid,
      best_no_ask: bestNoAsk,
      combined_bid: combinedBid,
      spread_profit: spreadProfit,
      min_bid_size: minBidSize,
    } satisfies MarketBook;
  });

  const settled = await Promise.all(fetches);
  for (const mb of settled) {
    if (mb) results.push(mb);
  }

  return results;
}

export function getBook(ticker: string): OrderBook | undefined {
  return books.get(ticker);
}
