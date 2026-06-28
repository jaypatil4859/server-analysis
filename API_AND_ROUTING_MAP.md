# Master API, Routing, & Port Reference Map

This file serves as a map guide for DevOps engineers to modify ports, API paths, database URIs, or Nagios endpoints without breaking the frontend-backend connection.

---

## 🗺 Component Architecture Overview

```
[Nagios Server (217.145.69.228)]
              │
              │ HTTP Polling (Status JSON CGI)
              ▼
    [nagios-bridge.js]
              │
              │ HTTP POST (/api/metrics)
              ▼
    [Backend API (Port 3971)] ◄────────► [Remote MongoDB (217.145.69.228:27017)]
              ▲
              │ HTTP GET/POST (Proxied under /monitoring-apis/)
              ▼
    [Nginx Reverse Proxy / Vite (Port 3970)]
              ▲
              │ Served under /monitoring/
              ▼
    [Client Browser]
```

---

## 🔍 Where to Change Paths & Ports

If you need to change a port, subpath, or database URI, update the corresponding files mapped below.

### 1. Frontend API Subpath & Host Resolution
When the dashboard runs in the browser, it needs to know where the backend API is hosted.

* **File**: [`frontend/src/App.jsx`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/frontend/src/App.jsx) (Lines 14-18)
  ```javascript
  // Change where the browser fetches API data from:
  let API_HOST = import.meta.env.VITE_API_URL || `${window.location.origin}/monitoring-apis`;
  const getApiBase = () => `${API_HOST}/api/metrics`;
  const getLaptopApiBase = () => `${API_HOST}/api/laptop`;
  ```
  * **To Override**: Set the environment variable `VITE_API_URL` during build time (e.g. `VITE_API_URL=https://api.yourdomain.com npm run build`).

### 2. Frontend Development & Preview Proxies
When testing locally or running the Vite preview server, Vite proxies API requests to the backend.

* **File**: [`frontend/vite.config.js`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/frontend/vite.config.js) (Lines 11-17 and 23-30)
  ```javascript
  // Change target if your backend is running on a different port than 3971:
  proxy: {
    '/monitoring-apis': {
      target: 'http://localhost:3971', // Update this backend host/port
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/monitoring-apis/, '')
    }
  }
  ```

### 3. Backend Listen Port & Database Settings
Controls where the Express API listens and which database instance it connects to.

* **File**: [`backend/server.js`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/backend/server.js) (Lines 10-25)
  ```javascript
  const PORT = process.env.PORT || 3971; // Change backend port
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis'; // Change DB URI
  
  // Base Routes:
  app.use('/api/metrics', metricRoutes);
  app.use('/api/laptop', laptopRoutes);
  app.use('/health', ...);
  ```
* **Configuration**: Create and edit [`backend/.env`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/backend/.env):
  ```env
  PORT=3971
  MONGODB_URI=mongodb://admin:PASSWORD@217.145.69.228:27017/server_analysis?authSource=admin
  ```

### 4. Nagios Bridge Configuration
Controls which Nagios server the bridge polls, and where it forwards the metrics.

* **File**: Configuration is loaded from variables in the root [`.env`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/.env):
  ```env
  # Set where the bridge sends metrics (should match backend port/host)
  METRICS_API_URL=http://localhost:3971/api/metrics

  # Set Nagios target URL and credentials
  NAGIOS_URL=http://217.145.69.228/nagios
  NAGIOS_USER=nagiosadmin
  NAGIOS_PASS=YOUR_NAGIOS_PASSWORD
  
  # Poll Interval (default 30 seconds)
  POLL_INTERVAL_MS=30000
  ```

### 5. Nginx Server Configuration (For standalone deploy)
Nginx coordinates serving the dashboard files and reverse-proxying API requests.

* **File**: `/etc/nginx/sites-available/default` (or your site configuration file)
  ```nginx
  # Port mapping for Frontend:
  location /monitoring/ {
      proxy_pass http://127.0.0.1:3970; # Points to Vite Preview port
  }

  # Port mapping for Backend:
  location /monitoring-apis/ {
      proxy_pass http://127.0.0.1:3971/; # Points to Express API port (Note trailing slash)
  }
  ```

### 6. Docker Nginx Configuration (For containerized deploy)
* **File**: [`frontend/nginx.conf`](file:///c:/Users/ijayp/OneDrive/Documents/server-analysis/frontend/nginx.conf) (Lines 26-36)
  ```nginx
  location /monitoring-apis/ {
      proxy_pass http://backend:3971/; # 'backend' resolves to the backend container inside Docker network
      ...
  }
  ```

---

## 🚨 Troubleshooting Route Mismatches

| If you get this error | Possible Cause | Verification & Fix |
|---|---|---|
| **Dashboard shows "No Active Servers Detected" and Health Check is offline** | Frontend is hitting the wrong port, or Backend is crashed. | 1. Open Browser Console (F12) -> Network tab.<br>2. Check where requests like `/monitoring-apis/api/metrics/current` are going.<br>3. Ensure the backend Express process is listening on the targeted port (default `3971`). Run `curl http://localhost:3971/health`. |
| **API calls return `502 Bad Gateway` from Nginx** | Nginx is pointing to the wrong port, or Express is not running. | 1. Check Nginx config: make sure `proxy_pass` matches your Express backend port.<br>2. Verify backend is running via `pm2 status` or `docker ps`. |
| **Nagios Bridge logs: "FetchError: connect ECONNREFUSED"** | The bridge cannot reach the backend API. | 1. Check `METRICS_API_URL` in `.env`. It must point to the backend server (default: `http://localhost:3971/api/metrics` or `http://backend:3971/api/metrics` in Docker). |
| **Vite Preview returns "403 Forbidden" in browser** | Host header checking is blocking external domains or ngrok. | Verify `frontend/vite.config.js` has `allowedHosts: true` under both `server` and `preview` blocks. |
