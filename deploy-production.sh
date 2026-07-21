#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Server Analysis Dashboard — Production Setup & Recovery Script
# Run this ONCE on the production server (217.145.69.228) as root.
# After running this, the dashboard runs 24/7 even if the DevOps laptop is OFF.
# ═══════════════════════════════════════════════════════════════════════════════

set -e
APP_DIR="/var/www/server-analysis"

echo "══════════════════════════════════════════════════════════"
echo " Server Analysis — PM2 Production Setup"
echo "══════════════════════════════════════════════════════════"

# ─── Step 1: Pull latest code ─────────────────────────────────────────────────
echo ""
echo "► Pulling latest code from GitHub..."
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git pull origin main

# ─── Step 2: Install dependencies ─────────────────────────────────────────────
echo ""
echo "► Installing backend dependencies..."
cd "$APP_DIR/backend"
npm ci --only=production

echo ""
echo "► Building frontend..."
cd "$APP_DIR/frontend"
npm ci --legacy-peer-deps
npm run build

echo ""
echo "► Copying frontend dist to web root..."
mkdir -p "$APP_DIR/frontend/monitoring"
cp -r "$APP_DIR/frontend/dist/." "$APP_DIR/frontend/monitoring/"

# ─── Step 3: Install PM2 globally (if not installed) ──────────────────────────
echo ""
echo "► Checking PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "  Installing PM2 globally..."
  npm install -g pm2
fi
echo "  PM2 version: $(pm2 --version)"

# ─── Step 4: Stop old processes cleanly ───────────────────────────────────────
echo ""
echo "► Stopping any existing PM2 processes..."
cd "$APP_DIR"
pm2 delete ecosystem.config.cjs 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# ─── Step 5: Start all processes via ecosystem config ─────────────────────────
echo ""
echo "► Starting all processes..."
cd "$APP_DIR"
pm2 start ecosystem.config.cjs

# ─── Step 6: Save PM2 process list so it survives reboot ──────────────────────
echo ""
echo "► Saving PM2 process list (survives server reboot)..."
pm2 save --force

# ─── Step 7: Set PM2 to auto-start on system boot ─────────────────────────────
echo ""
echo "► Configuring PM2 startup on system boot..."
pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup

echo ""
echo "══════════════════════════════════════════════════════════"
echo " ✅ Setup complete! Processes running:"
echo "══════════════════════════════════════════════════════════"
pm2 list

echo ""
echo "► Waiting 10s for bridge to connect to Nagios..."
sleep 10

echo ""
echo "► Health check..."
STATUS=$(curl -sf http://localhost:3971/health 2>/dev/null || echo "FAIL")
NAGIOS_STATUS=$(curl -sf http://localhost:3971/api/metrics/nagios-health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('reachable:',d['nagios']['reachable'],'pollCount:',d['bridge']['pollCount'])" 2>/dev/null || echo "endpoint-not-ready")
echo "  Backend: $STATUS"
echo "  Nagios : $NAGIOS_STATUS"

echo ""
echo "══════════════════════════════════════════════════════════"
echo " 🚀 Dashboard is now running 24/7 on this server."
echo "    The DevOps laptop can be turned OFF safely."
echo ""
echo " Useful commands:"
echo "   pm2 list                          # see all processes"
echo "   pm2 logs server-analysis-nagios-bridge --lines 50  # bridge logs"
echo "   pm2 logs server-analysis-backend  --lines 50        # backend logs"
echo "   pm2 restart all                   # restart everything"
echo "   pm2 reload ecosystem.config.cjs --update-env        # reload with new env"
echo "══════════════════════════════════════════════════════════"
