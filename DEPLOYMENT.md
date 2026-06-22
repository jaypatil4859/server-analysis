# ServerPulse DevOps Deployment Guide

This guide is prepared for DevOps engineers to deploy the **ServerPulse Analytics** dashboard and its real-time parallel SSH metrics collector in a production VM environment.

---

## Architecture Overview

1.  **Frontend:** React (Vite) client, served as static compiled HTML/JS/CSS assets via Nginx.
2.  **Backend:** Node.js/Express API server running under PM2, which processes metrics and handles Webhook/Email alerts.
3.  **Database:** MongoDB (either a local instance or a managed MongoDB Atlas cluster).
4.  **Real-Time Collector (`ssh-collector.js`):** A centralized Node.js script managed by PM2 that connects directly to the operating system kernels of all 13 servers via SSH in parallel, retrieves exact metrics, and feeds them into the backend.

---

## DevOps Pre-Deployment Configuration Checklist

Before launching the project, the DevOps engineer **MUST** make the following configuration changes:

### 1. Configure SSH Access for the Collector
The collector script (`ssh-collector.js`) runs centrally on the dashboard server and connects to the monitored VMs via SSH.
-   Ensure the user running the collector has passwordless SSH key-based access (`root` or standard user) to all 13 servers.
-   Open [ecosystem.config.cjs](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/ecosystem.config.cjs) and configure the environment variables under `serverpulse-ssh-collector`:
    -   `SSH_USER`: The username used to log into the servers (e.g. `root`, `ubuntu`).
    -   `SSH_KEY_PATH`: The absolute file path to the SSH private key (e.g. `/home/devops/.ssh/id_rsa`).

### 2. Configure Database and Alerts
Open [ecosystem.config.cjs](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/ecosystem.config.cjs) and update the `env` config block under `serverpulse-backend`:
-   `MONGODB_URI`: Point to your production database (e.g. local string `mongodb://127.0.0.1:27017/server_analysis` or MongoDB Atlas URI).
-   *(Optional)* Configure SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) and alert webhooks (`SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`) if you want notifications triggered when CPU or RAM usage exceeds 90%.

### 3. Verify Server Target List (Optional)
If server IP addresses or hostnames change in the future, edit the `SERVERS` array at the top of [ssh-collector.js](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/ssh-collector.js) to match the new IPs.

---

## Step-by-Step Deployment Walkthrough

### Step 1: Install Dependencies
Run npm installation in the root directory and the sub-folders:
```bash
# Install root level dependencies
npm install

# Install backend dependencies
cd backend && npm install --only=production
cd ..

# Install frontend dependencies
cd frontend && npm install
```

### Step 2: Build the Frontend React App
Compile the static React production assets:
```bash
cd frontend
npm run build
cd ..
```
*This compiles the React files and outputs the production bundle to `frontend/dist/`.*

### Step 3: Copy Static Files to Web Server Root
Create a directory to host the static frontend files and move them there:
```bash
sudo mkdir -p /var/www/serverpulse/frontend
sudo cp -r frontend/dist/* /var/www/serverpulse/frontend/
```

### Step 4: Configure Nginx Web Server
Copy the native Nginx configuration from your deployment folder into Nginx's sites directory:
```bash
# Copy the HTTP template
sudo cp deployment/nginx.native.conf /etc/nginx/sites-available/serverpulse

# Create a symbolic link to enable the site
sudo ln -sf /etc/nginx/sites-available/serverpulse /etc/nginx/sites-enabled/

# Verify Nginx configuration syntax is OK
sudo nginx -t

# Reload Nginx to apply changes
sudo systemctl restart nginx
```
*(If you are deploying with SSL/TLS certificates, use `deployment/nginx.native.ssl.conf` instead).*

### Step 5: Run the Backend & Collector under PM2
PM2 will run the backend and the real-time collector as background daemons and keep them persistent.
Navigate to the root directory (containing `ecosystem.config.cjs`) and execute:
```bash
# Start both backend and collector processes
pm2 start ecosystem.config.cjs

# Make sure PM2 automatically runs them on system boot
pm2 startup
pm2 save
```

---

## Operations & Verification

DevOps can monitor the state of the applications using standard PM2 utility commands:

-   **Check Process Status:**
    ```bash
    pm2 status
    ```
    *(You should see both `serverpulse-backend` and `serverpulse-ssh-collector` online).*
-   **Inspect System Logs in Real-Time:**
    ```bash
    pm2 logs
    ```
-   **Verify Current Active Metrics:**
    To confirm that metrics are being successfully parsed and logged, query the backend current metrics API directly:
    ```bash
    curl -s http://localhost:5000/api/metrics/current
    ```
