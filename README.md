# ServerPulse Analytics - Production Deployment Guide

This repository contains **ServerPulse Analytics**, a real-time cluster monitoring dashboard. It has been prepared for production hosting using two supported methods:
1. **Containerized Deployment (Docker & Docker Compose)** – *Recommended*
2. **Native VM Service Setup (PM2 + Nginx)**

Both methods allow you to host the frontend web app on port `80`/`443` (HTTP/HTTPS) and proxy API traffic to the backend, while supporting both local MongoDB instances and managed MongoDB databases (like MongoDB Atlas).

---

## Environment Configuration

The backend supports several environment variables for integration. Create a `.env` file in the `backend/` directory (or specify them in `docker-compose.yml` / PM2 environment):

| Environment Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Backend server port | `5000` |
| `MONGODB_URI` | MongoDB Connection String (Local or Atlas) | `mongodb://localhost:27017/server_analysis` |
| `SMTP_HOST` | SMTP server host for Email notifications | `smtp.mailgun.org` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP auth user | `alerts@company.com` |
| `SMTP_PASS` | SMTP auth password | `your_smtp_password` |
| `ALERT_EMAIL_RECIPIENT` | Target email for critical metrics warnings | `devops-alerts@company.com` |
| `SLACK_WEBHOOK_URL` | Slack webhook URL for real-time channel logs | `https://hooks.slack.com/services/...` |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL | `https://discord.com/api/webhooks/...` |

---

## Method 1: Containerized Deployment (Docker Compose) - *Recommended*

This is the most reliable method, as it isolated dependencies and guarantees matching environments.

### Prerequisites
* [Docker](https://docs.docker.com/get-docker/)
* [Docker Compose](https://docs.docker.com/compose/install/)

### Deploy Steps
1. Navigate to the project root directory.
2. Build and run the services in daemon mode:
   ```bash
   docker-compose up -d --build
   ```
3. Docker Compose will automatically spin up:
   * **MongoDB Container** (`serverpulse-db`) storing data inside a persistent Docker volume (`mongodb_data`).
   * **Backend Container** (`serverpulse-backend`) listening on port `5000`.
   * **Frontend Container** (`serverpulse-frontend`) serving static files and proxying requests to the backend.
4. Open your browser and navigate to the server's IP address or domain (port `80`) to view the dashboard:
   ```
   http://your-server-ip/
   ```

### Connecting to an External Database (e.g. MongoDB Atlas)
To bypass the local MongoDB container and use a managed cluster:
1. Open [docker-compose.yml](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/docker-compose.yml).
2. Modify the `MONGODB_URI` environment variable under `backend` to point to your external cluster.
3. Remove or comment out the `database` service block if a local instance is not needed.
4. Run `docker-compose up -d`.

---

## Method 2: Native VM Hosting (PM2 + Nginx)

This method hosts the app directly on the server's operating system (e.g., Ubuntu/RHEL VM).

### Prerequisites
* **Node.js** (v18.0.0 or higher) & **npm**
* **MongoDB** installed and running on the host (or an Atlas URI)
* **Nginx** web server installed (`apt-get install nginx`)
* **PM2** process manager installed globally (`npm install -g pm2`)

### Deploy Steps

#### 1. Configure and Build the Frontend
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install packages:
   ```bash
   npm install
   ```
3. Build the static production bundle:
   ```bash
   npm run build
   ```
   *This compiles the React files and outputs them into `frontend/dist/`.*
4. Copy the `frontend/dist` directory to your web server host directory (e.g. `/var/www/serverpulse/frontend/dist`):
   ```bash
   sudo mkdir -p /var/www/serverpulse/frontend
   sudo cp -r dist /var/www/serverpulse/frontend/
   ```

#### 2. Start the Backend using PM2
1. Navigate back to the project root and install backend packages:
   ```bash
   cd ../backend
   npm install --only=production
   ```
2. Navigate back to the root containing [ecosystem.config.cjs](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/ecosystem.config.cjs) and start the API server:
   ```bash
   pm2 start ecosystem.config.cjs
   ```
3. To ensure the backend restarts automatically on VM boot:
   ```bash
   pm2 startup
   pm2 save
   ```

#### 3. Configure Nginx
Copy one of the templates in the `deployment/` directory into your Nginx configurations directory (usually `/etc/nginx/sites-available/`):

* **For HTTP (non-SSL)**: Use [deployment/nginx.native.conf](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/deployment/nginx.native.conf)
* **For HTTPS (SSL/TLS)**: Use [deployment/nginx.native.ssl.conf](file:///home/sahil/Documents/Jay%20Patil/server%20analysis/deployment/nginx.native.ssl.conf) (make sure to replace certificate paths).

```bash
sudo cp deployment/nginx.native.conf /etc/nginx/sites-available/serverpulse
sudo ln -s /etc/nginx/sites-available/serverpulse /etc/nginx/sites-enabled/
sudo nginx -t # Test configuration syntax
sudo systemctl restart nginx # Reload server
```

---

## Collection Agent Setup

Once ServerPulse is hosted and running, install the lightweight collection agent on the servers you wish to monitor.

1. Copy the `collector.js` file from the project root to target server instances.
2. Run the collector agent as a service, pointing `METRICS_API_URL` to your newly hosted domain or server IP:

```bash
METRICS_API_URL="http://your-server-domain-or-ip/api/metrics" \
SERVER_ID="production-web-node" \
SERVER_NAME="Company Web Server" \
node collector.js
```

*(Note: In production environments, it is recommended to run the collector agent under PM2 or as a systemd service on target hosts).*
