/**
 * SQLite database via sql.js (WASM, no native deps).
 *
 * Tables: pairs, orders, pnl_log, events
 */

import initSqlJs, { type Database as SqlJsDb } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import type { PairRecord, OrderRecord } from "./types.js";

let _db: SqlJsDb | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pairs (
  pair_id        TEXT PRIMARY KEY,
  ticker         TEXT NOT NULL,
  asset          TEXT NOT NULL,
  target_spread  REAL,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     REAL NOT NULL,
  market_question TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  order_id        TEXT PRIMARY KEY,
  pair_id         TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  side            TEXT NOT NULL,
  price           INTEGER NOT NULL,
  size            INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  kalshi_order_id TEXT,
  filled_size     INTEGER DEFAULT 0,
  created_at      REAL NOT NULL,
  FOREIGN KEY (pair_id) REFERENCES pairs(pair_id)
);

CREATE TABLE IF NOT EXISTS pnl_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id        TEXT NOT NULL,
  ticker         TEXT NOT NULL,
  yes_fill_price INTEGER,
  no_fill_price  INTEGER,
  size           INTEGER,
  combined_cost  REAL,
  gross_profit   REAL,
  fees           REAL,
  realized_pnl   REAL,
  timestamp      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  details    TEXT,
  timestamp  REAL NOT NULL
);
`;

function save(): void {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(config.dbPath, Buffer.from(data));
}

export async function connect(): Promise<void> {
  const SQL = await initSqlJs();

  if (fs.existsSync(config.dbPath)) {
    const buf = fs.readFileSync(config.dbPath);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }

  _db.run(SCHEMA);
  save();
  log("info", "db.connected", { path: config.dbPath });
}

export function close(): void {
  if (_db) {
    save();
    _db.close();
    _db = null;
  }
}

function db(): SqlJsDb {
  if (!_db) throw new Error("Database not connected");
  return _db;
}

// ---- Pairs ----

export function insertPair(pair: PairRecord): void {
  db().run(
    `INSERT OR IGNORE INTO pairs (pair_id, ticker, asset, target_spread, status, created_at, market_question)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pair.pair_id, pair.ticker, pair.asset, pair.target_spread, pair.status, pair.created_at, pair.market_question],
  );
  save();
}

export function updatePairStatus(pairId: string, status: string): void {
  db().run("UPDATE pairs SET status = ? WHERE pair_id = ?", [status, pairId]);
  save();
}

export function getOpenPairs(): PairRecord[] {
  const stmt = db().prepare("SELECT * FROM pairs WHERE status = 'open'");
  const rows: PairRecord[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as PairRecord);
  }
  stmt.free();
  return rows;
}

// ---- Orders ----

export function insertOrder(order: OrderRecord): void {
  db().run(
    `INSERT OR IGNORE INTO orders (order_id, pair_id, ticker, side, price, size, status, kalshi_order_id, filled_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order.order_id, order.pair_id, order.ticker, order.side, order.price, order.size, order.status, order.kalshi_order_id, order.filled_size, order.created_at],
  );
  save();
}

export function updateOrderStatus(
  orderId: string,
  status: string,
  filledSize?: number,
): void {
  if (filledSize !== undefined) {
    db().run(
      "UPDATE orders SET status = ?, filled_size = ? WHERE order_id = ?",
      [status, filledSize, orderId],
    );
  } else {
    db().run("UPDATE orders SET status = ? WHERE order_id = ?", [status, orderId]);
  }
  save();
}

export function getOrdersForPair(pairId: string): OrderRecord[] {
  const stmt = db().prepare("SELECT * FROM orders WHERE pair_id = ?");
  stmt.bind([pairId]);
  const rows: OrderRecord[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as OrderRecord);
  }
  stmt.free();
  return rows;
}

export function getOrder(orderId: string): OrderRecord | null {
  const stmt = db().prepare("SELECT * FROM orders WHERE order_id = ?");
  stmt.bind([orderId]);
  const result = stmt.step() ? (stmt.getAsObject() as unknown as OrderRecord) : null;
  stmt.free();
  return result;
}

export function getOpenOrders(): OrderRecord[] {
  const stmt = db().prepare("SELECT * FROM orders WHERE status IN ('open', 'pending')");
  const rows: OrderRecord[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as OrderRecord);
  }
  stmt.free();
  return rows;
}

// ---- PnL ----

export function logPnl(data: {
  pairId: string;
  ticker: string;
  yesFillPrice: number;
  noFillPrice: number;
  size: number;
  fees: number;
}): void {
  const combinedCost = (data.yesFillPrice + data.noFillPrice) * data.size / 100;
  const grossProfit = (100 - data.yesFillPrice - data.noFillPrice) * data.size / 100;
  const realizedPnl = grossProfit - data.fees;

  db().run(
    `INSERT INTO pnl_log (pair_id, ticker, yes_fill_price, no_fill_price, size, combined_cost, gross_profit, fees, realized_pnl, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.pairId, data.ticker, data.yesFillPrice, data.noFillPrice, data.size, combinedCost, grossProfit, data.fees, realizedPnl, Date.now() / 1000],
  );
  save();
}

export function getTotalPnl(): number {
  const stmt = db().prepare("SELECT COALESCE(SUM(realized_pnl), 0) as total FROM pnl_log");
  stmt.step();
  const result = (stmt.getAsObject() as { total: number }).total;
  stmt.free();
  return result;
}

export function getPnlSummary(): { totalPnl: number; totalDeployed: number; avgPnl: number; totalPairs: number } {
  const stmt = db().prepare(
    "SELECT COALESCE(SUM(realized_pnl), 0) as total_pnl, COALESCE(SUM(combined_cost), 0) as total_deployed, COALESCE(AVG(realized_pnl), 0) as avg_pnl, COUNT(*) as total_pairs FROM pnl_log",
  );
  stmt.step();
  const row = stmt.getAsObject() as { total_pnl: number; total_deployed: number; avg_pnl: number; total_pairs: number };
  stmt.free();
  return { totalPnl: row.total_pnl, totalDeployed: row.total_deployed, avgPnl: row.avg_pnl, totalPairs: row.total_pairs };
}

// ---- Events ----

export function logEvent(eventType: string, details?: Record<string, unknown>): void {
  db().run(
    "INSERT INTO events (event_type, details, timestamp) VALUES (?, ?, ?)",
    [eventType, details ? JSON.stringify(details) : null, Date.now() / 1000],
  );
  save();
}

export function getRecentEvents(limit: number = 50): Array<{ event_type: string; details: string | null; timestamp: number }> {
  const stmt = db().prepare(`SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`);
  stmt.bind([limit]);
  const rows: Array<{ event_type: string; details: string | null; timestamp: number }> = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as { event_type: string; details: string | null; timestamp: number });
  }
  stmt.free();
  return rows;
}

// ---- Dashboard queries ----

export function countByStatus(status: string): number {
  const stmt = db().prepare("SELECT COUNT(*) as c FROM pairs WHERE status = ?");
  stmt.bind([status]);
  stmt.step();
  const result = (stmt.getAsObject() as { c: number }).c;
  stmt.free();
  return result;
}

export function getRecentPairs(limit: number = 100): PairRecord[] {
  const stmt = db().prepare("SELECT * FROM pairs ORDER BY created_at DESC LIMIT ?");
  stmt.bind([limit]);
  const rows: PairRecord[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as PairRecord);
  }
  stmt.free();
  return rows;
}

export function getRecentPnl(limit: number = 100): Array<Record<string, unknown>> {
  const stmt = db().prepare("SELECT * FROM pnl_log ORDER BY timestamp DESC LIMIT ?");
  stmt.bind([limit]);
  const rows: Array<Record<string, unknown>> = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}
