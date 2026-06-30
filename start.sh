#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Server Analysis Analytics — One-Command Deploy Script
#
# Usage (on the production server, after git clone):
#   chmod +x start.sh
#   ./start.sh
#
# What it does:
#   1. Checks for required tools (Node.js 18+, npm, PM2)
#   2. Prompts to create .env files if missing
#   3. Installs dependencies (backend + frontend)
#   4. Builds the frontend (Vite → dist/)
#   5. Starts all services with PM2 (backend, frontend preview, nagios-bridge)
#   6. Prints live URLs
# ─────────────────────────────────────────────────────────────────────────────

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║      Server Analysis Analytics — Deploy          ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Check Node.js version ─────────────────────────────────────────────
echo -e "${BOLD}[1/5] Checking Node.js version...${RESET}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}ERROR: Node.js is not installed.${RESET}"
  echo "Install it with:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}ERROR: Node.js 18+ is required. You have v$(node -v).${RESET}"
  echo "Upgrade with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi
echo -e "  ${GREEN}✓ Node.js v$(node -v)${RESET}"

# ── Step 2: Check PM2 ─────────────────────────────────────────────────────────
echo -e "${BOLD}[2/5] Checking PM2...${RESET}"
if ! command -v pm2 &> /dev/null; then
  echo -e "${YELLOW}  PM2 not found. Installing globally...${RESET}"
  npm install -g pm2
fi
echo -e "  ${GREEN}✓ PM2 $(pm2 -v)${RESET}"

# ── Step 3: Check .env files ──────────────────────────────────────────────────
echo -e "${BOLD}[3/5] Checking environment configuration...${RESET}"

if [ ! -f "backend/.env" ]; then
  echo ""
  echo -e "${YELLOW}  ⚠  backend/.env not found.${RESET}"
  echo "  Creating from template..."
  cp backend/.env.example backend/.env
  echo ""
  echo -e "${RED}${BOLD}  ACTION REQUIRED: Edit backend/.env and set your MONGODB_URI:${RESET}"
  echo -e "  ${BOLD}  nano backend/.env${RESET}"
  echo ""
  echo "  The production MongoDB URI format is:"
  echo "  MONGODB_URI=mongodb://admin:PASSWORD@217.145.69.228:27017/server_analysis?authSource=admin"
  echo ""
  read -p "  Press ENTER after you have saved backend/.env to continue..." -r
fi

if [ ! -f ".env" ]; then
  echo ""
  echo -e "${YELLOW}  ⚠  Root .env not found (needed for Nagios bridge).${RESET}"
  echo "  Creating from template..."
  cp .env.example .env
  echo ""
  echo -e "${RED}${BOLD}  ACTION REQUIRED: Edit .env and set NAGIOS_PASS and MONGODB_URI:${RESET}"
  echo -e "  ${BOLD}  nano .env${RESET}"
  echo ""
  read -p "  Press ENTER after you have saved .env to continue..." -r
fi

echo -e "  ${GREEN}✓ Environment files ready${RESET}"

# ── Step 4: Install dependencies ──────────────────────────────────────────────
echo -e "${BOLD}[4/5] Installing dependencies...${RESET}"

echo "  Installing backend dependencies..."
cd backend && npm install --only=production --silent && cd ..
echo -e "  ${GREEN}✓ Backend deps installed${RESET}"

echo "  Installing frontend dependencies..."
cd frontend && npm install --silent && cd ..
echo -e "  ${GREEN}✓ Frontend deps installed${RESET}"

# ── Step 5: Build frontend ────────────────────────────────────────────────────
echo -e "${BOLD}[5/5] Building frontend for production...${RESET}"
cd frontend && npm run build && cd ..
echo -e "  ${GREEN}✓ Frontend built → frontend/dist/${RESET}"

# ── Step 6: Start with PM2 ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Starting all services with PM2...${RESET}"

# Stop existing processes if any
pm2 delete server-analysis-backend 2>/dev/null || true
pm2 delete server-analysis-frontend 2>/dev/null || true
pm2 delete server-analysis-nagios-bridge 2>/dev/null || true
pm2 delete server-analysis-ssh-collector 2>/dev/null || true

# Start fresh
pm2 start backend/server.js --name "server-analysis-backend"
pm2 start nagios-bridge.js --name "server-analysis-nagios-bridge"

# Start Vite Frontend (only if Vite is installed in frontend/node_modules)
if [ -f "frontend/node_modules/vite/bin/vite.js" ]; then
  pm2 start frontend/node_modules/vite/bin/vite.js --name "server-analysis-frontend" --cwd frontend -- preview
else
  echo -e "  [PM2 Info] Vite is not installed in frontend/node_modules. Skipping frontend PM2 process."
fi

# Save PM2 process list for auto-restart on reboot
pm2 save

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  ✓ Server Analysis Analytics is running!             ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Dashboard URL:${RESET}      http://${SERVER_IP}:3970/monitoring/"
echo -e "  ${BOLD}API Health Check:${RESET}   http://${SERVER_IP}:3971/health"
echo ""
echo -e "  ${BOLD}Useful PM2 commands:${RESET}"
echo "    pm2 list              — View all running processes"
echo "    pm2 logs              — View live log output"
echo "    pm2 logs server-analysis-nagios-bridge  — View Nagios bridge logs"
echo "    pm2 restart all       — Restart all services"
echo "    pm2 stop all          — Stop all services"
echo ""
echo -e "  ${BOLD}To enable auto-start on server reboot:${RESET}"
echo "    pm2 startup"
echo "    (run the command it prints, then: pm2 save)"
echo ""
