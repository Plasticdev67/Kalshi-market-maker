/**
 * Shared types for the Kalshi market maker.
 */

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  status: string;
  close_time: string;
  expiration_time: string;
  result: string;
  category: string;
  asset: string;          // BTC, ETH, SOL, XRP (parsed from ticker)
  seconds_until_close: number;
}

export interface BookLevel {
  price: number;   // cents (1-99)
  size: number;    // number of contracts
}

export interface OrderBook {
  ticker: string;
  yes_bids: BookLevel[];
  yes_asks: BookLevel[];
  no_bids: BookLevel[];
  no_asks: BookLevel[];
  timestamp: number;
}

export interface MarketBook {
  market: KalshiMarket;
  book: OrderBook;
  // Derived
  best_yes_bid: number;
  best_yes_ask: number;
  best_no_bid: number;
  best_no_ask: number;
  combined_bid: number;     // best_yes_bid + best_no_bid (what we pay)
  spread_profit: number;    // 100 - combined_bid - fees (cents)
  min_bid_size: number;     // min liquidity at top of book
}

export interface PairSignal {
  pair_id: string;
  ticker: string;
  asset: string;
  yes_price: number;   // cents
  no_price: number;    // cents
  size: number;        // contracts
  expected_profit: number;  // cents per contract after fees
  market: KalshiMarket;
}

export interface PairRecord {
  pair_id: string;
  ticker: string;
  asset: string;
  target_spread: number;
  status: string;       // open, filled, partial, cancelled
  created_at: number;
  market_question: string;
}

export interface OrderRecord {
  order_id: string;
  pair_id: string;
  ticker: string;
  side: string;         // yes or no
  price: number;        // cents
  size: number;
  status: string;       // open, filled, cancelled
  kalshi_order_id: string | null;
  filled_size: number;
  created_at: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
