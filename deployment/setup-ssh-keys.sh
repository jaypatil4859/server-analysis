#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ServerPulse — Automated SSH Key Distribution Script
#  Distributes the SSH public key to all 13 production target servers automatically.
#
#  Usage:
#    chmod +x deployment/setup-ssh-keys.sh
#    ./deployment/setup-ssh-keys.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SSH_USER="root"
PUB_KEY_PATH="${HOME}/.ssh/id_rsa.pub"

# List of target servers
declare -A SERVERS=(
  ["in31"]="180.187.54.31"
  ["in44"]="180.187.54.44"
  ["newmongo"]="161.248.37.104"
  ["newprod"]="161.248.37.102"
  ["newprodp1"]="161.248.37.181"
  ["newprodp2"]="161.248.37.103"
  ["newprodp3"]="43.113.189.106"
  ["punctualiti.co"]="43.242.212.71"
  ["rahehamysql"]="161.248.37.87"
  ["raheja-app"]="161.248.37.85"
  ["rahejamongo"]="161.248.37.86"
  ["sgdb"]="154.210.160.250"
  ["sify-app"]="100.85.117.165"
)

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
fail() { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}── $1 ──${NC}"; }

# ── Verify public key exists ──────────────────────────────────────────────────
if [ ! -f "$PUB_KEY_PATH" ]; then
  fail "Public key not found at $PUB_KEY_PATH. Please generate one first using: ssh-keygen -t rsa -b 4096"
fi

# ── Ask for common password (optional automation) ─────────────────────────────
step "Preparing Deployment"
echo -e "This script will copy your public key ($PUB_KEY_PATH) to all target servers."
echo -e "You will be prompted for the SSH password for each server unless keys are already configured."
echo ""
read -sp "Enter SSH password (leave empty to enter manually for each server): " SSH_PASSWORD
echo ""

# Install sshpass if password is provided
USE_SSHPASS=false
if [ -n "$SSH_PASSWORD" ]; then
  if command -v sshpass &>/dev/null; then
    USE_SSHPASS=true
  else
    warn "sshpass is not installed. Attempting to install it..."
    if command -v apt-get &>/dev/null; then
      sudo apt-get update && sudo apt-get install -y sshpass
      USE_SSHPASS=true
    elif command -v yum &>/dev/null; then
      sudo yum install -y sshpass
      USE_SSHPASS=true
    else
      warn "Could not install sshpass automatically. Falling back to manual password entry."
    fi
  fi
fi

# ── Distribute Keys ───────────────────────────────────────────────────────────
step "Distributing SSH Keys"

for name in "${!SERVERS[@]}"; do
  ip="${SERVERS[$name]}"
  echo -e "Copying key to ${name} (${ip})..."
  
  if [ "$USE_SSHPASS" = true ]; then
    # Disable strict host key checks so it does not prompt to accept host fingerprints
    if sshpass -p "$SSH_PASSWORD" ssh-copy-id -o StrictHostKeyChecking=no -i "$PUB_KEY_PATH" "${SSH_USER}@${ip}" &>/dev/null; then
      ok "Key copied to ${name} successfully!"
    else
      fail "Failed to copy key to ${name} (${ip}) using password."
    fi
  else
    # Manual password fallback
    if ssh-copy-id -o StrictHostKeyChecking=no -i "$PUB_KEY_PATH" "${SSH_USER}@${ip}"; then
      ok "Key copied to ${name} successfully!"
    else
      warn "Failed to copy key to ${name} (${ip}). Skipping..."
    fi
  fi
done

step "Verification Check"
echo "Testing connection to all servers without passwords..."
for name in "${!SERVERS[@]}"; do
  ip="${SERVERS[$name]}"
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 "${SSH_USER}@${ip}" "exit" &>/dev/null; then
    ok "${name} (${ip}): Connected successfully!"
  else
    fail "${name} (${ip}): Connection failed."
  fi
done

echo ""
ok "SSH Key distribution complete!"
