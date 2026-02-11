/**
 * Capital manager.
 *
 * Tracks available balance and per-pair deployed amounts.
 * All values in dollars.
 */

import { log } from "./logger.js";

export class CapitalManager {
  private _startingBalance: number;
  private _available: number;
  private _deployed: Map<string, number> = new Map();

  constructor(startingBalance: number) {
    this._startingBalance = startingBalance;
    this._available = startingBalance;
  }

  get available(): number {
    return this._available;
  }

  get totalDeployed(): number {
    let sum = 0;
    for (const v of this._deployed.values()) sum += v;
    return sum;
  }

  canAllocate(amountDollars: number): boolean {
    return amountDollars <= this._available;
  }

  allocate(pairId: string, amountDollars: number): void {
    this._available -= amountDollars;
    this._deployed.set(pairId, amountDollars);
    log("info", "capital.allocated", {
      pair_id: pairId,
      amount: Math.round(amountDollars * 100) / 100,
      remaining: Math.round(this._available * 100) / 100,
      total_deployed: Math.round(this.totalDeployed * 100) / 100,
    });
  }

  release(pairId: string, pnl: number = 0): void {
    const deployed = this._deployed.get(pairId) ?? 0;
    this._available += deployed + pnl;
    this._deployed.delete(pairId);
    log("info", "capital.released", {
      pair_id: pairId,
      returned: Math.round((deployed + pnl) * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      remaining: Math.round(this._available * 100) / 100,
    });
  }

  summary(): { available: number; deployed: number; openPairs: number } {
    return {
      available: Math.round(this._available * 100) / 100,
      deployed: Math.round(this.totalDeployed * 100) / 100,
      openPairs: this._deployed.size,
    };
  }
}
