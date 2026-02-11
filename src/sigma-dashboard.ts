/**
 * Sigma Dashboard -- Combined Kalshi + Polymarket market maker dashboard.
 *
 * "Literally Me" energy. Patrick Bateman's trading terminal.
 * One page, two bots. Flick between them.
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

// ---- Kalshi API endpoints (local DB) ----

app.get("/api/kalshi/status", (_req, res) => {
  const pnl = db.getPnlSummary();
  const openPairs = db.getOpenPairs();
  const openOrders = db.getOpenOrders();
  const completed = db.countByStatus("filled");
  const partial = db.countByStatus("partial");
  const cancelled = db.countByStatus("cancelled");
  res.json({
    mode: config.paperTrade ? "PAPER" : "LIVE",
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

app.get("/api/kalshi/pairs", (_req, res) => {
  const pairs = db.getRecentPairs(50);
  res.json(pairs.map(p => ({ ...p, created_ago: timeAgo(p.created_at) })));
});

app.get("/api/kalshi/pnl", (_req, res) => {
  res.json(db.getRecentPnl(50));
});

app.get("/api/kalshi/events", (_req, res) => {
  const events = db.getRecentEvents(50);
  res.json(events.map(e => ({
    ...e,
    time_ago: timeAgo(e.timestamp),
    details: e.details ? (() => { try { return JSON.parse(e.details); } catch { return e.details; } })() : null,
  })));
});

// ---- Polymarket proxy (reads from the other dashboard) ----

app.get("/api/poly/:endpoint", async (req, res) => {
  try {
    const endpoint = req.params.endpoint;
    const resp = await fetch(`http://localhost:8051/api/${endpoint}`);
    const data = await resp.json();
    res.json(data);
  } catch {
    res.json({ error: "Polymarket bot offline" });
  }
});

// ---- Dashboard HTML ----

app.get("/", (_req, res) => {
  res.type("html").send(SIGMA_HTML);
});

const SIGMA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SIGMA TERMINAL</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: #000;
  color: #c8c8c8;
  font-family: 'JetBrains Mono', monospace;
  overflow-x: hidden;
}

/* Scanline overlay */
body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.03) 2px,
    rgba(0,0,0,0.03) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

/* Header */
.header {
  background: #000;
  border-bottom: 1px solid #1a1a1a;
  padding: 16px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font-family: 'Orbitron', sans-serif;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 6px;
  color: #fff;
  text-transform: uppercase;
}

.title .accent { color: #e50914; }

.subtitle {
  font-size: 10px;
  color: #444;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-top: 2px;
}

/* Tab switcher */
.tabs {
  display: flex;
  gap: 0;
}

.tab {
  padding: 10px 28px;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid #1a1a1a;
  background: #000;
  color: #444;
  transition: all 0.3s;
}

.tab:first-child { border-radius: 4px 0 0 4px; }
.tab:last-child { border-radius: 0 4px 4px 0; }

.tab.active {
  background: #e50914;
  color: #fff;
  border-color: #e50914;
}

.tab:hover:not(.active) {
  color: #888;
  border-color: #333;
}

/* Mode badge */
.mode-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 4px 12px;
  border-radius: 2px;
}

.mode-badge.paper { background: #1a1a00; color: #f0ad4e; border: 1px solid #333300; }
.mode-badge.live { background: #1a0000; color: #e50914; border: 1px solid #330000; animation: pulse 2s infinite; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

/* Stats grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1px;
  background: #111;
  margin: 20px 30px;
  border: 1px solid #1a1a1a;
}

.card {
  background: #0a0a0a;
  padding: 16px;
}

.card .label {
  font-size: 9px;
  color: #555;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.card .value {
  font-family: 'Orbitron', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin-top: 6px;
  color: #fff;
}

.card .value.green { color: #00e676; }
.card .value.red { color: #e50914; }
.card .value.blue { color: #448aff; }

/* Quote */
.quote-bar {
  padding: 8px 30px;
  font-size: 10px;
  color: #333;
  letter-spacing: 1px;
  font-style: italic;
  border-top: 1px solid #0a0a0a;
}

/* Tables */
.section {
  padding: 10px 30px 20px;
}

.section h2 {
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: #555;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #111;
}

table { width: 100%; border-collapse: collapse; font-size: 12px; }

th {
  text-align: left;
  padding: 8px;
  color: #333;
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  border-bottom: 1px solid #111;
}

td { padding: 8px; border-bottom: 1px solid #0a0a0a; color: #888; }
tr:hover td { color: #ccc; background: #050505; }

.status-tag {
  padding: 2px 8px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.status-tag.open { background: #001a33; color: #448aff; }
.status-tag.filled { background: #001a00; color: #00e676; }
.status-tag.partial { background: #1a1a00; color: #f0ad4e; }
.status-tag.cancelled { background: #111; color: #555; }

/* Soundtrack */
.audio-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #050505;
  border-top: 1px solid #111;
  padding: 8px 30px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
  color: #333;
  z-index: 100;
}

.audio-bar .track-name { color: #555; letter-spacing: 1px; }
.audio-bar audio { height: 24px; flex: 1; filter: grayscale(1) brightness(0.5); }

/* No data state */
.empty-state {
  text-align: center;
  padding: 40px;
  color: #222;
  font-size: 11px;
  letter-spacing: 2px;
}

/* Refresh indicator */
.refresh-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00e676;
  display: inline-block;
  margin-right: 6px;
  animation: blink 3s infinite;
}

@keyframes blink { 0%, 90% { opacity: 1; } 95% { opacity: 0; } 100% { opacity: 1; } }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="title">SIGMA <span class="accent">TERMINAL</span></div>
    <div class="subtitle">Market Making Intelligence System</div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="switchBot('kalshi')">KALSHI</div>
    <div class="tab" onclick="switchBot('poly')">POLYMARKET</div>
  </div>
  <div>
    <span class="refresh-dot"></span>
    <span id="mode" class="mode-badge paper">PAPER</span>
  </div>
</div>

<div class="quote-bar" id="quote"></div>

<div class="grid" id="stats"></div>

<div class="section">
  <h2>Open Positions</h2>
  <table id="pairs-table">
    <thead><tr><th>ID</th><th>Market</th><th>Asset</th><th>Status</th><th>Age</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="section">
  <h2>Realized PnL</h2>
  <table id="pnl-table">
    <thead><tr><th>ID</th><th>Market</th><th>YES</th><th>NO</th><th>Size</th><th>Fees</th><th>PnL</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="section">
  <h2>Event Log</h2>
  <table id="events-table">
    <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="audio-bar">
  <span class="track-name" id="track-name">No track loaded</span>
  <audio id="player" controls></audio>
</div>

<script>
const QUOTES = [
  "I have to return some videotapes.",
  "There is an idea of a Patrick Bateman.",
  "I'm on the verge of tears as I strain to hold my smile.",
  "My pain is constant and sharp, and I do not hope for a better world.",
  "I simply am not there.",
  "In this moment, I am euphoric.",
  "The grind never stops.",
  "Discipline is the bridge between goals and accomplishment.",
  "While they sleep, we trade.",
  "Not luck. Preparation meeting opportunity.",
  "The market rewards those who show up.",
  "Sigma rule #1: Let the bots handle it.",
];

let currentBot = 'kalshi';
let quoteIdx = 0;

function switchBot(bot) {
  currentBot = bot;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(bot.substring(0, 4)));
  });
  refresh();
}

function rotateQuote() {
  quoteIdx = (quoteIdx + 1) % QUOTES.length;
  document.getElementById('quote').textContent = '"' + QUOTES[quoteIdx] + '"';
}

async function refresh() {
  try {
    var prefix = currentBot === 'kalshi' ? '/api/kalshi' : '/api/poly';

    var status;
    try {
      status = await (await fetch(prefix + '/status')).json();
    } catch(e) {
      document.getElementById('stats').innerHTML = '<div class="empty-state">BOT OFFLINE -- WAITING FOR CONNECTION</div>';
      return;
    }

    if (status.error) {
      document.getElementById('stats').innerHTML = '<div class="empty-state">' + (currentBot === 'poly' ? 'POLYMARKET BOT OFFLINE' : 'KALSHI BOT OFFLINE') + '</div>';
      return;
    }

    var modeEl = document.getElementById('mode');
    var mode = status.mode || 'PAPER';
    modeEl.textContent = mode;
    modeEl.className = 'mode-badge ' + mode.toLowerCase();

    var pnl = status.total_pnl || 0;
    var avg = status.avg_pnl_per_pair || 0;

    document.getElementById('stats').innerHTML =
      '<div class="card"><div class="label">Total PnL</div><div class="value ' + (pnl >= 0 ? 'green' : 'red') + '">$' + pnl.toFixed(4) + '</div></div>' +
      '<div class="card"><div class="label">Deployed</div><div class="value blue">$' + (status.total_deployed || 0).toFixed(2) + '</div></div>' +
      '<div class="card"><div class="label">Avg PnL</div><div class="value ' + (avg >= 0 ? 'green' : 'red') + '">$' + avg.toFixed(4) + '</div></div>' +
      '<div class="card"><div class="label">Completed</div><div class="value">' + (status.pairs_completed || 0) + '</div></div>' +
      '<div class="card"><div class="label">Open</div><div class="value blue">' + (status.pairs_open || 0) + '</div></div>' +
      '<div class="card"><div class="label">Orders</div><div class="value">' + (status.orders_open || 0) + '</div></div>' +
      '<div class="card"><div class="label">Partial</div><div class="value ' + ((status.pairs_partial || 0) > 0 ? 'red' : '') + '">' + (status.pairs_partial || 0) + '</div></div>' +
      '<div class="card"><div class="label">Cancelled</div><div class="value">' + (status.pairs_cancelled || 0) + '</div></div>';

    // Pairs
    try {
      var pairs = await (await fetch(prefix + '/pairs')).json();
      if (Array.isArray(pairs)) {
        document.querySelector('#pairs-table tbody').innerHTML = pairs.slice(0, 15).map(function(p) {
          var id = (p.pair_id || '').substring(0, 12);
          var market = p.ticker || p.market_question || '';
          if (market.length > 40) market = market.substring(0, 40) + '...';
          var asset = p.asset || '-';
          var st = p.status || 'open';
          var age = p.created_ago || '-';
          return '<tr><td>' + id + '</td><td>' + market + '</td><td>' + asset + '</td><td><span class="status-tag ' + st + '">' + st + '</span></td><td>' + age + '</td></tr>';
        }).join('');
      }
    } catch(e) {}

    // PnL
    try {
      var pnlData = await (await fetch(prefix + '/pnl')).json();
      if (Array.isArray(pnlData)) {
        document.querySelector('#pnl-table tbody').innerHTML = pnlData.slice(0, 15).map(function(p) {
          var rpnl = p.realized_pnl || 0;
          return '<tr><td>' + ((p.pair_id||'').substring(0,12)) + '</td><td>' + (p.ticker || p.market_id || '') + '</td><td>' + (p.yes_fill_price || 0) + '</td><td>' + (p.no_fill_price || 0) + '</td><td>' + (p.size || 0) + '</td><td>$' + (p.fees || 0).toFixed(4) + '</td><td style="color:' + (rpnl >= 0 ? '#00e676' : '#e50914') + '">$' + rpnl.toFixed(4) + '</td></tr>';
        }).join('');
      }
    } catch(e) {}

    // Events
    try {
      var events = await (await fetch(prefix + '/events')).json();
      if (Array.isArray(events)) {
        document.querySelector('#events-table tbody').innerHTML = events.slice(0, 20).map(function(e) {
          var details = e.details;
          if (typeof details === 'object' && details !== null) details = JSON.stringify(details);
          return '<tr><td>' + (e.time_ago || '-') + '</td><td>' + (e.event_type || '') + '</td><td>' + ((details || '').substring(0, 70)) + '</td></tr>';
        }).join('');
      }
    } catch(e) {}

  } catch(err) {
    console.error('Refresh error:', err);
  }
}

// Init
rotateQuote();
setInterval(rotateQuote, 8000);
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

// ---- Start ----

async function main() {
  await db.connect();

  const port = config.dashboardPort;
  app.listen(port, () => {
    log("info", "sigma_dashboard.started", { port, url: "http://localhost:" + port });
  });
}

main().catch(err => {
  log("error", "sigma_dashboard.fatal", { error: String(err) });
  process.exit(1);
});
