# ServerPulse Analytics — Production Deployment Guide

> **For DevOps Engineers** — Everything needed to deploy, configure, and operate ServerPulse.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Port Assignments](#port-assignments)
3. [Pre-Deployment Checklist](#pre-deployment-checklist)
4. [Method A — Native VM (PM2 + Nginx)](#method-a--native-vm-pm2--nginx) ← *Recommended*
5. [Method B — Docker Compose](#method-b--docker-compose)
6. [CI/CD Pipeline (GitHub Actions)](#cicd-pipeline-github-actions)
7. [SSH Collector Setup](#ssh-collector-setup)
8. [Operations & Monitoring](#operations--monitoring)
9. [Rollback Procedure](#rollback-procedure)
10. [Troubleshooting](#troubleshooting)

---

## Architecture

```
Internet
   │
   ▼
[Nginx :3970]  ←─── Static React SPA (frontend/dist/)
   │                 Proxies /api/* and /health
   ▼
[PM2: Express :3971]  ←─── Node.js REST API
   │
   ▼
[MongoDB :27017]  ←─── 217.145.69.228 (remote) or localhost

[PM2: ssh-collector]  ─────────────► All 13 target servers via SSH (every 10s)
```

### Services

| Service | Technology | Port | Managed by |
|---|---|---|---|
| Frontend web UI | React + Vite → Nginx | **3970** | Nginx / Docker |
| Backend REST API | Node.js + Express | **3971** | PM2 / Docker |
| Database | MongoDB | 27017 | External host / Docker |
| Metrics Collector | Node.js SSH poller | — | PM2 / Docker |

---

## Port Assignments

| Port | Role |
|------|------|
| **3970** | HTTP — Frontend dashboard (public-facing) |
| **3971** | HTTP — Backend API (internal, proxied via Nginx) |
| **27017** | MongoDB (internal only — do NOT expose externally) |

---

## Pre-Deployment Checklist

Before running any deployment step, verify the following:

### 1. Create `backend/.env`

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Fill in:

```env
PORT=3971
MONGODB_URI=mongodb://admin:<PASSWORD>@217.145.69.228:27017/server_analysis?authSource=admin

# Optional — email alerts
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=alerts@company.com
SMTP_PASS=your_smtp_password
ALERT_EMAIL_RECIPIENT=devops@company.com

# Optional — webhook alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

> ⚠️ Never commit `backend/.env` — it is in `.gitignore`

### 2. Verify SSH key access for the collector

The collector (`ssh-collector.js`) connects via SSH to all 13 monitored servers. Ensure the user running PM2 has passwordless SSH access:

```bash
# Test connectivity to one server
ssh -i /home/devops/.ssh/id_rsa root@180.187.54.31 "uptime"
```

### 3. Open firewall ports

```bash
# Allow frontend port (public)
sudo ufw allow 3970/tcp

# Allow Nginx management (optional)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Backend port is INTERNAL ONLY — NOT exposed publicly
# MongoDB port is INTERNAL ONLY — NOT exposed publicly
```

---

## Method A — Native VM (PM2 + Nginx)

### Prerequisites

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# PM2 process manager
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx
```

### One-Command Deploy

```bash
# Clone the repo
git clone https://github.com/YOUR_ORG/server-analysis.git /var/www/serverpulse
cd /var/www/serverpulse

# Configure environment (REQUIRED before first run)
cp backend/.env.example backend/.env
nano backend/.env   # ← fill in MONGODB_URI and any alert settings

# Run the deploy script
sudo bash deployment/deploy.sh
```

The deploy script automatically:
- Installs npm packages
- Builds the frontend production bundle
- Copies static files to the Nginx web root
- Configures and reloads Nginx
- Starts all PM2 processes with auto-restart on boot
- Runs a health check

### Manual Step-by-Step

If you prefer to run steps manually:

```bash
# 1. Install dependencies
cd backend && npm ci --only=production && cd ..
cd frontend && npm ci && cd ..

# 2. Build frontend
cd frontend && npm run build && cd ..

# 3. Deploy static files
sudo mkdir -p /var/www/serverpulse/frontend
sudo cp -r frontend/dist/. /var/www/serverpulse/frontend/

# 4. Configure Nginx
sudo cp deployment/nginx.native.conf /etc/nginx/sites-available/serverpulse
sudo ln -sf /etc/nginx/sites-available/serverpulse /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 5. Start PM2
pm2 start ecosystem.config.cjs
pm2 startup && pm2 save

# 6. Verify
curl -s http://localhost:3971/health
```

### Update an Existing Deployment

```bash
cd /var/www/serverpulse
git pull origin main
sudo bash deployment/deploy.sh
```

---

## Method B — Docker Compose

> Use this for isolated containerised deployments with bundled MongoDB.

### Prerequisites

```bash
# Docker + Docker Compose
curl -fsSL https://get.docker.com | bash
sudo apt-get install -y docker-compose-plugin
```

### Deploy

```bash
git clone https://github.com/YOUR_ORG/server-analysis.git
cd server-analysis

# Create a .env file in the root for Docker Compose variable expansion
cat > .env << 'EOF'
SSH_KEY_PATH=/home/devops/.ssh/id_rsa
SSH_USER=root
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_RECIPIENT=
SLACK_WEBHOOK_URL=
DISCORD_WEBHOOK_URL=
EOF

# Build and start all containers
docker compose up -d --build
```

### Containers Launched

| Container | Image | Host Port |
|---|---|---|
| `serverpulse-frontend` | Custom Nginx | **3970** |
| `serverpulse-backend` | Custom Node.js | **3971** (internal) |
| `serverpulse-db` | `mongo:7.0` | 27017 (internal) |
| `serverpulse-collector` | `node:18-alpine` | — |

### Docker Commands

```bash
docker compose logs -f               # Live logs from all containers
docker compose logs -f backend       # Backend logs only
docker compose restart backend       # Restart one service
docker compose down                  # Stop all
docker compose up -d --build         # Rebuild and restart
docker compose exec backend sh       # Shell into backend container
```

---

## CI/CD Pipeline (GitHub Actions)

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

### How it works

| Trigger | Action |
|---|---|
| Push to `main` or Pull Request | Runs **build + test** (npm install, frontend build, backend smoke test) |
| Push to `main` only | After tests pass: SSHes into production server and runs deploy script |

### Setup

1. Go to: **GitHub → Repo → Settings → Secrets and variables → Actions**
2. Add these secrets (see [deployment/GITHUB_SECRETS.md](deployment/GITHUB_SECRETS.md) for details):

| Secret | Value |
|---|---|
| `PROD_SERVER_HOST` | Production server IP / hostname |
| `PROD_SERVER_USER` | SSH username (e.g. `devops`) |
| `PROD_SSH_PRIVATE_KEY` | Full contents of the SSH private key |

3. Every push to `main` now auto-deploys to production. ✅

---

## SSH Collector Setup

The collector (`ssh-collector.js`) runs as a PM2 daemon on the dashboard server and polls all 13 monitored servers every 10 seconds via SSH.

### Configure `ecosystem.config.cjs`

```js
// Under: serverpulse-ssh-collector → env
SSH_USER: 'root',                        // ← SSH login user
SSH_KEY_PATH: '/home/devops/.ssh/id_rsa' // ← Absolute path to private key
```

### Update the server list

If server IPs change, edit `ssh-collector.js`:

```js
const SERVERS = [
  { id: 'in31',      host: '180.187.54.31',  name: 'in31',      user: SSH_USER },
  { id: 'in44',      host: '180.187.54.44',  name: 'in44',      user: SSH_USER },
  // ... add/remove servers here
];
```

### Running as a Standalone Agent (on a separate server)

To run the collector on a different machine:

```bash
METRICS_API_URL=http://your-dashboard-server:3971/api/metrics \
SSH_USER=root \
SSH_KEY_PATH=/home/devops/.ssh/id_rsa \
node ssh-collector.js
```

Or with PM2:

```bash
pm2 start ssh-collector.js --name serverpulse-ssh-collector \
  --env METRICS_API_URL=http://dashboard-ip:3971/api/metrics
pm2 save
```

---

## Operations & Monitoring

### PM2 Commands

```bash
pm2 status                         # All process health
pm2 logs                           # Live log stream (all)
pm2 logs serverpulse-backend       # Backend logs only
pm2 logs serverpulse-ssh-collector # Collector logs
pm2 restart serverpulse-backend    # Restart backend
pm2 reload ecosystem.config.cjs    # Zero-downtime reload
pm2 monit                          # Real-time CPU/RAM dashboard
```

### API Health Checks

```bash
# Backend health
curl -s http://localhost:3971/health

# Current server metrics
curl -s http://localhost:3971/api/metrics/current | python3 -m json.tool

# Active alerts
curl -s http://localhost:3971/api/metrics/alerts | python3 -m json.tool

# Laptop metrics
curl -s http://localhost:3971/api/laptop/current | python3 -m json.tool
```

### Nginx

```bash
sudo nginx -t                      # Test config
sudo systemctl reload nginx        # Reload config
sudo systemctl status nginx        # Service status
sudo tail -f /var/log/nginx/error.log  # Error logs
```

---

## Rollback Procedure

If a deploy causes issues, run the rollback script to revert to the previous commit:

```bash
sudo bash deployment/rollback.sh
```

This will:
1. `git reset --hard HEAD~1` (reverts code)
2. Rebuild the frontend
3. Reload PM2
4. Run a health check

---

## Troubleshooting

### Backend not responding

```bash
pm2 logs serverpulse-backend    # Check for errors
pm2 restart serverpulse-backend # Try restarting
curl -v http://localhost:3971/health
```

### MongoDB connection fails

```bash
# The backend falls back to in-memory storage if MongoDB is unreachable
# Check .env MONGODB_URI is correct:
cat backend/.env | grep MONGO

# Test connectivity directly:
mongosh "mongodb://admin:<pass>@217.145.69.228:27017/server_analysis?authSource=admin"
```

### Nginx 502 Bad Gateway

```bash
# Backend process is likely down
pm2 status
pm2 restart serverpulse-backend
sudo systemctl reload nginx
```

### SSH Collector shows "SSH connection failed"

```bash
# Test SSH access manually:
ssh -i /home/devops/.ssh/id_rsa root@<server-ip> "uptime"

# Check key permissions:
chmod 600 /home/devops/.ssh/id_rsa

# Check collector logs:
pm2 logs serverpulse-ssh-collector --lines 50
```

### Port already in use

```bash
# Find what's using the port
lsof -i :3971
lsof -i :3970

# Kill conflicting process if safe to do so
kill -9 <PID>
```

---

## Contact

For any deployment issues, reach out to the development team via the project repository issue tracker.
