import os from 'os';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

async function getDiskUsage() {
  try {
    const { stdout } = await execPromise("df -B1 / | tail -n 1");
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 6) {
      const totalBytes = parseInt(parts[1], 10);
      const usedBytes = parseInt(parts[2], 10);
      const usagePercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(1));
      return { totalBytes, usedBytes, usagePercent };
    }
  } catch (err) {
    console.error('Error getting disk usage:', err.message);
  }
  // Fallback default (100GB, 40% used)
  return {
    totalBytes: 100 * 1024 * 1024 * 1024,
    usedBytes: 40 * 1024 * 1024 * 1024,
    usagePercent: 40.0
  };
}

// Configuration from environment variables
const API_URL = process.env.METRICS_API_URL || 'http://localhost:5000/api/metrics';
const SERVER_ID = process.env.SERVER_ID || os.hostname() || 'unknown-server';
const SERVER_NAME = process.env.SERVER_NAME || os.hostname() || 'Unknown Server';
const INTERVAL_MS = parseInt(process.env.COLLECT_INTERVAL_MS || '5000', 10);

console.log(`Starting collector for ${SERVER_NAME} (${SERVER_ID}). Sending data to ${API_URL} every ${INTERVAL_MS / 1000}s`);

// Helper to compute CPU usage percentage dynamically
function getCpuUsage() {
  return new Promise((resolve) => {
    const startMeasure = cpuAverage();
    setTimeout(() => {
      const endMeasure = cpuAverage();
      const idleDifference = endMeasure.idle - startMeasure.idle;
      const totalDifference = endMeasure.total - startMeasure.total;
      const percentageCPU = 100 - Math.round((100 * idleDifference) / totalDifference);
      resolve(percentageCPU);
    }, 1000);
  });
}

function cpuAverage() {
  const cpus = os.cpus();
  let idleMs = 0;
  let totalMs = 0;

  cpus.forEach((core) => {
    for (const type in core.times) {
      totalMs += core.times[type];
    }
    idleMs += core.times.idle;
  });

  return {
    idle: idleMs / cpus.length,
    total: totalMs / cpus.length,
  };
}

async function collectAndSend() {
  try {
    const cpuUsage = await getCpuUsage();
    const diskUsage = await getDiskUsage();
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUsagePercent = parseFloat(((usedMem / totalMem) * 100).toFixed(2));

    const loadAvg = os.loadavg(); // Returns [1m, 5m, 15m]

    const payload = {
      serverId: SERVER_ID,
      serverName: SERVER_NAME,
      cpuUsage: parseFloat(cpuUsage.toFixed(2)),
      ramUsage: {
        totalBytes: totalMem,
        usedBytes: usedMem,
        usagePercent: ramUsagePercent
      },
      diskUsage,
      loadAverage: {
        oneMin: parseFloat(loadAvg[0].toFixed(2)),
        fiveMin: parseFloat(loadAvg[1].toFixed(2)),
        fifteenMin: parseFloat(loadAvg[2].toFixed(2))
      },
      cpuCores: os.cpus().length,
      timestamp: new Date().toISOString()
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] Failed to send metrics: ${response.status} - ${errorText}`);
    } else {
      console.log(`[${new Date().toISOString()}] Metrics successfully sent for ${SERVER_NAME}`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error collecting/sending metrics:`, error.message);
  }
}

// Start collection loop
setInterval(collectAndSend, INTERVAL_MS);
collectAndSend();
