# DevOps Master Production Deployment & Troubleshooting Guide (PM2 + Nginx)

This guide provides the complete, standalone manual procedure to deploy, manage, and troubleshoot the **Server Analysis Analytics** dashboard in a Linux production environment using **PM2** and **Nginx Reverse Proxy**.

---

## 📋 Table of Contents
1. [System Prerequisites](#1-system-prerequisites)
2. [Step-by-Step Manual Deployment](#2-step-by-step-manual-deployment)
3. [Nginx Configuration](#3-nginx-configuration)
4. [Process Management with PM2](#4-process-management-with-pm2)
5. [DevOps Troubleshooting & Error Resolution Guide](#5-devops-troubleshooting--error-resolution-guide)

---

## 1. System Prerequisites

Install the required packages on your Ubuntu/Debian production server:
```bash
# Update package repositories
sudo apt update && sudo apt upgrade -y

# Install Node.js v20, Nginx, and Git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git

# Install PM2 globally
sudo npm install -g pm2
```

Verify the installations:
```bash
node -v  # Expected: v20.x.x
npm -v   # Expected: v10.x.x
pm2 -v   # Expected: v5.x.x
nginx -v # Expected: nginx/1.x.x
```

---

## 2. Step-by-Step Manual Deployment

Follow these commands to deploy the dashboard manually.

### Step 2.1: Clone and Position Codebase
```bash
git clone <your-repo-url> /var/www/server-analysis
cd /var/www/server-analysis
```

### Step 2.2: Configure Environments
Copy the environment template files:
```bash
cp backend/.env.example backend/.env
cp .env.example .env
```

Configure backend settings in `/var/www/server-analysis/backend/.env`:
```env
PORT=3971
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
```

Configure Nagios settings in `/var/www/server-analysis/.env`:
```env
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
NAGIOS_URL=http://217.145.69.228/nagios
NAGIOS_USER=nagiosadmin
NAGIOS_PASS=4z1lO3lXxNa$
METRICS_API_URL=http://localhost:3971/api/metrics
POLL_INTERVAL_MS=30000
```

### Step 2.3: Install Dependencies
```bash
# Install backend production dependencies
cd /var/www/server-analysis/backend
npm install --only=production

# Install frontend builder dependencies
cd /var/www/server-analysis/frontend
npm install
```

### Step 2.4: Build Frontend Assets
```bash
cd /var/www/server-analysis/frontend
npm run build
```
*This generates a production build directory at `/var/www/server-analysis/frontend/dist/` under the `/monitoring/` base path.*

### Step 2.5: Run Backend Processes under PM2
```bash
cd /var/www/server-analysis

# Start Node.js API server
pm2 start backend/server.js --name "server-analysis-backend"

# Start Nagios integration bridge
pm2 start nagios-bridge.js --name "server-analysis-nagios-bridge"

# Save PM2 process list so it persists across reboots
pm2 save
```

---

## 3. Nginx Configuration

Nginx serves the built static frontend assets directly (highly performant) and reverse-proxies `/monitoring-apis/` paths to the Express API running on port `3971`.

> [!IMPORTANT]
> **Nginx Routing Rules (Critical)**: Ensure that the `/monitoring-apis/` location block is defined independently at the server level, **not nested** inside the `/monitoring/` location block. Nested location blocks will cause routing errors and yield `404 Not Found` API health responses.

Create or edit your site configuration (e.g., `/etc/nginx/sites-available/server-analysis`):
```nginx
server {
    listen 80;
    server_name your_domain_or_ip; # e.g. 217.145.69.228

    # 1. Serve frontend static files
    location /monitoring/ {
        alias /var/www/server-analysis/frontend/dist/;
        index index.html;
        try_files $uri $uri/ /monitoring/index.html;
    }

    # 2. Proxy API calls to Express backend running on PM2
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

    # 3. Redirect root requests to dashboard
    location = / {
        return 301 /monitoring/;
    }
}
```

Enable the configuration and reload Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/server-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## 4. Process Management with PM2

Devops Commands Reference:
```bash
pm2 list                              # View running processes
pm2 logs                              # View live log streams (all)
pm2 logs server-analysis-backend       # View backend log stream
pm2 logs server-analysis-nagios-bridge # View Nagios bridge logs
pm2 restart all                       # Restart all PM2 applications
pm2 stop all                          # Stop all PM2 applications
pm2 save                              # Save current process list
pm2 startup                           # Set up systemd reboot startup script
```

---

## 5. DevOps Troubleshooting & Error Resolution Guide

| Error Condition / Symptom | Possible Cause | Verification Command | Resolution Steps |
|---|---|---|---|
| **Dashboard displays "No Active Servers Detected" and Health status is OFFLINE** | 1. Backend process is down.<br>2. Nginx is pointing to the wrong port.<br>3. Port firewall block. | `pm2 status`<br>`curl -I http://localhost:3971/health` | 1. Run `pm2 restart server-analysis-backend`. Check `pm2 logs` for startup exceptions.<br>2. Confirm Nginx `proxy_pass` matches backend listener port.<br>3. Run `sudo ufw allow 3971/tcp`. |
| **API calls return `502 Bad Gateway`** | The Express app on port `3971` has crashed or is not running. | `pm2 list` | 1. Run `pm2 restart server-analysis-backend`. Check log file if it crashes repeatedly.<br>2. Verify another process is not blocking port `3971` using `sudo lsof -i :3971`. |
| **API calls return `404 Not Found`** | Location block nesting mismatch in Nginx configuration. | View Nginx site configuration | 1. Ensure `location /monitoring-apis/` block is NOT nested inside `location /monitoring/`. Move it to the server block level.<br>2. Ensure trailing slash is present in `proxy_pass http://127.0.0.1:3971/;` |
| **MongoDB connection fails or times out** | 1. IP Whitelisting blocking.<br>2. Incorrect credentials.<br>3. MongoDB server down. | `nc -zvw3 217.145.69.228 27017` | 1. Verify `MONGODB_URI` password in `.env` doesn't contain unescaped special characters.<br>2. Verify port `27017` is open on the database server.<br>3. Check Mongo service status on db host: `sudo systemctl status mongod`. |
| **Nagios Bridge Log: "Failed to fetch service list: Connection refused"** | Nagios URL or Auth credentials mismatch. | Run manual check request: `curl -I -u nagiosadmin:PASSWORD http://217.145.69.228/nagios/cgi-bin/statusjson.cgi?query=servicelist` | 1. Open root `.env` and verify `NAGIOS_URL`, `NAGIOS_USER`, `NAGIOS_PASS`.<br>2. Verify network connection from monitoring server to Nagios host. |
| **Nagios Bridge Log: "MONGODB_URI not defined"** | `dotenv` failed to resolve from the project root. | Check `pm2 logs` | 1. Ensure dependencies were installed under `backend/node_modules/`. The bridge resolves `dotenv` from this path dynamically. |
