# Server Analysis Analytics — Deployment Guide

> **For DevOps Engineers** — Three deployment methods, from simplest to most flexible.

---

## ⚡ Method A: One-Command Deploy (Fastest — Recommended)

This is the easiest way. After cloning, run a single script that installs, builds, and launches everything.

### Prerequisites
- Ubuntu 20.04+ or any Linux server
- Node.js 20.x and npm ([install guide](https://nodejs.org/en/download))
- Git

### Steps

**1. Clone the repository:**
```bash
git clone <your-repo-url> /var/www/server-analysis
cd /var/www/server-analysis
```

**2. Run the deploy script:**
```bash
chmod +x start.sh
./start.sh
```

The script will:
- Detect Node.js and install PM2 if needed
- Prompt you to create `backend/.env` and `.env` if they don't exist
- Install all dependencies
- Build the frontend
- Start everything with PM2

**3. Open your browser:**
```
http://YOUR_SERVER_IP:3970/monitoring/
```

**4. (Optional) Enable auto-start on server reboot:**
```bash
pm2 startup
# Run the command it prints, e.g.: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save
```

---

## 🔧 Method B: Manual Step-by-Step (PM2 + Nginx)

Use this method for full control or when integrating with an existing Nginx setup.

### Step 1: Install Node.js and PM2

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Verify:
```bash
node -v && npm -v && pm2 -v
```

### Step 2: Clone and Configure

```bash
git clone <your-repo-url> /var/www/server-analysis
cd /var/www/server-analysis
```

Create the backend environment file:
```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Set the following values in `backend/.env`:
```env
PORT=3971
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
SEED_DUMMY_HISTORY=false
```

Create the root environment file (for the Nagios bridge):
```bash
cp .env.example .env
nano .env
```

Set the following in `.env`:
```env
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
NAGIOS_URL=http://217.145.69.228/nagios
NAGIOS_USER=nagiosadmin
NAGIOS_PASS=4z1lO3lXxNa$
```

### Step 3: Install Dependencies

```bash
cd backend && npm install --only=production && cd ..
cd frontend && npm install && cd ..
```

### Step 4: Build the Frontend

```bash
cd frontend
npm run build
cd ..
```

This creates `frontend/dist/` with optimized assets under the `/monitoring/` base path.

### Step 5: Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

This starts three processes:
- `server-analysis-backend` — REST API on port **3971**
- `server-analysis-frontend` — Vite preview server on port **3970**
- `server-analysis-nagios-bridge` — Polls Nagios every 30s and pushes metrics to backend

Check all processes:
```bash
pm2 list
pm2 logs
```

### Step 6: (Optional) Configure Nginx Reverse Proxy

If you want to serve the dashboard under a domain or subpath via port 80, create an Nginx config:

```bash
sudo nano /etc/nginx/sites-available/server-analysis
```

Paste:
```nginx
server {
    listen 80;
    server_name _; # Replace with your domain or IP

    root /var/www/html;
    index index.html;

    # Serve built static frontend SPA
    location /monitoring {
        alias /var/www/server-analysis/frontend/dist;
        index index.html;
        try_files $uri $uri/ /monitoring/index.html;
    }

    # Reverse proxy for the backend API
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

    # Redirect root to dashboard
    location = / {
        return 301 /monitoring/;
    }
}
```

Enable and reload:
```bash
sudo ln -sf /etc/nginx/sites-available/server-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

Then visit: `http://YOUR_SERVER_IP/monitoring`

---

## 🐳 Method C: Docker Compose

Use this for fully containerized deployments.

### Prerequisites
```bash
curl -fsSL https://get.docker.com | bash
sudo apt install -y docker-compose-plugin
```

### Steps

**1. Clone and configure:**
```bash
git clone <your-repo-url> /var/www/server-analysis
cd /var/www/server-analysis
cp .env.example .env
nano .env
```

Set in `.env`:
```env
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
NAGIOS_PASS=4z1lO3lXxNa$
```

**2. Build and start containers:**
```bash
docker compose up -d --build
```

This starts:
- `server-analysis-backend` — Express API on port **3971**
- `server-analysis-frontend` — Nginx serving frontend on port **3970**
- `server-analysis-nagios-bridge` — Nagios data collector

**3. Check status:**
```bash
docker compose ps
docker compose logs -f nagios-bridge   # Watch data flowing in from Nagios
docker compose logs -f backend         # Watch backend API logs
```

**4. Visit:** `http://YOUR_SERVER_IP:3970/monitoring/`

---

## 🌐 Testing with ngrok (Temporary Public URL)

Use this to quickly test the backend is accessible from the internet, without any server setup.

**On your local machine:**
```bash
# Start the backend
cd backend && npm start &

# Start the Nagios bridge (in another terminal)
node nagios-bridge.js &

# Expose the backend via ngrok
npx ngrok http 3971
```

ngrok will print a public URL like `https://abc123.ngrok.io`. To test:
```
https://abc123.ngrok.io/health
https://abc123.ngrok.io/api/metrics/current
```

To connect the frontend to this ngrok URL during local testing:
```bash
cd frontend
VITE_API_URL=https://abc123.ngrok.io npm run dev
```

---

## 📊 How Data Gets into the Dashboard

The dashboard displays **real metrics from your Nagios-monitored servers**:

```
Nagios (217.145.69.228)
        ↓  (HTTP/JSON every 30s)
nagios-bridge.js  ←── polls statusjson.cgi
        ↓  (POST /api/metrics)
Backend API (port 3971)
        ↓  (MongoDB write)
MongoDB (217.145.69.228:27017)
        ↑  (GET /api/metrics/current)
Frontend Dashboard (port 3970)
```

---

## 🔌 Adding a New Server to Monitoring

No configuration changes needed! Deploy the lightweight collector on the new server:

```bash
# On the new server:
METRICS_API_URL="http://DASHBOARD_SERVER_IP/monitoring-apis/api/metrics" \
SERVER_ID="new-prod-web-04" \
SERVER_NAME="Web Server 04" \
node collector.js
```

The server will automatically appear in the dashboard within seconds.

---

## 🛠 Troubleshooting

| Problem | Solution |
|---|---|
| Dashboard shows "No Active Servers Detected" | The backend or Nagios bridge is not running. Run `pm2 logs` and check for errors. |
| Backend can't connect to MongoDB | Check `backend/.env` — verify `MONGODB_URI` has the correct password and the IP `217.145.69.228:27017` is reachable. |
| Nagios bridge shows "No hosts found" | Verify `NAGIOS_URL`, `NAGIOS_USER`, `NAGIOS_PASS` in root `.env`. Test: `curl -u nagiosadmin:PASSWORD http://217.145.69.228/nagios/cgi-bin/statusjson.cgi?query=servicelist` |
| Port 3971 not reachable | `sudo ufw allow 3971/tcp && sudo ufw allow 3970/tcp` |
| PM2 processes crash on start | `pm2 logs` to see the error. Most common: missing `.env` file or wrong MongoDB URI. |

---

## Quick Reference

```bash
pm2 list                      # View running processes
pm2 logs                      # Live log stream (all)
pm2 logs server-analysis-nagios-bridge  # Nagios bridge only
pm2 restart all               # Restart everything
pm2 stop all                  # Stop everything
pm2 startup && pm2 save       # Enable auto-start on reboot
```
