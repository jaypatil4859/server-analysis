# DevOps Production Deployment Guide (Linux, Nginx, PM2)

This guide provides an error-free, step-by-step procedure to deploy the **Server Analysis Analytics** dashboard on a Linux production server.

---

## 📋 Table of Contents
1. [System Prerequisites](#1-system-prerequisites)
2. [Fastest Method: One-Command Deploy Script](#method-a-fastest-one-command-deploy)
3. [Manual Method: PM2 + Nginx Reverse Proxy (Recommended for Production)](#method-b-recommended-manual-pm2--nginx)
4. [Nginx Configuration (Crucial Syntax Fix)](#nginx-configuration-crucial-syntax-fix)
5. [Process Management (PM2)](#process-management-pm2)
6. [Troubleshooting & Verification](#troubleshooting--verification)

---

## 1. System Prerequisites

Ensure the following are installed on the production server:
* **Node.js** v18 or v20+
* **npm** v10+
* **git**
* **PM2** (Process Manager 2)
* **Nginx** (Web Server)

To install Node.js and PM2 globally on Ubuntu/Debian:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
```

---

## ⚡ Method A: One-Command Deploy (Fastest)

A custom script is provided to automate dependency installation, building, and PM2 process initialization:

1. Clone the repository and navigate to the directory:
   ```bash
   git clone <your-repo-url> /var/www/server-analysis
   cd /var/www/server-analysis
   ```
2. Copy environment templates:
   ```bash
   cp backend/.env.example backend/.env
   cp .env.example .env
   ```
3. Open both `.env` files and enter your database credentials and Nagios password:
   ```bash
   nano backend/.env
   nano .env
   ```
4. Run the deploy script:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
   *The script will install all dependencies, build the frontend, and start the processes under PM2.*

---

## 🔧 Method B: Manual PM2 + Nginx (Recommended for Production)

For maximum performance, Nginx serves the built static frontend assets directly (no Node process overhead for static serving), and reverse-proxies API calls to the Express server running under PM2.

### Step 1: Install Dependencies
```bash
# Install backend production dependencies
cd backend && npm install --only=production && cd ..

# Install frontend dependencies (needed for building)
cd frontend && npm install && cd ..
```

### Step 2: Build Frontend Static Assets
```bash
cd frontend
npm run build
cd ..
```
*This generates a production build directory at `frontend/dist/` under the `/monitoring/` base path.*

### Step 3: Start Node API and Nagios Bridge via PM2
```bash
# Start backend REST API
pm2 start backend/server.js --name "server-analysis-backend"

# Start Nagios integration bridge
pm2 start nagios-bridge.js --name "server-analysis-nagios-bridge"

pm2 save
```
*PM2 will start the apps, which will automatically read configuration from the `.env` files:*
1. `server-analysis-backend` (REST API on port `3971`)
2. `server-analysis-nagios-bridge` (polls the Nagios server and forwards data to the backend)
*(Static assets are served directly by Nginx, so there is no PM2 process for the frontend on production servers).*

---

## 🌐 Nginx Configuration (Crucial Syntax Fix)

Ensure your Nginx configuration matches the block below. 

> [!IMPORTANT]
> **Avoid Nesting Locations**: Ensure the `/monitoring-apis/` location block is defined independently at the server level, **not nested** inside the `/monitoring/` location block. Nested location blocks will cause Nginx matching failures and lead to `404 Not Found` API health errors.

Edit your Nginx server config block (e.g., `/etc/nginx/sites-available/default`):
```nginx
server {
    listen 80;
    server_name your_domain_or_ip; # e.g., 217.145.69.228

    # 1. Serve frontend static files directly from dist/
    location /monitoring/ {
        alias /var/www/server-analysis/frontend/dist/;
        index index.html;
        try_files $uri $uri/ /monitoring/index.html;
    }

    # 2. Proxy API calls to the PM2 Express backend
    location /monitoring-apis/ {
        proxy_pass http://127.0.0.1:3971/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 📊 Process Management (PM2)

Manage the backend processes using standard PM2 commands:

```bash
# View running apps and status
pm2 list

# View live consolidated logs
pm2 logs

# View logs for Nagios bridge specifically
pm2 logs server-analysis-nagios-bridge

# Restart all apps
pm2 restart all

# Save process list for startup loading
pm2 save
```

To enable auto-start on server reboots:
```bash
pm2 startup
# Run the generated command outputted by the shell, then:
pm2 save
```

---

## 🛠 Troubleshooting & Verification

* **Check Backend Health**:
  ```bash
  curl http://127.0.0.1:3971/health
  # Expected: {"status":"healthy","timestamp":"..."}
  ```
* **Verify Proxy Route through Nginx**:
  ```bash
  curl http://localhost/monitoring-apis/health
  # Expected: {"status":"healthy","timestamp":"..."}
  ```
* **Check MongoDB Connection**:
  If the backend fails to connect to MongoDB, verify the `MONGODB_URI` in `backend/.env` is accessible and the password is correct. If unreachable, the server will gracefully fallback to local in-memory storage.
