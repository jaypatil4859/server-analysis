#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Server Analysis — Rollback Script
#  Rolls back to the previous git commit if a deploy goes wrong.
#
#  Usage:
#    sudo bash deployment/rollback.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Detect project root directory dynamically
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Configuration ─────────────────────────────────────────────────────────────
# Default deployment directory is where this script is located (PROJECT_ROOT)
APP_DIR="${1:-$PROJECT_ROOT}"
BACKEND_PORT=3971
YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅  $1${NC}"; }
fail() { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}── $1 ──${NC}"; }

[ "$EUID" -ne 0 ] && fail "Run as root: sudo bash deployment/rollback.sh"

echo ""
echo "╔═════════════════════════════╗"
echo "║  Server Analysis — Rollback ║"
echo "╚═════════════════════════════╝"

step "Rolling back git to previous commit"
cd "$APP_DIR"
CURRENT=$(git rev-parse --short HEAD)
git reset --hard HEAD~1
ROLLED=$(git rev-parse --short HEAD)
ok "Rolled back: $CURRENT → $ROLLED"

step "Rebuilding frontend"
cd "$APP_DIR/frontend"
npm ci --legacy-peer-deps && npm run build
mkdir -p "$APP_DIR/frontend/monitoring"
cp -r dist/. "$APP_DIR/frontend/monitoring/"
ok "Frontend rebuilt and deployed"

step "Reloading PM2"
cd "$APP_DIR"
pm2 reload server-analysis-backend
pm2 reload server-analysis-nagios-bridge
if pm2 list | grep -q "server-analysis-ssh-collector"; then
  pm2 reload server-analysis-ssh-collector
fi
pm2 save
ok "PM2 reloaded"

step "Health check"
sleep 3
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/health")
[ "$HTTP" = "200" ] && ok "Backend healthy after rollback" || fail "Backend unhealthy (HTTP $HTTP)"

echo ""
ok "Rollback complete. Now at commit: $(git log -1 --oneline)"
