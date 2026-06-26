/**
 * Hybrid SSH & Nagios Real-Time Collector for Server Analysis
 * 
 * First preference: Connect directly to target servers via SSH to pull 
 * accurate specs and metrics.
 * 
 * Fallback preference: If SSH fails or is not configured, fetch host status
 * and metrics from the Nagios server.
 */

const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);

// ==================== CONFIGURATION ====================
const DASHBOARD_API_URL = process.env.METRICS_API_URL || 'http://localhost:3971/api/metrics';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10); // Poll every 30 seconds

// SSH Credentials
const SSH_USER = process.env.SSH_USER || 'root';
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '';

// Nagios Credentials
const NAGIOS_URL = process.env.NAGIOS_URL || 'http://217.145.69.228/nagios';
const NAGIOS_USER = process.env.NAGIOS_USER || 'nagiosadmin';
const NAGIOS_PASS = process.env.NAGIOS_PASS || '4z1lO3lXxNa$';

// List of target servers to monitor
const SERVERS = [
  { id: 'in31', host: '180.187.54.31', name: 'in31', user: SSH_USER },
  { id: 'in44', host: '180.187.54.44', name: 'in44', user: SSH_USER },
  { id: 'newmongo', host: '161.248.37.104', name: 'newmongo', user: SSH_USER },
  { id: 'newprod', host: '161.248.37.102', name: 'newprod', user: SSH_USER },
  { id: 'newprodp1', host: '161.248.37.181', name: 'newprodp1', user: SSH_USER },
  { id: 'newprodp2', host: '161.248.37.103', name: 'newprodp2', user: SSH_USER },
  { id: 'newprodp3', host: '43.113.189.106', name: 'newprodp3', user: SSH_USER },
  { id: 'punctualiti-co', host: '43.242.212.71', name: 'punctualiti.co', user: SSH_USER },
  { id: 'rahehamysql', host: '161.248.37.87', name: 'rahehamysql', user: SSH_USER },
  { id: 'raheja-app', host: '161.248.37.85', name: 'raheja-app', user: SSH_USER },
  { id: 'rahejamongo', host: '161.248.37.86', name: 'rahejamongo', user: SSH_USER },
  { id: 'sgdb', host: '154.210.160.250', name: 'sgdb', user: SSH_USER },
  { id: 'sify-app', host: '100.85.117.165', name: 'sify-app', user: SSH_USER }
];

// Fallback specs lookup table for Nagios (CPU cores, RAM size in GB, Disk size in GB)
const SERVER_SPECS = {
  'in31': { cores: 4, ramGB: 16, diskGB: 250 },
  'in44': { cores: 4, ramGB: 16, diskGB: 250 },
  'newmongo': { cores: 4, ramGB: 16, diskGB: 500 },
  'newprod': { cores: 8, ramGB: 16, diskGB: 250 },
  'newprodp1': { cores: 4, ramGB: 16, diskGB: 250 },
  'newprodp2': { cores: 4, ramGB: 12, diskGB: 250 },
  'newprodp3': { cores: 4, ramGB: 8, diskGB: 250 },
  'punctualiti-co': { cores: 8, ramGB: 16, diskGB: 250 },
  'rahehamysql': { cores: 8, ramGB: 16, diskGB: 500 },
  'raheja-app': { cores: 4, ramGB: 16, diskGB: 250 },
  'rahejamongo': { cores: 4, ramGB: 6, diskGB: 500 },
  'sgdb': { cores: 8, ramGB: 16, diskGB: 500 },
  'sify-app': { cores: 4, ramGB: 16, diskGB: 250 }
};

// =======================================================

// Helper to encode Basic Authentication credentials for Nagios
const getAuthHeader = () => {
  const credentials = `${NAGIOS_USER}:${NAGIOS_PASS}`;
  const base64 = Buffer.from(credentials).toString('base64');
  return `Basic ${base64}`;
};

/**
 * Fetch remote metrics via direct SSH (Preference 1)
 */
async function fetchRemoteMetrics(server) {
  const host = server.host;
  const user = server.user || SSH_USER;
  
  // Command to retrieve: CPU cores, Load Average, Memory Info, and Root Disk Space
  const remoteCmd = "nproc && cat /proc/loadavg && grep -E 'MemTotal|MemAvailable|MemFree|Buffers|Cached' /proc/meminfo && df -B1 / | tail -n 1";
  
  let sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5`;
  if (SSH_KEY_PATH) {
    sshCmd += ` -i ${SSH_KEY_PATH}`;
  }
  sshCmd += ` ${user}@${host} "${remoteCmd}"`;

  const { stdout } = await execPromise(sshCmd);
  return parseSshOutput(stdout, server);
}

/**
 * Parse raw SSH stdout into structured metrics
 */
function parseSshOutput(stdout, server) {
  const lines = stdout.trim().split('\n');
  if (lines.length < 4) {
    throw new Error('Incomplete command output returned from remote host.');
  }

  const cores = parseInt(lines[0].trim(), 10);
  if (isNaN(cores) || cores <= 0) {
    throw new Error('Failed to parse CPU core count.');
  }

  const loadLine = lines[1].trim();
  const loadParts = loadLine.split(/\s+/);
  const oneMin = parseFloat(loadParts[0]);
  const fiveMin = parseFloat(loadParts[1]);
  const fifteenMin = parseFloat(loadParts[2]);

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

  if (memAvailableKB === 0) {
    memAvailableKB = memFreeKB + buffersKB + cachedKB;
  }

  const totalRamBytes = memTotalKB * 1024;
  const availableRamBytes = memAvailableKB * 1024;
  const usedRamBytes = totalRamBytes - availableRamBytes;
  const ramUsagePercent = parseFloat(((usedRamBytes / totalRamBytes) * 100).toFixed(1));

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
 * Fetch status/metrics from Nagios (Preference 2 / Fallback)
 */
async function fetchNagiosMetrics(hostName, nagiosServices) {
  const serverId = hostName;
  const serverName = hostName;
  const sanitizedId = serverId.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  
  const specs = SERVER_SPECS[sanitizedId] || { cores: 4, ramGB: 16, diskGB: 250 };
  const serverCores = specs.cores;
  const specTotalRamBytes = specs.ramGB * 1024 * 1024 * 1024;
  const specTotalDiskBytes = specs.diskGB * 1024 * 1024 * 1024;

  let cpuUsage = 0;
  let ramUsagePercent = 0;
  let totalRamBytes = specTotalRamBytes;
  let usedRamBytes = 0;
  let loadOneMin = 0.0;
  let loadFiveMin = 0.0;
  let loadFifteenMin = 0.0;

  let parsedCpu = null;
  let parsedRam = null;
  let parsedLoad = null;

  const hostServices = nagiosServices[hostName] || {};

  // 1. CPU/Load
  if (hostServices['CPU check'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'CPU check');
    if (details && details.plugin_output) {
      const val = parseCpuCheck(details.plugin_output);
      if (val !== null) {
        parsedCpu = parseFloat(Math.min(99.9, (val / serverCores) * 100).toFixed(1));
        parsedLoad = {
          oneMin: val,
          fiveMin: parseFloat((val * 0.9).toFixed(2)),
          fifteenMin: parseFloat((val * 0.85).toFixed(2))
        };
      }
    }
  }

  if (hostServices['Load Average'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'Load Average');
    if (details && details.plugin_output) {
      const load = parseLoadAverage(details.plugin_output);
      if (load) {
        parsedLoad = load;
        if (parsedCpu === null) {
          parsedCpu = parseFloat(Math.min(99.9, (load.oneMin / serverCores) * 100).toFixed(1));
        }
      }
    }
  }

  if (parsedLoad === null && hostServices['Uptime'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'Uptime');
    if (details && details.plugin_output) {
      const load = parseLoadAverage(details.plugin_output);
      if (load) {
        parsedLoad = load;
        if (parsedCpu === null) {
          parsedCpu = parseFloat(Math.min(99.9, (load.oneMin / serverCores) * 100).toFixed(1));
        }
      }
    }
  }

  // 2. Memory
  if (hostServices['memory check'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'memory check');
    if (details) {
      const ram = parseMemoryCheck(details.plugin_output || '', details.long_plugin_output || '');
      if (ram) {
        parsedRam = ram;
      }
    }
  }

  if (parsedRam === null && hostServices['Memory Usage'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'Memory Usage');
    if (details && details.plugin_output) {
      const pct = parseMemoryUsage(details.plugin_output);
      if (pct !== null) {
        parsedRam = {
          totalBytes: specTotalRamBytes,
          usedBytes: Math.round((pct / 100) * specTotalRamBytes),
          usagePercent: pct
        };
      }
    }
  }

  // 3. Disk
  let diskUsagePercent = 0;
  let parsedDiskPercent = null;

  if (hostServices['Disk Space'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'Disk Space');
    if (details && details.plugin_output) {
      const match = details.plugin_output.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) parsedDiskPercent = parseFloat(match[1]);
    }
  } else if (hostServices['Disk Usage'] !== undefined) {
    const details = await fetchServiceDetails(hostName, 'Disk Usage');
    if (details && details.plugin_output) {
      const match = details.plugin_output.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) parsedDiskPercent = parseFloat(match[1]);
    }
  }

  if (parsedDiskPercent !== null) {
    diskUsagePercent = parsedDiskPercent;
  } else {
    diskUsagePercent = (hostServices['Disk Space'] !== undefined || hostServices['Disk Usage'] !== undefined) ? 40 : 0;
  }
  let totalDiskBytes = specTotalDiskBytes;
  let usedDiskBytes = Math.round((diskUsagePercent / 100) * totalDiskBytes);

  if (parsedCpu !== null) cpuUsage = parsedCpu;
  if (parsedRam !== null) {
    ramUsagePercent = parsedRam.usagePercent;
    totalRamBytes = parsedRam.totalBytes;
    usedRamBytes = parsedRam.usedBytes;
  }
  if (parsedLoad !== null) {
    loadOneMin = parsedLoad.oneMin;
    loadFiveMin = parsedLoad.fiveMin;
    loadFifteenMin = parsedLoad.fifteenMin;
  }

  return {
    serverId: sanitizedId,
    serverName: serverName,
    cpuUsage: parseFloat(cpuUsage.toFixed(1)),
    ramUsage: {
      totalBytes: totalRamBytes,
      usedBytes: usedRamBytes,
      usagePercent: parseFloat(ramUsagePercent.toFixed(1))
    },
    diskUsage: {
      totalBytes: totalDiskBytes,
      usedBytes: usedDiskBytes,
      usagePercent: parseFloat(diskUsagePercent.toFixed(1))
    },
    loadAverage: {
      oneMin: parseFloat(loadOneMin.toFixed(2)),
      fiveMin: parseFloat(loadFiveMin.toFixed(2)),
      fifteenMin: parseFloat(loadFifteenMin.toFixed(2))
    },
    cpuCores: serverCores,
    timestamp: new Date().toISOString()
  };
}

// --- Nagios Fetch API Helpers ---
async function fetchServiceList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=servicelist`;
    const response = await fetch(url, { headers: { 'Authorization': getAuthHeader() } });
    if (!response.ok) throw new Error(`Nagios HTTP status ${response.status}`);
    const data = await response.json();
    return data.data.servicelist || {};
  } catch (err) {
    console.error(`[Nagios API Error] Failed to fetch servicelist:`, err.message);
    return null;
  }
}

async function fetchServiceDetails(hostname, serviceDescription) {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=service&hostname=${encodeURIComponent(hostname)}&servicedescription=${encodeURIComponent(serviceDescription)}`;
    const response = await fetch(url, { headers: { 'Authorization': getAuthHeader() } });
    if (!response.ok) throw new Error(`Nagios HTTP status ${response.status}`);
    const data = await response.json();
    return data.data.service || null;
  } catch (err) {
    return null;
  }
}

// --- Parser Helpers for Nagios Outputs ---
function parseCpuCheck(output) {
  const match = output.match(/CPU load(?: is)? at ([\d\.]+)/i) || 
                output.match(/load average: ([\d\.]+)/i) || 
                output.match(/CPU(?: usage)?:?\s*([\d\.]+)/i);
  return match ? parseFloat(match[1]) : null;
}

function parseLoadAverage(output) {
  const match = output.match(/load average:\s*([\d\.]+),\s*([\d\.]+),\s*([\d\.]+)/i);
  return match ? { oneMin: parseFloat(match[1]), fiveMin: parseFloat(match[2]), fifteenMin: parseFloat(match[3]) } : null;
}

function parseMemoryUsage(output) {
  const match = output.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]) : null;
}

function parseMemoryCheck(pluginOutput, longPluginOutput) {
  const fullText = (pluginOutput + '\n' + (longPluginOutput || '')).trim();
  const lines = fullText.split('\n');
  const memLine = lines.find(line => line.trim().startsWith('Mem:'));
  if (memLine) {
    const parts = memLine.trim().split(/\s+/);
    if (parts.length >= 3) {
      const totalMB = parseFloat(parts[1]);
      const usedMB = parseFloat(parts[2]);
      if (totalMB > 0) {
        return {
          totalBytes: totalMB * 1024 * 1024,
          usedBytes: usedMB * 1024 * 1024,
          usagePercent: parseFloat(((usedMB / totalMB) * 100).toFixed(1))
        };
      }
    }
  }
  return null;
}

/**
 * Post metrics to Server Analysis backend API
 */
async function sendToBackend(payload) {
  const response = await fetch(DASHBOARD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`HTTP ${response.status} - ${txt}`);
  }
}

/**
 * Main Poll Loop
 */
async function pollAndSend() {
  console.log(`\n--- Real-Time Poll: ${new Date().toISOString()} ---`);
  
  // 1. Fetch Nagios service list once per loop to check fallback hosts
  const nagiosServices = await fetchServiceList();

  // Create a list of hosts we have already processed
  const processedHosts = new Set();

  // 2. Probing configured target servers
  const sshPromises = SERVERS.map(async (server) => {
    processedHosts.add(server.id);
    processedHosts.add(server.name);
    
    try {
      console.log(`[SSH Probe] ${server.id} | Attempting direct connect to ${server.host}...`);
      const payload = await fetchRemoteMetrics(server);
      await sendToBackend(payload);
      console.log(`[SSH Success] ${server.id} | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
    } catch (err) {
      console.warn(`[SSH Failed] ${server.id} (${server.host}): ${err.message}. Falling back to Nagios bridge...`);
      
      // Fallback: Query from Nagios cgi-bin
      if (nagiosServices && (nagiosServices[server.name] || nagiosServices[server.id])) {
        const targetNagiosHost = nagiosServices[server.name] ? server.name : server.id;
        try {
          const payload = await fetchNagiosMetrics(targetNagiosHost, nagiosServices);
          await sendToBackend(payload);
          console.log(`[Nagios Success] ${server.id} (via fallback) | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
        } catch (nagiosErr) {
          console.error(`[Failed] ${server.id}: Both SSH and Nagios connection failed. (${nagiosErr.message})`);
        }
      } else {
        console.error(`[Failed] ${server.id}: SSH failed and server is not monitored in Nagios.`);
      }
    }
  });

  await Promise.all(sshPromises);

  // 3. Dynamic Nagios discovery: Find hosts in Nagios that are not in the hardcoded SSH list
  if (nagiosServices) {
    const nagiosHosts = Object.keys(nagiosServices);
    const discoveryPromises = nagiosHosts.map(async (hostName) => {
      const sanitized = hostName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      // Skip if already processed or matches laptop pattern
      if (processedHosts.has(hostName) || processedHosts.has(sanitized) || hostName.includes('laptop')) {
        return;
      }

      console.log(`[Nagios Discovery] Discovered host: ${hostName}. Fetching metrics...`);
      try {
        const payload = await fetchNagiosMetrics(hostName, nagiosServices);
        await sendToBackend(payload);
        console.log(`[Nagios Success] ${hostName} (discovered) | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
      } catch (err) {
        console.error(`[Failed] Discovered host ${hostName} metrics fetch failed: ${err.message}`);
      }
    });
    
    await Promise.all(discoveryPromises);
  }
}

// Start poll loop
console.log(`Starting Hybrid SSH & Nagios Real-Time Collector...`);
console.log(`Dashboard Target API: ${DASHBOARD_API_URL}`);
console.log(`SSH Default User: ${SSH_USER}`);
console.log(`SSH Key Path: ${SSH_KEY_PATH || 'default system key'}`);
console.log(`Nagios API Endpoint: ${NAGIOS_URL}`);
console.log(`Polling Interval: ${POLL_INTERVAL_MS / 1000}s`);

setInterval(pollAndSend, POLL_INTERVAL_MS);
pollAndSend();
