---
name: server-usage-analysis
description: Collects, logs, and analyzes CPU, RAM, and system load averages across multiple servers, identifying peak workload periods and resource bottlenecks.
---

# Server Usage Analysis Skill

This skill documents how to deploy, log, and analyze resource usage statistics across server nodes. It covers the metrics collection script, backend storage API, and aggregate query structures to analyze peak server performance.

## Prerequisites

- **Node.js** (v18.0.0 or higher recommended)
- **MongoDB** (running locally or via MongoDB Atlas URI)

## Component Overview

1. **Collector Agent (`collector.js`)**: A zero-dependency script executed on each server to read CPU tick counts, free memory bytes, and system load, pushing them to the analytics API.
2. **Express API Server (`backend/`)**: Receives JSON metrics payloads, stores them in MongoDB, and runs analytical aggregations.
3. **React Dashboard (`frontend/`)**: Visualizes active server workloads, last 24h RAM peaks, and hour-of-day peak cluster load statistics.

---

## Usage Guide

### 1. Starting the Storage Backend

Navigate to the `backend` directory, install dependencies, and start the service:

```bash
cd backend
npm install
npm run start
```

By default, the backend runs on port `5000` and connects to `mongodb://127.0.0.1:27017/server_analysis`. You can override these variables in a `.env` file:
```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/server_analysis
```

### 2. Seeding Test Data (Optional)

To populate the database with 24 hours of simulated server load spikes for testing, run:

```bash
node backend/seed.js
```

### 3. Deploying the Collection Agent

Copy `collector.js` to target nodes. Start it with environmental configurations:

```bash
METRICS_API_URL="http://[BACKEND_IP]:5000/api/metrics" \
SERVER_ID="prod-web-01" \
SERVER_NAME="Web Server Primary" \
COLLECT_INTERVAL_MS=5000 \
node collector.js
```

### 4. Running the Dashboard Frontend

Navigate to `frontend`, install dependencies, and start the development server:

```bash
cd frontend
npm install
npm run dev
```

---

## MongoDB Analytical Queries

If you need to analyze metrics directly from the MongoDB shell or database client, use these aggregation pipelines:

### Get Peak RAM Usage per Server in the Last 24 Hours

```javascript
db.servermetrics.aggregate([
  { 
    $match: { 
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
    } 
  },
  {
    $group: {
      _id: "$serverId",
      serverName: { $first: "$serverName" },
      maxRamUsagePercent: { $max: "$ramUsage.usagePercent" },
      maxRamUsedBytes: { $max: "$ramUsage.usedBytes" }
    }
  }
]);
```

### Identify Busiest Hour of the Day Across All Nodes (Peak Load Time)

```javascript
db.servermetrics.aggregate([
  {
    $project: {
      hour: { $hour: "$timestamp" },
      load: "$loadAverage.oneMin"
    }
  },
  {
    $group: {
      _id: "$hour",
      averageClusterLoad: { $avg: "$load" },
      maxClusterLoad: { $max: "$load" }
    }
  },
  { $sort: { averageClusterLoad: -1 } }
]);
```
