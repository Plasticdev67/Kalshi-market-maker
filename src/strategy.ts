/**
 * Strategy engine.
 *
 * Evaluates market books and generates pair signals when the spread
 * is wide enough to profit after Kalshi maker fees.
 *
 * Profit per pair = (100 - yes_bid - no_bid) * size - 2 * maker_fee
 * We buy YES at the bid and NO at the bid using post_only limit orders.
 */

import crypto from "node:crypto";
import { config, makerFeeCents } from "./config.js";
import { log } from "./logger.js";
import type { MarketBook, PairSignal } from "./types.js";

export function evaluate(books: MarketBook[]): PairSignal[] {
  const signals: PairSignal[] = [];

  for (const mb of books) {
    const { market, best_yes_bid, best_no_bid, combined_bid, spread_profit, min_bid_size } = mb;

    // Skip if no data on either side
    if (best_yes_bid <= 0 || best_no_bid <= 0) continue;

    // Skip markets too close to resolution (prices already directional)
    if (market.seconds_until_close < 600) {
      log("debug", "strategy.skip_near_expiry", {
        ticker: market.ticker,
        seconds_left: Math.round(market.seconds_until_close),
      });
      continue;
    }

    // Skip lopsided markets (one side nearly worthless = near resolution)
    // Both sides must be >= 10c for a balanced market
    if (best_yes_bid < 10 || best_no_bid < 10) {
      log("debug", "strategy.skip_lopsided", {
        ticker: market.ticker,
        yes_bid: best_yes_bid,
        no_bid: best_no_bid,
      });
      continue;
    }

    // Combined bids must be >= 85c (realistic market making territory)
    if (combined_bid < 85) {
      log("debug", "strategy.skip_thin", {
        ticker: market.ticker,
        combined_bid,
      });
      continue;
    }

    // Skip if not enough liquidity
    if (min_bid_size <= 0) continue;

    // Calculate fees for our position
    const feeYes = makerFeeCents(best_yes_bid, 1);
    const feeNo = makerFeeCents(best_no_bid, 1);
    const totalFeePerContract = feeYes + feeNo;

    // Net profit per contract (cents)
    const netProfitPerContract = spread_profit - totalFeePerContract;

    // Skip if spread doesn't cover fees + minimum threshold
    if (netProfitPerContract < config.minSpreadThreshold) continue;

    // Size calculation
    const maxByExposure = Math.floor(
      (config.maxExposurePerMarket * 100) / combined_bid,
    );
    const size = Math.min(
      config.orderSizeDefault,
      maxByExposure,
      min_bid_size,
    );

    if (size <= 0) continue;

    const pairId = `p_${crypto.randomBytes(6).toString("hex")}`;

    const signal: PairSignal = {
      pair_id: pairId,
      ticker: market.ticker,
      asset: market.asset,
      yes_price: best_yes_bid,
      no_price: best_no_bid,
      size,
      expected_profit: netProfitPerContract * size,
      market,
    };

    log("info", "strategy.signal", {
      pair_id: pairId,
      asset: market.asset,
      ticker: market.ticker,
      yes_price: best_yes_bid,
      no_price: best_no_bid,
      spread: spread_profit,
      fees: Math.round(totalFeePerContract * 100) / 100,
      net_profit: Math.round(netProfitPerContract * 100) / 100,
      size,
    });

    signals.push(signal);
  }

  if (signals.length > 0) {
    log("info", "strategy.signals", {
      count: signals.length,
      markets: signals.map(s => s.asset),
    });
  }

  return signals;
}
