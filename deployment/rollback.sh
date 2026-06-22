#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ServerPulse — Rollback Script
#  Rolls back to the previous git commit if a deploy goes wrong.
#
#  Usage:
#    sudo bash deployment/rollback.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="/var/www/serverpulse"
BACKEND_PORT=3971
YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅  $1${NC}"; }
fail() { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}── $1 ──${NC}"; }

[ "$EUID" -ne 0 ] && fail "Run as root: sudo bash deployment/rollback.sh"

echo ""
echo "╔═════════════════════════════╗"
echo "║  ServerPulse — Rollback     ║"
echo "╚═════════════════════════════╝"

step "Rolling back git to previous commit"
cd "$APP_DIR"
CURRENT=$(git rev-parse --short HEAD)
git reset --hard HEAD~1
ROLLED=$(git rev-parse --short HEAD)
ok "Rolled back: $CURRENT → $ROLLED"

step "Rebuilding frontend"
cd "$APP_DIR/frontend"
npm ci && npm run build
cp -r dist/. /var/www/serverpulse/frontend/
ok "Frontend rebuilt and deployed"

step "Reloading PM2"
cd "$APP_DIR"
pm2 reload ecosystem.config.cjs --update-env
pm2 save
ok "PM2 reloaded"

step "Health check"
sleep 3
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/health")
[ "$HTTP" = "200" ] && ok "Backend healthy after rollback" || fail "Backend unhealthy (HTTP $HTTP)"

echo ""
ok "Rollback complete. Now at commit: $(git log -1 --oneline)"
