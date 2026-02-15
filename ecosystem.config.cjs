// pm2 ecosystem config -- manages all bots + dashboard
// Start all:    npx pm2 start ecosystem.config.cjs
// Status:       npx pm2 status
// Logs:         npx pm2 logs
// Stop all:     npx pm2 stop all
// Restart all:  npx pm2 restart all

const KALSHI = "C:\\Users\\JamesMorton\\OneDrive - MME (1)\\Desktop\\AI Kalshi";
const POLY = "C:\\Users\\JamesMorton\\OneDrive - MME (1)\\Desktop\\AI Polymarket";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const PYTHON = POLY + "\\.venv\\Scripts\\python.exe";
const TSX = KALSHI + "\\node_modules\\tsx\\dist\\cli.mjs";

module.exports = {
  apps: [
    {
      name: "sigma-dashboard",
      cwd: KALSHI,
      script: TSX,
      args: "src/sigma-dashboard.ts",
      interpreter: NODE,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 3000,
      watch: false,
    },
    {
      name: "kalshi-bot",
      cwd: KALSHI,
      script: TSX,
      args: "src/main.ts",
      interpreter: NODE,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 3000,
      watch: false,
    },
    {
      name: "poly-bot",
      cwd: POLY,
      script: "run.py",
      args: "mm",
      interpreter: PYTHON,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 3000,
      watch: false,
    },
    {
      name: "poly-dashboard",
      cwd: POLY,
      script: "run.py",
      args: "mm-dashboard",
      interpreter: PYTHON,
      autorestart: true,
      max_restarts: 100,
      restart_delay: 3000,
      watch: false,
    },
  ],
};
