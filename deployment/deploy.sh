#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Server Analysis — Production Deploy Script
#  Run this on the production server to install/update the application.
#
#  Usage:
#    chmod +x deployment/deploy.sh
#    sudo bash deployment/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Detect project root directory dynamically
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Configuration ─────────────────────────────────────────────────────────────
# Default deployment directory is where this script is located (PROJECT_ROOT)
APP_DIR="${1:-$PROJECT_ROOT}"
FRONTEND_ROOT="$APP_DIR/frontend"
NGINX_CONF="/etc/nginx/sites-available/server-analysis"
NGINX_ENABLED="/etc/nginx/sites-enabled/server-analysis"
BACKEND_PORT=3971
FRONTEND_PORT=3970

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
fail() { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}── $1 ──${NC}"; }

# ── Must run as root ───────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  fail "Please run as root: sudo bash deployment/deploy.sh"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     Server Analysis Production Deploy        ║"
echo "╚══════════════════════════════════════════════╝"

# ── 1. Check prerequisites ─────────────────────────────────────────────────────
step "Checking prerequisites"
for cmd in node npm pm2 nginx git curl; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd found ($(command -v $cmd))"
  else
    fail "$cmd is not installed. Install it first."
  fi
done

NODE_VER=$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null && node --version || true)
node -e "if(parseInt(process.versions.node.split('.')[0]) < 18) process.exit(1)" \
  || fail "Node.js 18+ required. Current: $(node --version)"
ok "Node.js version OK: $(node --version)"

# ── 2. Create app directory ────────────────────────────────────────────────────
step "Setting up directories"
if [ "$PROJECT_ROOT" != "$APP_DIR" ]; then
  mkdir -p "$APP_DIR" "$FRONTEND_ROOT"
  ok "Created App dir: $APP_DIR"
else
  ok "Using existing directory (in-place deploy): $APP_DIR"
fi

# ── 3. Copy project files ──────────────────────────────────────────────────────
step "Copying project files"
if [ "$PROJECT_ROOT" != "$APP_DIR" ]; then
  rsync -av --exclude='node_modules' --exclude='.git' --exclude='frontend/dist' \
    --exclude='*.log' --exclude='*.zip' --exclude='*.png' \
    "$PROJECT_ROOT/" "$APP_DIR/"
  ok "Files synced to $APP_DIR"
else
  ok "Running in-place deploy (skipping rsync since PROJECT_ROOT == APP_DIR)"
fi

# ── 4. Set up backend .env ─────────────────────────────────────────────────────
step "Configuring backend environment"
if [ ! -f "$APP_DIR/backend/.env" ]; then
  if [ -f "$APP_DIR/backend/.env.example" ]; then
    cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
    warn "Created $APP_DIR/backend/.env from template — EDIT IT before starting the service!"
    warn "  Set MONGODB_URI to your production database connection string."
  fi
else
  ok "backend/.env already exists — not overwriting"
fi

# ── 5. Install dependencies ────────────────────────────────────────────────────
step "Installing backend dependencies"
cd "$APP_DIR/backend"
npm ci --only=production
ok "Backend npm packages installed"

step "Installing & building frontend"
cd "$APP_DIR/frontend"
npm ci --legacy-peer-deps
npm run build
ok "Frontend production bundle built"

# ── 6. Copy frontend dist to web root ─────────────────────────────────────────
step "Deploying frontend assets"
mkdir -p "$FRONTEND_ROOT/monitoring"
cp -r "$APP_DIR/frontend/dist/." "$FRONTEND_ROOT/monitoring/"
ok "Frontend assets deployed to $FRONTEND_ROOT/monitoring"

# Ensure Nginx user (www-data) can read built assets and traverse the app path
if id -u www-data &>/dev/null; then
  curr="$FRONTEND_ROOT/monitoring"
  while [ "$curr" != "/" ] && [ -n "$curr" ]; do
    chmod +x "$curr" 2>/dev/null || true
    curr="$(dirname "$curr")"
  done
  chown -R www-data:www-data "$FRONTEND_ROOT/monitoring" 2>/dev/null || true
  chmod -R 755 "$FRONTEND_ROOT/monitoring" 2>/dev/null || true
  ok "Configured permissions for Nginx (www-data)"
fi

# ── 7. Configure Nginx ─────────────────────────────────────────────────────────
step "Configuring Nginx"
cp "$APP_DIR/deployment/nginx.native.conf" "$NGINX_CONF"
sed -i "s|/var/www/server-analysis/frontend|$FRONTEND_ROOT|g" "$NGINX_CONF"

if [ ! -L "$NGINX_ENABLED" ]; then
  ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
  ok "Nginx site enabled"
fi

# Remove default site to avoid port conflicts
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm /etc/nginx/sites-enabled/default
  warn "Removed default Nginx site"
fi

nginx -t || fail "Nginx config test failed — check $NGINX_CONF"
systemctl reload nginx
ok "Nginx reloaded successfully"

# ── 8. Start/Reload PM2 ────────────────────────────────────────────────────────
step "Starting PM2 processes"
cd "$APP_DIR"
if pm2 list | grep -q "server-analysis-backend"; then
  pm2 reload server-analysis-backend
  ok "Backend process reloaded"
else
  pm2 start backend/server.js --name "server-analysis-backend"
  ok "Backend process started"
fi

if pm2 list | grep -q "server-analysis-nagios-bridge"; then
  pm2 reload server-analysis-nagios-bridge
  ok "Nagios bridge process reloaded"
else
  pm2 start nagios-bridge.js --name "server-analysis-nagios-bridge"
  ok "Nagios bridge process started"
fi

if pm2 list | grep -q "server-analysis-ssh-collector"; then
  pm2 reload server-analysis-ssh-collector
  ok "SSH collector process reloaded"
fi

pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true
pm2 save
ok "PM2 saved and set to start on boot"

# ── 9. Health check ────────────────────────────────────────────────────────────
step "Running health check"
sleep 3
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$BACKEND_PORT/health")
if [ "$HTTP" = "200" ]; then
  ok "Backend health check passed (HTTP $HTTP)"
else
  fail "Backend health check failed (HTTP $HTTP). Check: pm2 logs server-analysis-backend"
fi

# ── 10. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║            ✅  Deploy Complete               ║"
echo "╠══════════════════════════════════════════════╣"
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "║  Dashboard  →  http://$SERVER_IP:$FRONTEND_PORT       "
echo "║  Backend    →  http://localhost:$BACKEND_PORT         "
echo "║                                              ║"
echo "║  pm2 status          — process health        ║"
echo "║  pm2 logs            — live logs             ║"
echo "║  pm2 restart all     — restart               ║"
echo "╚══════════════════════════════════════════════╝"
