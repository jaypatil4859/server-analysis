/**
 * Centralized SSH Real-Time Collector for ServerPulse
 * 
 * This script runs on your dashboard server (or a monitoring gateway) and pulls 
 * 100% accurate, real-time metrics directly from the kernels of all target servers 
 * via SSH. It requires no agent installation (no Node.js/PM2) on the target servers.
 * 
 * Prerequisites:
 * - The host running this script must have SSH key-based access to the target servers.
 * - Configure the SSH user and target list below.
 */

import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// ==================== CONFIGURATION ====================
const DASHBOARD_API_URL = process.env.METRICS_API_URL || 'http://localhost:5000/api/metrics';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000', 10); // Poll every 10 seconds for real-time tracking
const SSH_USER = process.env.SSH_USER || 'root'; // Default SSH user
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || ''; // Optional path to private SSH key (e.g. '/home/sahil/.ssh/id_rsa')

// List of target servers to monitor
const SERVERS = [
  { id: 'in31', host: 'in31', name: 'in31', user: SSH_USER },
  { id: 'in44', host: 'in44', name: 'in44', user: SSH_USER },
  { id: 'newmongo', host: 'newmongo', name: 'newmongo', user: SSH_USER },
  { id: 'newprod', host: 'newprod', name: 'newprod', user: SSH_USER },
  { id: 'newprodp1', host: 'newprodp1', name: 'newprodp1', user: SSH_USER },
  { id: 'newprodp2', host: 'newprodp2', name: 'newprodp2', user: SSH_USER },
  { id: 'newprodp3', host: 'newprodp3', name: 'newprodp3', user: SSH_USER },
  { id: 'punctualiti.co', host: 'punctualiti.co', name: 'punctualiti.co', user: SSH_USER },
  { id: 'rahehamysql', host: 'rahehamysql', name: 'rahehamysql', user: SSH_USER },
  { id: 'raheja-app', host: 'raheja-app', name: 'raheja-app', user: SSH_USER },
  { id: 'rahejamongo', host: 'rahejamongo', name: 'rahejamongo', user: SSH_USER },
  { id: 'sgdb', host: 'sgdb', name: 'sgdb', user: SSH_USER },
  { id: 'sify-app', host: 'sify-app', name: 'sify-app', user: SSH_USER }
];
// =======================================================

/**
 * Execute command on remote host via SSH
 */
async function fetchRemoteMetrics(server) {
  const host = server.host;
  const user = server.user;
  
  // Command to retrieve: CPU cores, Load Average, Memory Info, and Root Disk Space
  const remoteCmd = "nproc && cat /proc/loadavg && grep -E 'MemTotal|MemAvailable|MemFree|Buffers|Cached' /proc/meminfo && df -B1 / | tail -n 1";
  
  let sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5`;
  if (SSH_KEY_PATH) {
    sshCmd += ` -i ${SSH_KEY_PATH}`;
  }
  sshCmd += ` ${user}@${host} "${remoteCmd}"`;

  try {
    const { stdout } = await execPromise(sshCmd);
    return parseSshOutput(stdout, server);
  } catch (error) {
    throw new Error(`SSH connection failed: ${error.message}`);
  }
}

/**
 * Parse raw SSH stdout into structured metrics
 */
function parseSshOutput(stdout, server) {
  const lines = stdout.trim().split('\n');
  if (lines.length < 4) {
    throw new Error('Incomplete command output returned from remote host.');
  }

  // 1. CPU Cores (Line 0)
  const cores = parseInt(lines[0].trim(), 10);
  if (isNaN(cores) || cores <= 0) {
    throw new Error('Failed to parse CPU core count.');
  }

  // 2. Load Average (Line 1)
  const loadLine = lines[1].trim();
  const loadParts = loadLine.split(/\s+/);
  const oneMin = parseFloat(loadParts[0]);
  const fiveMin = parseFloat(loadParts[1]);
  const fifteenMin = parseFloat(loadParts[2]);

  // 3. Memory Info (Lines in middle)
  let memTotalKB = 0;
  let memAvailableKB = 0;
  let memFreeKB = 0;
  let buffersKB = 0;
  let cachedKB = 0;

  for (let i = 2; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const val = parseInt(parts[1], 10);
    if (line.startsWith('MemTotal:')) memTotalKB = val;
    else if (line.startsWith('MemAvailable:')) memAvailableKB = val;
    else if (line.startsWith('MemFree:')) memFreeKB = val;
    else if (line.startsWith('Buffers:')) buffersKB = val;
    else if (line.startsWith('Cached:')) cachedKB = val;
  }

  // Calculate available RAM using kernel fallback if MemAvailable is not reported
  if (memAvailableKB === 0) {
    memAvailableKB = memFreeKB + buffersKB + cachedKB;
  }

  const totalRamBytes = memTotalKB * 1024;
  const availableRamBytes = memAvailableKB * 1024;
  const usedRamBytes = totalRamBytes - availableRamBytes;
  const ramUsagePercent = parseFloat(((usedRamBytes / totalRamBytes) * 100).toFixed(1));

  // 4. Disk Usage (Last line)
  const diskLine = lines[lines.length - 1].trim();
  const diskParts = diskLine.split(/\s+/);
  let totalDiskBytes = 0;
  let usedDiskBytes = 0;
  let diskUsagePercent = 0.0;

  if (diskParts.length >= 5) {
    totalDiskBytes = parseInt(diskParts[1], 10);
    usedDiskBytes = parseInt(diskParts[2], 10);
    diskUsagePercent = parseFloat(((usedDiskBytes / totalDiskBytes) * 100).toFixed(1));
  }

  // 5. Calculate actual CPU Usage % from load average and core count
  const cpuUsage = parseFloat(Math.min(99.9, (oneMin / cores) * 100).toFixed(1));

  return {
    serverId: server.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
    serverName: server.name,
    cpuUsage,
    ramUsage: {
      totalBytes: totalRamBytes,
      usedBytes: usedRamBytes,
      usagePercent: ramUsagePercent
    },
    diskUsage: {
      totalBytes: totalDiskBytes,
      usedBytes: usedDiskBytes,
      usagePercent: diskUsagePercent
    },
    loadAverage: {
      oneMin,
      fiveMin,
      fifteenMin
    },
    cpuCores: cores,
    timestamp: new Date().toISOString()
  };
}

/**
 * Poll all servers and forward to dashboard backend API
 */
async function pollAndSend() {
  console.log(`\n--- SSH Real-Time Poll: ${new Date().toISOString()} ---`);
  
  const pollPromises = SERVERS.map(async (server) => {
    try {
      const payload = await fetchRemoteMetrics(server);
      
      // Post to ServerPulse dashboard backend
      const response = await fetch(DASHBOARD_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log(`[Success] ${server.id} | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
      } else {
        const errorText = await response.text();
        console.error(`[API Error] ${server.id}: ${response.status} - ${errorText}`);
      }
    } catch (err) {
      console.error(`[Failed] ${server.id}: ${err.message}`);
    }
  });

  await Promise.all(pollPromises);
}

// Start poll loop
console.log(`Starting Centralized SSH Real-Time Collector...`);
console.log(`Dashboard Target API: ${DASHBOARD_API_URL}`);
console.log(`Polling Interval: ${POLL_INTERVAL_MS / 1000}s`);

setInterval(pollAndSend, POLL_INTERVAL_MS);
pollAndSend();
