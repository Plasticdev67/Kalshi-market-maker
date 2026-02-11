/**
 * Kalshi Market Maker - Main engine.
 *
 * Orchestrates: scan -> fetch books -> check positions -> evaluate -> place pairs
 * Handles graceful shutdown and state recovery.
 */

import { config } from "./config.js";
import { log } from "./logger.js";
import * as db from "./db.js";
import { scan } from "./scanner.js";
import { fetchBooks } from "./orderbook.js";
import { evaluate } from "./strategy.js";
import { placePair, cancelAllOpen } from "./executor.js";
import { CapitalManager } from "./capital.js";
import { PositionManager } from "./positions.js";
import type { KalshiMarket, MarketBook } from "./types.js";

class Engine {
  private capital: CapitalManager;
  private positions: PositionManager;
  private running = false;
  private shutdownRequested = false;

  constructor() {
    this.capital = new CapitalManager(config.maxTotalExposure);
    this.positions = new PositionManager(this.capital);
  }

  async start(): Promise<void> {
    log("info", "engine.starting", {
      paper_trade: config.paperTrade,
      max_exposure: config.maxTotalExposure,
      spread_threshold: config.minSpreadThreshold,
      order_size: config.orderSizeDefault,
      assets: config.assets.join(","),
    });

    await db.connect();
    db.logEvent("engine_start", {
      paper_trade: config.paperTrade,
      max_total_exposure: config.maxTotalExposure,
    });

    // State recovery: cancel orphaned orders
    await this.recoverState();

    const mode = config.paperTrade ? "PAPER TRADE" : "LIVE TRADING";
    log("info", `engine.started_${mode.toLowerCase().replace(" ", "_")}`, {
      balance: this.capital.available,
    });

    this.running = true;

    try {
      await this.mainLoop();
    } catch (err) {
      log("error", "engine.unhandled_error", { error: String(err) });
      config.tradingEnabled = false;
      await cancelAllOpen();
    } finally {
      await this.shutdown();
    }
  }

  private async mainLoop(): Promise<void> {
    let cycle = 0;

    while (this.running && !this.shutdownRequested) {
      cycle++;
      const cycleStart = Date.now();

      try {
        // 1. Scan for markets
        const markets = await scan();

        if (markets.length === 0) {
          log("info", "engine.no_markets", { cycle });
          await this.sleep(config.scanIntervalSeconds);
          continue;
        }

        // 2. Sort by closest to resolution, take nearest batch (one per asset)
        markets.sort((a, b) => a.seconds_until_close - b.seconds_until_close);
        const nearest = this.pickNearestPerAsset(markets);

        // Also include markets with open positions
        const openPairs = db.getOpenPairs();
        const openTickers = new Set(openPairs.map(p => p.ticker));
        const marketsToWatch = [...nearest];
        for (const m of markets) {
          if (openTickers.has(m.ticker) && !marketsToWatch.some(w => w.ticker === m.ticker)) {
            marketsToWatch.push(m);
          }
        }

        // 3. Fetch order books
        const allBooks = await fetchBooks(marketsToWatch);
        const booksByTicker = new Map<string, MarketBook>();
        for (const b of allBooks) {
          booksByTicker.set(b.market.ticker, b);
        }

        // 4. Check existing positions
        await this.positions.checkPairs(booksByTicker);

        // 5. Evaluate strategy if trading enabled
        if (config.tradingEnabled && !this.positions.isHalted) {
          const nearestBooks = allBooks.filter(b =>
            nearest.some(n => n.ticker === b.market.ticker),
          );
          let signals = evaluate(nearestBooks);

          // Filter out markets we already have open pairs on
          signals = signals.filter(s => !openTickers.has(s.ticker));

          // 6. Place pairs
          for (const signal of signals) {
            const costDollars = (signal.yes_price + signal.no_price) * signal.size / 100;
            if (!this.capital.canAllocate(costDollars)) {
              log("debug", "engine.skip_no_capital", {
                pair_id: signal.pair_id,
                cost: Math.round(costDollars * 100) / 100,
              });
              continue;
            }

            this.capital.allocate(signal.pair_id, costDollars);
            await placePair(signal);
          }
        }

        // Log cycle summary
        const elapsed = Date.now() - cycleStart;
        if (cycle % 10 === 0 || cycle === 1) {
          const summary = this.capital.summary();
          const totalPnl = db.getTotalPnl();
          log("info", "engine.cycle", {
            cycle,
            markets: markets.length,
            balance: summary.available,
            deployed: summary.deployed,
            open_pairs: summary.openPairs,
            total_pnl: Math.round(totalPnl * 10000) / 10000,
            elapsed_ms: elapsed,
          });
        }
      } catch (err) {
        log("error", "engine.cycle_error", { cycle, error: String(err) });
      }

      await this.sleep(config.scanIntervalSeconds);
    }
  }

  private pickNearestPerAsset(markets: KalshiMarket[]): KalshiMarket[] {
    const seen = new Set<string>();
    const result: KalshiMarket[] = [];
    for (const m of markets) {
      if (!seen.has(m.asset)) {
        seen.add(m.asset);
        result.push(m);
      }
    }
    return result;
  }

  private async recoverState(): Promise<void> {
    const openOrders = db.getOpenOrders();
    if (openOrders.length > 0) {
      log("warn", "engine.recovering", { orphaned_orders: openOrders.length });
      const cancelled = await cancelAllOpen();
      const pairIds = new Set(openOrders.map(o => o.pair_id));
      for (const pid of pairIds) {
        db.updatePairStatus(pid, "cancelled");
      }
      log("info", "engine.recovery_complete", {
        cancelled,
        pairs_cancelled: pairIds.size,
      });
    }
  }

  private async shutdown(): Promise<void> {
    log("info", "engine.shutting_down");
    this.running = false;
    await cancelAllOpen();
    db.close();
    log("info", "engine.stopped");
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, seconds * 1000);
      // Check shutdown more frequently
      const check = setInterval(() => {
        if (this.shutdownRequested) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 500);
      setTimeout(() => clearInterval(check), seconds * 1000 + 100);
    });
  }

  requestShutdown(): void {
    log("info", "engine.shutdown_requested");
    this.shutdownRequested = true;
  }
}

// ---- Entrypoint ----

const engine = new Engine();

process.on("SIGINT", () => engine.requestShutdown());
process.on("SIGTERM", () => engine.requestShutdown());

engine.start().catch(err => {
  log("error", "engine.fatal", { error: String(err) });
  process.exit(1);
});
