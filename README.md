# Server Analysis Analytics

> Real-time multi-server performance & load monitoring dashboard.

[![Deploy](https://github.com/YOUR_ORG/server-analysis/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR_ORG/server-analysis/actions/workflows/deploy.yml)

---

## What is Server Analysis?

Server Analysis is a self-hosted analytics dashboard that monitors CPU, RAM, disk, load average, and alerts across a fleet of Linux servers in real time. It connects directly to server kernels via SSH — no agent installation required on target machines.

**Live at:** `http://your-server-ip:3970`

---

## Quick Start (Production)

```bash
# 1. Clone
git clone https://github.com/YOUR_ORG/server-analysis.git
cd server-analysis

# 2. Configure environment
cp backend/.env.example backend/.env
nano backend/.env   # ← Set MONGODB_URI + alert settings

# 3. Deploy
sudo bash deployment/deploy.sh
```

> See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete DevOps guide.

---

## Architecture

| Layer | Technology | Port |
|---|---|---|
| Frontend | React + Vite → served by Nginx | **3970** |
| Backend API | Node.js + Express (PM2) | **3971** |
| Database | MongoDB | 27017 |
| SSH Collector | Node.js daemon (PM2) | — |

---

## Repository Structure

```
server-analysis/
├── backend/               # Express REST API
│   ├── routes/            # API route handlers
│   ├── models/            # Mongoose schemas
│   ├── server.js          # Entry point
│   └── .env.example       # Environment template
├── frontend/              # React (Vite) dashboard
│   ├── src/               # Source code
│   ├── dist/              # Built assets (git-ignored)
│   └── nginx.conf         # Nginx config (Docker)
├── deployment/            # DevOps assets
│   ├── deploy.sh          # One-command deploy script
│   ├── rollback.sh        # Emergency rollback
│   ├── nginx.native.conf  # Nginx config (native)
│   ├── nginx.native.ssl.conf  # Nginx config (SSL)
│   └── GITHUB_SECRETS.md  # CI/CD secrets guide
├── .github/workflows/     # GitHub Actions CI/CD
│   └── deploy.yml
├── ssh-collector.js       # Real-time SSH metrics collector
├── collector.js           # Per-server agent (optional)
├── laptop-collector.js    # Laptop telemetry agent
├── ecosystem.config.cjs   # PM2 process config
├── docker-compose.yml     # Docker Compose stack
└── DEPLOYMENT.md          # Full DevOps handover guide
```

---

## Deployment Methods

### Option 1 — Native VM (Recommended)

Runs on any Ubuntu/Debian server with Node.js 20, Nginx, and PM2.

```bash
sudo bash deployment/deploy.sh
```

### Option 2 — Docker Compose

Spin up the full stack (frontend + backend + MongoDB + collector) in containers:

```bash
docker compose up -d --build
```

### Option 3 — CI/CD Auto-Deploy

Push to `main` → GitHub Actions builds and deploys automatically.
See [deployment/GITHUB_SECRETS.md](deployment/GITHUB_SECRETS.md) for setup.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Backend server port | `3971` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/server_analysis` |
| `SMTP_HOST` | Email alert SMTP server | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `ALERT_EMAIL_RECIPIENT` | Alert destination email | — |
| `SLACK_WEBHOOK_URL` | Slack webhook for alerts | — |
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts | — |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Service health check |
| GET | `/api/metrics/current` | Latest metrics for all servers |
| GET | `/api/metrics/combustion-summary` | CPU/RAM peaks per server |
| GET | `/api/metrics/ram-history-24h` | 24h RAM usage history |
| GET | `/api/metrics/history-weekly` | 7-day aggregated history |
| GET | `/api/metrics/peak-analysis` | Hourly peak patterns |
| GET | `/api/metrics/alerts` | Active threshold alerts |
| POST | `/api/metrics` | Ingest new server metric |
| GET | `/api/laptop/current` | Latest laptop telemetry |
| POST | `/api/laptop` | Ingest laptop telemetry |

---

## Operations

```bash
pm2 status                      # Process health
pm2 logs                        # Live log stream
pm2 restart server-analysis-backend # Restart backend
curl http://localhost:3971/health  # Health check
```

---

## Local Development

```bash
# Terminal 1 — Backend
cd backend && node server.js    # → http://localhost:3971

# Terminal 2 — Frontend
cd frontend && npm run dev      # → http://localhost:3970 (proxies /api → :3971)
```
