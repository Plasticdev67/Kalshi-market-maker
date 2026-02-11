/**
 * Kalshi Market Maker Dashboard.
 *
 * Express server with HTML dashboard showing live bot status.
 * Reads from the same SQLite database as the bot.
 */

import express from "express";
import { config } from "./config.js";
import * as db from "./db.js";
import { log } from "./logger.js";

const app = express();

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

app.get("/api/status", (_req, res) => {
  const pnl = db.getPnlSummary();
  const openPairs = db.getOpenPairs();
  const openOrders = db.getOpenOrders();
  const completed = db.countByStatus("filled");
  const partial = db.countByStatus("partial");
  const cancelled = db.countByStatus("cancelled");

  res.json({
    mode: config.paperTrade ? "PAPER" : "LIVE",
    trading_enabled: config.tradingEnabled,
    total_pnl: Math.round(pnl.totalPnl * 10000) / 10000,
    total_deployed: Math.round(pnl.totalDeployed * 100) / 100,
    avg_pnl_per_pair: Math.round(pnl.avgPnl * 10000) / 10000,
    pairs_completed: pnl.totalPairs,
    pairs_open: openPairs.length,
    pairs_partial: partial,
    pairs_cancelled: cancelled,
    orders_open: openOrders.length,
  });
});

app.get("/api/pairs", (_req, res) => {
  const pairs = db.getRecentPairs(100);
  res.json(pairs.map(p => ({
    ...p,
    created_ago: timeAgo(p.created_at),
  })));
});

app.get("/api/pnl", (_req, res) => {
  res.json(db.getRecentPnl(100));
});

app.get("/api/events", (_req, res) => {
  const events = db.getRecentEvents(100);
  res.json(events.map(e => ({
    ...e,
    time_ago: timeAgo(e.timestamp),
    details: e.details ? (() => { try { return JSON.parse(e.details); } catch { return e.details; } })() : null,
  })));
});

app.get("/", (_req, res) => {
  res.type("html").send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kalshi Market Maker</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0f; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%); padding: 20px 30px; border-bottom: 2px solid #e94560; }
.header h1 { font-size: 24px; color: #fff; }
.header h1 span.sub { font-size: 14px; color: #888; font-weight: normal; margin-left: 8px; }
.mode { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 10px; }
.mode.paper { background: #f0ad4e; color: #000; }
.mode.live { background: #e94560; color: #fff; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; padding: 20px 30px; }
.card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 14px; }
.card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
.card .value { font-size: 26px; font-weight: bold; margin-top: 4px; }
.card .value.green { color: #4caf50; }
.card .value.red { color: #e94560; }
.card .value.blue { color: #2196f3; }
.section { padding: 10px 30px 20px; }
.section h2 { font-size: 15px; color: #aaa; margin-bottom: 8px; border-bottom: 1px solid #2a2a4a; padding-bottom: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 6px 8px; color: #888; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #2a2a4a; }
td { padding: 6px 8px; border-bottom: 1px solid #1a1a2e; }
tr:hover { background: #1a1a2e; }
.status { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
.status.open { background: #2196f3; color: #fff; }
.status.filled { background: #4caf50; color: #fff; }
.status.partial { background: #f0ad4e; color: #000; }
.status.cancelled { background: #666; color: #fff; }
.refresh { color: #888; font-size: 11px; float: right; }
</style>
</head>
<body>
<div class="header">
  <h1>Kalshi Market Maker <span id="mode" class="mode paper">PAPER</span><span class="sub">15-min Crypto</span></h1>
  <span class="refresh">Auto-refreshes every 5s</span>
</div>

<div class="grid" id="stats"></div>

<div class="section">
  <h2>Open Pairs</h2>
  <table id="pairs-table">
    <thead><tr><th>Pair</th><th>Ticker</th><th>Asset</th><th>Status</th><th>Created</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="section">
  <h2>PnL History</h2>
  <table id="pnl-table">
    <thead><tr><th>Pair</th><th>Ticker</th><th>YES</th><th>NO</th><th>Size</th><th>Fees</th><th>PnL</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="section">
  <h2>Recent Events</h2>
  <table id="events-table">
    <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<script>
async function refresh() {
  try {
    const status = await (await fetch('/api/status')).json();
    const modeEl = document.getElementById('mode');
    modeEl.textContent = status.mode;
    modeEl.className = 'mode ' + status.mode.toLowerCase();

    document.getElementById('stats').innerHTML =
      '<div class="card"><div class="label">Total PnL</div><div class="value ' + (status.total_pnl >= 0 ? 'green' : 'red') + '">$' + status.total_pnl.toFixed(4) + '</div></div>' +
      '<div class="card"><div class="label">Deployed</div><div class="value blue">$' + status.total_deployed.toFixed(2) + '</div></div>' +
      '<div class="card"><div class="label">Avg PnL/Pair</div><div class="value ' + (status.avg_pnl_per_pair >= 0 ? 'green' : 'red') + '">$' + status.avg_pnl_per_pair.toFixed(4) + '</div></div>' +
      '<div class="card"><div class="label">Completed</div><div class="value">' + status.pairs_completed + '</div></div>' +
      '<div class="card"><div class="label">Open</div><div class="value blue">' + status.pairs_open + '</div></div>' +
      '<div class="card"><div class="label">Orders</div><div class="value">' + status.orders_open + '</div></div>' +
      '<div class="card"><div class="label">Partial</div><div class="value ' + (status.pairs_partial > 0 ? 'red' : '') + '">' + status.pairs_partial + '</div></div>' +
      '<div class="card"><div class="label">Cancelled</div><div class="value">' + status.pairs_cancelled + '</div></div>';

    const pairs = await (await fetch('/api/pairs')).json();
    document.querySelector('#pairs-table tbody').innerHTML = pairs.slice(0, 20).map(function(p) {
      return '<tr><td>' + (p.pair_id || '').substring(0,12) + '</td><td>' + (p.ticker || '') + '</td><td>' + (p.asset || '') + '</td><td><span class="status ' + p.status + '">' + p.status + '</span></td><td>' + (p.created_ago || '-') + '</td></tr>';
    }).join('');

    const pnl = await (await fetch('/api/pnl')).json();
    document.querySelector('#pnl-table tbody').innerHTML = pnl.slice(0, 20).map(function(p) {
      return '<tr><td>' + ((p.pair_id || '').substring(0,12)) + '</td><td>' + (p.ticker || '') + '</td><td>' + (p.yes_fill_price || 0) + 'c</td><td>' + (p.no_fill_price || 0) + 'c</td><td>' + (p.size || 0) + '</td><td>$' + (p.fees || 0).toFixed(4) + '</td><td style="color:' + ((p.realized_pnl || 0) >= 0 ? '#4caf50' : '#e94560') + '">$' + (p.realized_pnl || 0).toFixed(4) + '</td></tr>';
    }).join('');

    const events = await (await fetch('/api/events')).json();
    document.querySelector('#events-table tbody').innerHTML = events.slice(0, 30).map(function(e) {
      var details = e.details;
      if (typeof details === 'object' && details !== null) details = JSON.stringify(details);
      return '<tr><td>' + (e.time_ago || '-') + '</td><td>' + e.event_type + '</td><td>' + ((details || '').substring(0, 80)) + '</td></tr>';
    }).join('');
  } catch(err) {
    console.error('Refresh error:', err);
  }
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

// ---- Standalone runner ----

async function main() {
  await db.connect();
  app.listen(config.dashboardPort, () => {
    log("info", "dashboard.started", { port: config.dashboardPort });
  });
}

main().catch(err => {
  log("error", "dashboard.fatal", { error: String(err) });
  process.exit(1);
});

export { app };
