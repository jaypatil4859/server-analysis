import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import metricRoutes from './routes/metricRoutes.js';
import laptopRoutes from './routes/laptopRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3971;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

app.use(cors());
app.use(express.json());

app.use('/api/metrics', metricRoutes);
app.use('/api/laptop',  laptopRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date(), db: mongoose.connection.readyState === 1 ? 'connected' : 'fallback' });
});

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});

// ─── Embedded Nagios Bridge Supervisor ───────────────────────────────────────
// Automatically spawns and supervises nagios-bridge.js 24/7 inside the backend process.
// This guarantees that whenever backend/server.js is running (via PM2, Docker, or node),
// Nagios data ingestion runs 24/7 on the server regardless of laptop status.
let bridgeChild = null;
let bridgeRestartTimer = null;
let isShuttingDown = false;

function startEmbeddedNagiosBridge() {
  const enableEmbedded = process.env.ENABLE_EMBEDDED_NAGIOS_BRIDGE !== 'false';
  if (!enableEmbedded) {
    console.log('[Nagios Bridge Supervisor] Embedded bridge disabled via ENABLE_EMBEDDED_NAGIOS_BRIDGE=false');
    return;
  }

  const bridgePath = path.resolve(__dirname, '..', 'nagios-bridge.js');
  if (!fs.existsSync(bridgePath)) {
    console.warn(`[Nagios Bridge Supervisor] nagios-bridge.js not found at ${bridgePath}`);
    return;
  }

  console.log(`[Nagios Bridge Supervisor] Spawning embedded Nagios Bridge daemon...`);
  bridgeChild = fork(bridgePath, [], {
    env: { ...process.env },
    stdio: 'inherit'
  });

  console.log(`[Nagios Bridge Supervisor] Embedded Nagios Bridge running (PID: ${bridgeChild.pid})`);

  bridgeChild.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    console.warn(`[Nagios Bridge Supervisor] Embedded Nagios Bridge exited (code: ${code}, signal: ${signal}). Restarting in 3s...`);
    bridgeChild = null;
    bridgeRestartTimer = setTimeout(startEmbeddedNagiosBridge, 3000);
  });

  bridgeChild.on('error', (err) => {
    console.error(`[Nagios Bridge Supervisor] Process error:`, err.message);
  });
}

function cleanupChildProcesses() {
  isShuttingDown = true;
  if (bridgeRestartTimer) clearTimeout(bridgeRestartTimer);
  if (bridgeChild) {
    console.log('[Nagios Bridge Supervisor] Stopping embedded Nagios Bridge daemon...');
    bridgeChild.kill('SIGTERM');
  }
}

process.on('SIGINT', () => { cleanupChildProcesses(); process.exit(0); });
process.on('SIGTERM', () => { cleanupChildProcesses(); process.exit(0); });

startEmbeddedNagiosBridge();

// ─── MongoDB connection with automatic reconnect ──────────────────────────────
const MONGO_RETRY_DELAYS = [3000, 5000, 10000, 20000, 30000]; // backoff steps
let retryCount = 0;

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    // Verify auth by listing collections
    await mongoose.connection.db.listCollections().toArray();
    console.log('[MongoDB] Connected and authenticated successfully.');
    retryCount = 0; // reset on success
  } catch (error) {
    const delay = MONGO_RETRY_DELAYS[Math.min(retryCount, MONGO_RETRY_DELAYS.length - 1)];
    retryCount++;
    console.warn(`[MongoDB] Connection failed: ${error.message}`);
    console.warn(`[MongoDB] Retrying in ${delay / 1000}s... (attempt ${retryCount})`);
    setTimeout(connectMongo, delay);
  }
}

// Handle disconnection events and auto-reconnect
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected. Scheduling reconnect...');
  setTimeout(connectMongo, MONGO_RETRY_DELAYS[0]);
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err.message);
});

connectMongo();

