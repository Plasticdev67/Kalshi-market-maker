/**
 * Order executor.
 *
 * Places and cancels orders on Kalshi.
 * Paper mode: simulates placement with DB writes.
 * Live mode: calls Kalshi REST API with post_only flag.
 */

import crypto from "node:crypto";
import { config } from "./config.js";
import { authHeaders, hasCredentials } from "./auth.js";
import { log } from "./logger.js";
import * as db from "./db.js";
import type { PairSignal } from "./types.js";

export async function placePair(signal: PairSignal): Promise<boolean> {
  const now = Date.now() / 1000;
  const yesOrderId = `o_${crypto.randomBytes(6).toString("hex")}`;
  const noOrderId = `o_${crypto.randomBytes(6).toString("hex")}`;

  // Insert pair into DB
  db.insertPair({
    pair_id: signal.pair_id,
    ticker: signal.ticker,
    asset: signal.asset,
    target_spread: signal.expected_profit,
    status: "open",
    created_at: now,
    market_question: signal.market.title,
  });

  if (config.paperTrade) {
    // Paper mode: just record the orders as open
    db.insertOrder({
      order_id: yesOrderId,
      pair_id: signal.pair_id,
      ticker: signal.ticker,
      side: "yes",
      price: signal.yes_price,
      size: signal.size,
      status: "open",
      kalshi_order_id: null,
      filled_size: 0,
      created_at: now,
    });

    db.insertOrder({
      order_id: noOrderId,
      pair_id: signal.pair_id,
      ticker: signal.ticker,
      side: "no",
      price: signal.no_price,
      size: signal.size,
      status: "open",
      kalshi_order_id: null,
      filled_size: 0,
      created_at: now,
    });

    log("info", "executor.pair_placed", {
      pair_id: signal.pair_id,
      asset: signal.asset,
      yes_price: signal.yes_price,
      no_price: signal.no_price,
      size: signal.size,
      paper: true,
    });

    db.logEvent("pair_placed", {
      pair_id: signal.pair_id,
      ticker: signal.ticker,
      yes_price: signal.yes_price,
      no_price: signal.no_price,
      size: signal.size,
      paper: true,
    });

    return true;
  }

  // Live mode: place on Kalshi with post_only
  if (!hasCredentials()) {
    log("error", "executor.no_credentials");
    return false;
  }

  try {
    // Place YES order
    const yesKalshiId = await placeKalshiOrder({
      ticker: signal.ticker,
      side: "yes",
      price: signal.yes_price,
      size: signal.size,
    });

    if (!yesKalshiId) {
      log("error", "executor.yes_order_failed", { pair_id: signal.pair_id });
      db.updatePairStatus(signal.pair_id, "cancelled");
      return false;
    }

    // Place NO order
    const noKalshiId = await placeKalshiOrder({
      ticker: signal.ticker,
      side: "no",
      price: signal.no_price,
      size: signal.size,
    });

    if (!noKalshiId) {
      // Cancel the YES order we just placed
      log("error", "executor.no_order_failed_cancelling_yes", { pair_id: signal.pair_id });
      await cancelKalshiOrder(yesKalshiId);
      db.updatePairStatus(signal.pair_id, "cancelled");
      return false;
    }

    // Record both orders
    db.insertOrder({
      order_id: yesOrderId,
      pair_id: signal.pair_id,
      ticker: signal.ticker,
      side: "yes",
      price: signal.yes_price,
      size: signal.size,
      status: "open",
      kalshi_order_id: yesKalshiId,
      filled_size: 0,
      created_at: now,
    });

    db.insertOrder({
      order_id: noOrderId,
      pair_id: signal.pair_id,
      ticker: signal.ticker,
      side: "no",
      price: signal.no_price,
      size: signal.size,
      status: "open",
      kalshi_order_id: noKalshiId,
      filled_size: 0,
      created_at: now,
    });

    log("info", "executor.pair_placed", {
      pair_id: signal.pair_id,
      asset: signal.asset,
      yes_price: signal.yes_price,
      no_price: signal.no_price,
      size: signal.size,
      paper: false,
    });

    return true;
  } catch (err) {
    log("error", "executor.place_error", { pair_id: signal.pair_id, error: String(err) });
    db.updatePairStatus(signal.pair_id, "cancelled");
    return false;
  }
}

async function placeKalshiOrder(params: {
  ticker: string;
  side: string;
  price: number;
  size: number;
}): Promise<string | null> {
  const path = "/portfolio/orders";
  const url = `${config.baseUrl}${path}`;
  const headers = authHeaders("POST", path);

  const body = {
    ticker: params.ticker,
    action: "buy",
    side: params.side,
    type: "limit",
    count: params.size,
    ...(params.side === "yes"
      ? { yes_price: params.price }
      : { no_price: params.price }),
    time_in_force: "gtc",
    post_only: true,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    log("error", "executor.kalshi_order_failed", {
      status: resp.status,
      body: text,
      ticker: params.ticker,
      side: params.side,
    });
    return null;
  }

  const data = await resp.json() as { order?: { order_id?: string } };
  return data.order?.order_id ?? null;
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  const order = db.getOrder(orderId);
  if (!order) return false;

  if (config.paperTrade) {
    db.updateOrderStatus(orderId, "cancelled");
    log("info", "executor.order_cancelled", { order_id: orderId, paper: true });
    return true;
  }

  if (!order.kalshi_order_id) {
    db.updateOrderStatus(orderId, "cancelled");
    return true;
  }

  const success = await cancelKalshiOrder(order.kalshi_order_id);
  if (success) {
    db.updateOrderStatus(orderId, "cancelled");
    log("info", "executor.order_cancelled", { order_id: orderId, kalshi_id: order.kalshi_order_id });
  }
  return success;
}

async function cancelKalshiOrder(kalshiOrderId: string): Promise<boolean> {
  const path = `/portfolio/orders/${kalshiOrderId}`;
  const url = `${config.baseUrl}${path}`;
  const headers = authHeaders("DELETE", path);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { method: "DELETE", headers });
      if (resp.ok || resp.status === 404) return true;
      log("warn", "executor.cancel_retry", { kalshi_id: kalshiOrderId, attempt, status: resp.status });
    } catch (err) {
      log("warn", "executor.cancel_error", { kalshi_id: kalshiOrderId, attempt, error: String(err) });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export async function cancelAllOpen(): Promise<number> {
  const openOrders = db.getOpenOrders();
  let cancelled = 0;
  for (const order of openOrders) {
    if (await cancelOrder(order.order_id)) {
      cancelled++;
    }
  }
  log("info", "executor.cancel_all", { cancelled, total: openOrders.length });
  return cancelled;
}
