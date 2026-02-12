/**
 * Position manager.
 *
 * Manages paired order lifecycle:
 * - Simulates fills in paper mode (ask <= our bid)
 * - Detects pair completion (both sides filled)
 * - Handles pair timeouts (one side filled, other hasn't)
 * - Enforces resolution deadline cancellation
 * - Halts on consecutive one-sided fills
 */

import { config, makerFeeCents } from "./config.js";
import { log } from "./logger.js";
import * as db from "./db.js";
import * as executor from "./executor.js";
import { CapitalManager } from "./capital.js";
import type { MarketBook, OrderRecord } from "./types.js";

export class PositionManager {
  private capital: CapitalManager;
  private consecutiveOneSided = 0;
  private _halted = false;

  constructor(capital: CapitalManager) {
    this.capital = capital;
  }

  get isHalted(): boolean {
    return this._halted;
  }

  async checkPairs(booksByTicker: Map<string, MarketBook>): Promise<void> {
    if (this._halted) return;

    const openPairs = db.getOpenPairs();

    for (const pair of openPairs) {
      const orders = db.getOrdersForPair(pair.pair_id);
      if (orders.length < 2) continue;

      let yesOrder = orders.find(o => o.side === "yes") ?? null;
      let noOrder = orders.find(o => o.side === "no") ?? null;
      if (!yesOrder || !noOrder) continue;

      const book = booksByTicker.get(pair.ticker);

      // Step 1: Simulate fills in paper mode
      if (config.paperTrade && book) {
        this.checkPaperFills(yesOrder, noOrder, book);
        // Re-fetch after potential updates
        yesOrder = db.getOrder(yesOrder.order_id)!;
        noOrder = db.getOrder(noOrder.order_id)!;
      }

      const yesFilled = yesOrder.status === "filled";
      const noFilled = noOrder.status === "filled";
      const yesOpen = yesOrder.status === "open";
      const noOpen = noOrder.status === "open";

      // Both filled -> pair complete
      if (yesFilled && noFilled) {
        this.completePair(pair, yesOrder, noOrder);
        continue;
      }

      // Resolution deadline
      if (book && book.market.seconds_until_close <= config.cancelDeadlineSeconds) {
        log("warn", "position.resolution_deadline", {
          pair_id: pair.pair_id,
          seconds_left: Math.round(book.market.seconds_until_close),
        });
        this.cancelPair(pair.pair_id, yesOrder, noOrder, "resolution_deadline");
        continue;
      }

      // Pair timeout (one side filled, other hasn't)
      if ((yesFilled && noOpen) || (noFilled && yesOpen)) {
        const elapsed = Date.now() / 1000 - pair.created_at;
        if (elapsed >= config.pairTimeoutSeconds) {
          const filledSide = yesFilled ? "yes" : "no";
          const unfilledOrder = yesFilled ? noOrder : yesOrder;
          log("warn", "position.pair_timeout", {
            pair_id: pair.pair_id,
            filled_side: filledSide,
            elapsed: Math.round(elapsed),
          });
          this.handleOneSidedFill(pair, filledSide, unfilledOrder, yesOrder, noOrder);
        }
      }
    }
  }

  private checkPaperFills(
    yesOrder: OrderRecord,
    noOrder: OrderRecord,
    book: MarketBook,
  ): void {
    // Probability-based fill simulation.
    // Real market makers at the best bid get filled by natural sell flow.
    // Model: tighter spread = more activity = higher fill chance per cycle.
    const sides: Array<{
      order: OrderRecord;
      side: string;
      bestBid: number;
      bestAsk: number;
    }> = [
      { order: yesOrder, side: "yes", bestBid: book.best_yes_bid, bestAsk: book.best_yes_ask },
      { order: noOrder, side: "no", bestBid: book.best_no_bid, bestAsk: book.best_no_ask },
    ];

    for (const { order, side, bestBid, bestAsk } of sides) {
      if (order.status !== "open") continue;

      let fillProb = 0;

      if (bestAsk > 0 && bestAsk <= order.price) {
        // Ask crossed to our price -- guaranteed fill
        fillProb = 1.0;
      } else if (bestBid > 0 && order.price >= bestBid) {
        // We're at or above best bid (competitive)
        const spread = bestAsk > 0 ? bestAsk - bestBid : 10;
        if (spread <= 2) fillProb = 0.35;       // tight spread
        else if (spread <= 5) fillProb = 0.25;   // normal spread
        else fillProb = 0.15;                     // wide spread
      }

      if (fillProb > 0 && Math.random() < fillProb) {
        db.updateOrderStatus(order.order_id, "filled", order.size);
        log("info", "position.paper_fill", {
          order_id: order.order_id,
          side,
          price: order.price,
          size: order.size,
          best_bid: bestBid,
          best_ask: bestAsk,
          fill_prob: fillProb,
        });
        db.logEvent("order_filled", {
          order_id: order.order_id,
          pair_id: order.pair_id,
          side,
          price: order.price,
          paper: true,
        });
      }
    }
  }

  private completePair(
    pair: { pair_id: string; ticker: string },
    yesOrder: OrderRecord,
    noOrder: OrderRecord,
  ): void {
    const yesPrice = yesOrder.price;
    const noPrice = noOrder.price;
    const size = yesOrder.size;

    db.updatePairStatus(pair.pair_id, "filled");

    const feeYes = makerFeeCents(yesPrice, size);
    const feeNo = makerFeeCents(noPrice, size);
    const totalFees = feeYes + feeNo;

    db.logPnl({
      pairId: pair.pair_id,
      ticker: pair.ticker,
      yesFillPrice: yesPrice,
      noFillPrice: noPrice,
      size,
      fees: totalFees / 100, // convert cents to dollars
    });

    const grossProfit = (100 - yesPrice - noPrice) * size / 100;
    const netPnl = grossProfit - totalFees / 100;

    this.capital.release(pair.pair_id, netPnl);
    this.consecutiveOneSided = 0;

    log("info", "position.pair_complete", {
      pair_id: pair.pair_id,
      yes_price: yesPrice,
      no_price: noPrice,
      size,
      gross_profit: Math.round(grossProfit * 100) / 100,
      fees: Math.round(totalFees) / 100,
      net_pnl: Math.round(netPnl * 100) / 100,
    });

    db.logEvent("pair_complete", {
      pair_id: pair.pair_id,
      yes_price: yesPrice,
      no_price: noPrice,
      size,
      net_pnl: Math.round(netPnl * 100) / 100,
    });
  }

  private async handleOneSidedFill(
    pair: { pair_id: string },
    filledSide: string,
    unfilledOrder: OrderRecord,
    yesOrder: OrderRecord,
    noOrder: OrderRecord,
  ): Promise<void> {
    await executor.cancelOrder(unfilledOrder.order_id);
    db.updatePairStatus(pair.pair_id, "partial");

    this.consecutiveOneSided++;
    const filledOrder = filledSide === "yes" ? yesOrder : noOrder;
    const exposure = filledOrder.price * filledOrder.size / 100;

    this.capital.release(pair.pair_id, -exposure);

    log("warn", "position.one_sided_fill", {
      pair_id: pair.pair_id,
      filled_side: filledSide,
      exposure: Math.round(exposure * 100) / 100,
      consecutive: this.consecutiveOneSided,
      max_allowed: config.maxOneSidedFillsBeforeHalt,
    });

    db.logEvent("one_sided_fill", {
      pair_id: pair.pair_id,
      filled_side: filledSide,
      consecutive: this.consecutiveOneSided,
    });

    // Halt check
    if (this.consecutiveOneSided >= config.maxOneSidedFillsBeforeHalt) {
      this._halted = true;
      log("error", "position.HALTED", {
        reason: "consecutive_one_sided_fills",
        count: this.consecutiveOneSided,
      });
      db.logEvent("trading_halted", {
        reason: "consecutive_one_sided_fills",
        count: this.consecutiveOneSided,
      });
      await executor.cancelAllOpen();
    }
  }

  private async cancelPair(
    pairId: string,
    yesOrder: OrderRecord,
    noOrder: OrderRecord,
    reason: string,
  ): Promise<void> {
    for (const order of [yesOrder, noOrder]) {
      if (order.status === "open") {
        await executor.cancelOrder(order.order_id);
      }
    }

    db.updatePairStatus(pairId, "cancelled");
    this.capital.release(pairId, 0);

    log("info", "position.pair_cancelled", { pair_id: pairId, reason });
    db.logEvent("pair_cancelled", { pair_id: pairId, reason });
  }
}
