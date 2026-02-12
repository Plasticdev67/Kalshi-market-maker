/**
 * Sigma Dashboard -- Combined Kalshi + Polymarket market maker dashboard.
 *
 * "Literally Me" energy. Patrick Bateman's trading terminal.
 * One page, two bots. Flick between them.
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import * as db from "./db.js";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Serve static files (audio, etc.)
app.use("/static", express.static(path.join(__dirname, "..", "static")));

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---- Kalshi API endpoints (local DB) ----
// Reload DB from disk before each request so we pick up bot writes
app.use("/api/kalshi", async (_req, _res, next) => {
  await db.reload();
  next();
});

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
  padding-bottom: 50px;
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

/* Film grain */
body::before {
  content: '';
  position: fixed;
  top: -50%; left: -50%;
  right: -50%; bottom: -50%;
  background: transparent;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 9998;
  animation: grain 0.5s steps(1) infinite;
}

@keyframes grain {
  0% { transform: translate(0,0); }
  25% { transform: translate(-2px,2px); }
  50% { transform: translate(2px,-2px); }
  75% { transform: translate(-2px,-2px); }
  100% { transform: translate(2px,2px); }
}

/* Vignette */
.vignette {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.7) 100%);
  pointer-events: none;
  z-index: 9997;
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

/* Mode + status */
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mode-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 4px 12px;
  border-radius: 2px;
}

.mode-badge.paper { background: #1a1a00; color: #f0ad4e; border: 1px solid #333300; }
.mode-badge.live { background: #1a0000; color: #e50914; border: 1px solid #330000; animation: pulse 2s infinite; }

.sigma-status {
  font-family: 'Orbitron', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 4px 14px;
  border-radius: 2px;
  text-transform: uppercase;
  transition: all 0.5s;
}

.sigma-status.grinding { background: #0a0a0a; color: #555; border: 1px solid #1a1a1a; }
.sigma-status.winning { background: #001a00; color: #00e676; border: 1px solid #003300; text-shadow: 0 0 8px rgba(0,230,118,0.3); }
.sigma-status.down { background: #1a0000; color: #e50914; border: 1px solid #330000; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

/* Quote bar - cinematic */
.quote-bar {
  padding: 14px 30px;
  font-size: 11px;
  color: #2a2a2a;
  letter-spacing: 2px;
  font-style: italic;
  text-align: center;
  border-bottom: 1px solid #0a0a0a;
  transition: color 0.8s;
  min-height: 44px;
}

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
  position: relative;
  overflow: hidden;
}

/* PnL card glow effect */
.card.glow-green { box-shadow: inset 0 0 30px rgba(0,230,118,0.05); }
.card.glow-red { box-shadow: inset 0 0 30px rgba(229,9,20,0.05); }

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

/* Sigma reaction toast */
.sigma-reaction {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.8);
  font-family: 'Orbitron', sans-serif;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 8px;
  color: #fff;
  text-shadow: 0 0 40px rgba(229,9,20,0.6), 0 0 80px rgba(229,9,20,0.3);
  opacity: 0;
  pointer-events: none;
  z-index: 10000;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  text-transform: uppercase;
}

.sigma-reaction.show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.sigma-reaction.fade {
  opacity: 0;
  transform: translate(-50%, -60%) scale(1.1);
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

/* Sigma watermark */
.watermark {
  position: fixed;
  bottom: 60px;
  right: 30px;
  font-family: 'Orbitron', sans-serif;
  font-size: 80px;
  font-weight: 900;
  color: rgba(255,255,255,0.015);
  letter-spacing: 10px;
  pointer-events: none;
  z-index: 1;
  user-select: none;
}
</style>
</head>
<body>

<div class="vignette"></div>
<div class="watermark" id="watermark"></div>

<div class="header">
  <div>
    <div class="title">SIGMA <span class="accent">TERMINAL</span></div>
    <div class="subtitle">Market Making Intelligence System</div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="switchBot('kalshi')">KALSHI</div>
    <div class="tab" onclick="switchBot('poly')">POLYMARKET</div>
  </div>
  <div class="header-right">
    <span id="sigma-status" class="sigma-status grinding">GRINDING</span>
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

<div class="sigma-reaction" id="reaction"></div>

<div class="audio-bar">
  <span class="track-name" id="track-name">GLADIATOR -- Rome Ambient</span>
  <audio id="player" controls loop src="/static/audio/rome_ambient.webm"></audio>
</div>

<script>
var QUOTES = [
  "I have to return some videotapes.",
  "There is an idea of a Patrick Bateman.",
  "I simply am not there.",
  "This is not an exit.",
  "I like to dissect girls. Did I say girls? I meant trades.",
  "Look at that subtle off-white coloring. The tasteful thickness of it.",
  "I live in the American Gardens Building on West 81st Street.",
  "In this moment, I am euphoric.",
  "While they sleep, we trade.",
  "The grind never stops. The grind never started. I am the grind.",
  "Discipline is the bridge between goals and accomplishment.",
  "Not luck. Preparation meeting opportunity.",
  "Sigma rule #1: Let the bots handle it.",
  "You mirin brah? -- Zyzz",
  "We're all gonna make it.",
  "I don't stop when I'm tired. I stop when I'm done.",
  "Average fan vs average enjoyer.",
  "Real human bean. And a real hero.",
  "I drive.",
  "There's 100 million contracts in this city. And I had to pick this one.",
  "The market is temporary. The grindset is forever.",
  "They don't know I'm running two bots.",
];

var SIGMA_REACTIONS = [
  "TOO SIGMA",
  "LITERALLY ME",
  "WE'RE SO BACK",
  "GIGACHAD",
  "BASED",
  "BUILT DIFFERENT",
];

var COPE_REACTIONS = [
  "NGMI",
  "IT'S OVER",
  "DOWN BAD",
  "JUST A SCRATCH",
  "STILL SIGMA",
  "TEMPORARY SETBACK",
];

var WATERMARKS = [
  "SIGMA",
  "GRIND",
  "ALPHA",
  "BASED",
];

var currentBot = 'kalshi';
var quoteIdx = 0;
var lastPnl = null;
var reactionTimeout = null;

function switchBot(bot) {
  currentBot = bot;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(bot.substring(0, 4)));
  });
  showReaction(bot === 'kalshi' ? 'KALSHI MODE' : 'POLY MODE');
  refresh();
}

function rotateQuote() {
  quoteIdx = (quoteIdx + 1) % QUOTES.length;
  var el = document.getElementById('quote');
  el.style.color = '#111';
  setTimeout(function() {
    el.textContent = '"' + QUOTES[quoteIdx] + '"';
    el.style.color = '#2a2a2a';
  }, 400);
}

function rotateWatermark() {
  var idx = Math.floor(Math.random() * WATERMARKS.length);
  document.getElementById('watermark').textContent = WATERMARKS[idx];
}

function showReaction(text) {
  var el = document.getElementById('reaction');
  if (reactionTimeout) clearTimeout(reactionTimeout);
  el.className = 'sigma-reaction';
  el.textContent = text;
  // Force reflow
  void el.offsetWidth;
  el.className = 'sigma-reaction show';
  reactionTimeout = setTimeout(function() {
    el.className = 'sigma-reaction fade';
  }, 1200);
}

function updateSigmaStatus(pnl, pairs) {
  var el = document.getElementById('sigma-status');
  if (pnl > 0) {
    el.textContent = 'WINNING';
    el.className = 'sigma-status winning';
  } else if (pnl < 0) {
    el.textContent = 'DOWN BAD';
    el.className = 'sigma-status down';
  } else if (pairs > 0) {
    el.textContent = 'IN POSITION';
    el.className = 'sigma-status grinding';
  } else {
    el.textContent = 'GRINDING';
    el.className = 'sigma-status grinding';
  }
}

async function refresh() {
  try {
    var prefix = currentBot === 'kalshi' ? '/api/kalshi' : '/api/poly';

    var status;
    try {
      status = await (await fetch(prefix + '/status')).json();
    } catch(e) {
      document.getElementById('stats').innerHTML = '<div class="empty-state">BOT OFFLINE -- TEMPORARILY TOUCHING GRASS</div>';
      updateSigmaStatus(0, 0);
      return;
    }

    if (status.error) {
      document.getElementById('stats').innerHTML = '<div class="empty-state">' + (currentBot === 'poly' ? 'POLYMARKET BOT OFFLINE -- NOT SIGMA ENOUGH' : 'KALSHI BOT OFFLINE -- RECALIBRATING AURA') + '</div>';
      updateSigmaStatus(0, 0);
      return;
    }

    var modeEl = document.getElementById('mode');
    var mode = status.mode || 'PAPER';
    modeEl.textContent = mode;
    modeEl.className = 'mode-badge ' + mode.toLowerCase();

    var pnl = status.total_pnl || 0;
    var avg = status.avg_pnl_per_pair || 0;

    // Check for PnL changes and show reactions
    if (lastPnl !== null && pnl !== lastPnl) {
      if (pnl > lastPnl) {
        var idx = Math.floor(Math.random() * SIGMA_REACTIONS.length);
        showReaction(SIGMA_REACTIONS[idx]);
      } else if (pnl < lastPnl) {
        var idx2 = Math.floor(Math.random() * COPE_REACTIONS.length);
        showReaction(COPE_REACTIONS[idx2]);
      }
    }
    lastPnl = pnl;

    updateSigmaStatus(pnl, status.pairs_open || 0);

    var glowClass = pnl > 0 ? ' glow-green' : (pnl < 0 ? ' glow-red' : '');

    document.getElementById('stats').innerHTML =
      '<div class="card' + glowClass + '"><div class="label">Total PnL</div><div class="value ' + (pnl >= 0 ? 'green' : 'red') + '">$' + pnl.toFixed(4) + '</div></div>' +
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
      if (Array.isArray(pairs) && pairs.length > 0) {
        document.querySelector('#pairs-table tbody').innerHTML = pairs.slice(0, 15).map(function(p) {
          var id = (p.pair_id || '').substring(0, 12);
          var market = p.ticker || p.market_question || '';
          if (market.length > 40) market = market.substring(0, 40) + '...';
          var asset = p.asset || '-';
          var st = p.status || 'open';
          var age = p.created_ago || '-';
          return '<tr><td>' + id + '</td><td>' + market + '</td><td>' + asset + '</td><td><span class="status-tag ' + st + '">' + st + '</span></td><td>' + age + '</td></tr>';
        }).join('');
      } else {
        document.querySelector('#pairs-table tbody').innerHTML = '<tr><td colspan="5" class="empty-state">No open positions -- patience is sigma</td></tr>';
      }
    } catch(e) {}

    // PnL
    try {
      var pnlData = await (await fetch(prefix + '/pnl')).json();
      if (Array.isArray(pnlData) && pnlData.length > 0) {
        document.querySelector('#pnl-table tbody').innerHTML = pnlData.slice(0, 15).map(function(p) {
          var rpnl = p.realized_pnl || 0;
          return '<tr><td>' + ((p.pair_id||'').substring(0,12)) + '</td><td>' + (p.ticker || p.market_id || '') + '</td><td>' + (p.yes_fill_price || 0) + '</td><td>' + (p.no_fill_price || 0) + '</td><td>' + (p.size || 0) + '</td><td>$' + (p.fees || 0).toFixed(4) + '</td><td style="color:' + (rpnl >= 0 ? '#00e676' : '#e50914') + '">$' + rpnl.toFixed(4) + '</td></tr>';
        }).join('');
      } else {
        document.querySelector('#pnl-table tbody').innerHTML = '<tr><td colspan="7" class="empty-state">No realized PnL yet -- the grind continues</td></tr>';
      }
    } catch(e) {}

    // Events
    try {
      var events = await (await fetch(prefix + '/events')).json();
      if (Array.isArray(events) && events.length > 0) {
        document.querySelector('#events-table tbody').innerHTML = events.slice(0, 20).map(function(e) {
          var details = e.details;
          if (typeof details === 'object' && details !== null) details = JSON.stringify(details);
          return '<tr><td>' + (e.time_ago || '-') + '</td><td>' + (e.event_type || '') + '</td><td>' + ((details || '').substring(0, 70)) + '</td></tr>';
        }).join('');
      } else {
        document.querySelector('#events-table tbody').innerHTML = '<tr><td colspan="3" class="empty-state">Silence before the storm</td></tr>';
      }
    } catch(e) {}

  } catch(err) {
    console.error('Refresh error:', err);
  }
}

// Init
rotateQuote();
rotateWatermark();
setInterval(rotateQuote, 8000);
setInterval(rotateWatermark, 15000);
refresh();
setInterval(refresh, 5000);

// Autoplay soundtrack on first user interaction (browsers block autoplay)
var audioStarted = false;
document.addEventListener('click', function() {
  if (!audioStarted) {
    var player = document.getElementById('player');
    player.volume = 0.3;
    player.play().catch(function() {});
    audioStarted = true;
  }
}, { once: true });
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
