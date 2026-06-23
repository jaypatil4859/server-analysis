# ServerPulse Analytics — Production Handover & Deployment Guide

> **For DevOps Engineers** — This step-by-step guide explains how to deploy, configure, and manage ServerPulse Analytics on your server using PM2 + Nginx (Native VM) or Docker Compose.

---

## Method A: Native VM Deployment (PM2 + Nginx)

Follow these steps to run the Vite frontend and Node backend on PM2 behind your server's Nginx proxy.

### Step 1: Install Node.js and PM2 on Ubuntu
Update the system package list and install system utilities:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl rsync git
```
Install Node.js 20 from NodeSource:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
Install PM2 globally for process management:
```bash
sudo npm install -g pm2
```
Verify the installation:
```bash
node -v
npm -v
pm2 -v
```

### Step 2: Configure Environment Variables
Navigate to your project directory:
```bash
cd /var/www/server-analysis
```
Create a backend environment configuration file:
```bash
nano backend/.env
```
Paste and save the following production credentials:
```env
PORT=3971
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
```

### Step 3: Generate a Production Build for React-Vite Frontend
Navigate to the frontend directory and install dependencies:
```bash
cd /var/www/server-analysis/frontend
npm install
```
Build the project for production. The assets will automatically build under the `/monitoring/` base path:
```bash
npm run build
```
This generates a `dist/` folder containing the optimized assets.

### Step 4: Move Static Build Files to Web Root
Create the target directories under `/var/www/` for Nginx:
```bash
sudo mkdir -p /var/www/server-analysis/frontend/monitoring
```
Copy the compiled static assets:
```bash
sudo cp -r dist/. /var/www/server-analysis/frontend/monitoring/
```
Set proper ownership and permissions:
```bash
sudo chown -R www-data:www-data /var/www/server-analysis/frontend
sudo chmod -R 755 /var/www/server-analysis/frontend
```

### Step 5: Configure and Run Applications on PM2
PM2 will manage and keep your node processes (Express backend, Vite preview server, and SSH Metrics collector) alive.

First, navigate to your root project folder:
```bash
cd /var/www/server-analysis
```
Install backend dependencies:
```bash
cd backend && npm install --only=production && cd ..
```
Start all applications with PM2 using the ecosystem configuration:
```bash
pm2 start ecosystem.config.cjs
```
This launches three processes:
- `serverpulse-backend` (REST API on port `3971`)
- `serverpulse-frontend` (Vite Preview Server on port `3970`)
- `serverpulse-ssh-collector` (Metrics poller daemon)

Manage PM2 processes:
```bash
pm2 list          # View running applications
pm2 logs          # View live log streams
pm2 restart all   # Restart all services
pm2 stop all      # Stop all services
```
Enable PM2 to launch automatically on server reboot:
```bash
pm2 startup
```
Run the command suggested in your terminal, and save the process list:
```bash
pm2 save
```

### Step 6: Configure Nginx for Subpath Routing
Create a new Nginx site configuration file:
```bash
sudo nano /etc/nginx/sites-available/server-analysis
```
Paste the following configuration:
```nginx
server {
    listen 80;
    server_name _; # Replace with your domain or IP address

    # Root directory pointing to the web root
    root /var/www/server-analysis/frontend;
    index index.html index.htm;

    # Serve built static frontend SPA under subpath
    location /monitoring {
        alias /var/www/server-analysis/frontend/monitoring;
        index index.html index.htm;
        try_files $uri $uri/ /monitoring/index.html;
    }

    # Vite Dev Server HMR client support for DevOps
    location /@vite/ {
        proxy_pass http://127.0.0.1:3970;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # Reverse proxy for local Express backend
    location /monitoring/api/ {
        proxy_pass http://127.0.0.1:3971/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Reverse proxy for local health check
    location /monitoring/health {
        proxy_pass http://127.0.0.1:3971/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Redirect root / to /monitoring/
    location = / {
        return 301 /monitoring/;
    }

    # Error handling
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
```
Save the file and link the configuration to enable it:
```bash
sudo ln -sf /etc/nginx/sites-available/server-analysis /etc/nginx/sites-enabled/
```
Disable the default site (if conflicted):
```bash
sudo rm -f /etc/nginx/sites-enabled/default
```
Test and restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### Step 7: Allow Traffic Through Firewall
Ensure HTTP traffic and frontend direct access are allowed:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 3970/tcp
```
Now, visit your server’s IP in a browser:
`http://your_server_ip/monitoring`

---

## Method B: Docker Compose Deployment (Containerized)

Follow these steps if you want to deploy the entire stack containerized.

### Step 1: Install Docker and Docker Compose
Install Docker on Ubuntu:
```bash
curl -fsSL https://get.docker.com | bash
sudo apt install -y docker-compose-plugin
```

### Step 2: Configure Environment Variables
Create a `.env` file in the root directory:
```bash
cd /var/www/server-analysis
nano .env
```
Paste and save the following:
```env
MONGODB_URI=mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin
SSH_KEY_PATH=/home/devops/.ssh/id_rsa
SSH_USER=root
```

### Step 3: Run the Containers
Build the Docker images and spin up the containers in background (detached) mode:
```bash
docker compose up -d --build
```
This builds and boots:
- `serverpulse-frontend` (Nginx serving frontend assets under `/monitoring` on port `3970`)
- `serverpulse-backend` (Node Express API on port `3971`)
- `serverpulse-collector` (Metrics poller script)

### Step 4: Configure Host Nginx Reverse Proxy
To hook up your host server Nginx to the containerized frontend, configure your Nginx server block:
```nginx
location /monitoring/ {
    proxy_pass http://127.0.0.1:3970; # Forwards to the frontend docker container
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /@vite/ {
    proxy_pass http://127.0.0.1:3970;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
}
```
Test and reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```
Visit `http://your_server_ip/monitoring` to verify. 🚀
