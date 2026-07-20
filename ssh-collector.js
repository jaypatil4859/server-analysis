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

// Load environment variables from .env if present
try {
  const dotenv = require('./backend/node_modules/dotenv');
  dotenv.config({ path: path.join(__dirname, '.env') });
  dotenv.config({ path: path.join(__dirname, 'backend', '.env') });
} catch (e) {
  // Ignore if dotenv is not available
}

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
  'in31': { cores: 8, ramGB: 16, diskGB: 250 },
  'in44': { cores: 8, ramGB: 16, diskGB: 250 },
  'newmongo': { cores: 4, ramGB: 16, diskGB: 500 },
  'newprod': { cores: 8, ramGB: 16, diskGB: 250 },
  'newprodp1': { cores: 4, ramGB: 16, diskGB: 250 },
  'newprodp2': { cores: 4, ramGB: 12, diskGB: 250 },
  'newprodp3': { cores: 4, ramGB: 8, diskGB: 250 },
  'punctualiti-co': { cores: 8, ramGB: 16, diskGB: 250 },
  'rahehamysql': { cores: 8, ramGB: 16, diskGB: 500 },
  'raheja-app': { cores: 4, ramGB: 16, diskGB: 250 },
  'rahejamongo': { cores: 6, ramGB: 6, diskGB: 500 },
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
  // Tries the custom devops command /scpu first
  const remoteCmd = "C=\\$(/scpu 2>/dev/null || nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo); echo \"\\$C\" && cat /proc/loadavg && grep -E 'MemTotal|MemAvailable|MemFree|Buffers|Cached' /proc/meminfo && df -B1 / | tail -n 1";
  
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

  // Parse CPU cores safely, extracting digits in case of text wrapper
  const coresMatch = lines[0].trim().match(/\d+/);
  const cores = coresMatch ? parseInt(coresMatch[0], 10) : 4;
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
async function fetchNagiosMetrics(hostName, nagiosServices, hostStates = {}) {
  const serverId = hostName;
  const serverName = hostName;
  const sanitizedId = serverId.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const hostStatusVal = hostStates[hostName] || 'up';
  
  const specs = SERVER_SPECS[sanitizedId] || { cores: 4, ramGB: 16, diskGB: 250 };
  const serverCores = specs.cores;
  const specTotalRamBytes = specs.ramGB * 1024 * 1024 * 1024;
  const specTotalDiskBytes = specs.diskGB * 1024 * 1024 * 1024;

  const hostServices = nagiosServices[hostName] || {};

  // Collect all service statuses
  const servicesList = Object.entries(hostServices)
    .filter(([, sDetails]) => sDetails != null)
    .map(([serviceDesc, sDetails]) => ({
      name:   serviceDesc,
      status: sDetails.status || 'unknown',
      output: sDetails.plugin_output || ''
    }));

  // Prepend host status
  const hostStatusDesc = hostStatusVal.toLowerCase() === 'up' ? 'OK' : 'CRITICAL';
  servicesList.unshift({
    name: 'Host Status',
    status: hostStatusDesc,
    output: `Nagios host check reports ${hostStatusVal.toUpperCase()}`
  });

  let parsedCpuPct  = null;
  let parsedLoad    = null;
  let parsedCores   = serverCores;

  // Check CPU service
  const cpuSvc = findServiceByKeywords(hostServices, ['cpu', 'processor', 'util'], ['usage', 'load average']);
  if (cpuSvc?.plugin_output) {
    parsedCores  = parseCpuCores(cpuSvc.plugin_output) || parsedCores;
    parsedLoad   = parseLoadAverage(cpuSvc.plugin_output) || parsedLoad;
    parsedCpuPct = parseCpuPercent(cpuSvc.plugin_output);
  }

  // Check Load service
  const loadSvc = findServiceByKeywords(hostServices, ['load average', 'load']) || findServiceByKeywords(hostServices, ['uptime']);
  if (loadSvc?.plugin_output) {
    parsedCores = parseCpuCores(loadSvc.plugin_output) || parsedCores;
    const load  = parseLoadAverage(loadSvc.plugin_output);
    if (load) {
      parsedLoad = load;
      if (parsedCpuPct === null) {
        if (parsedCores) {
          parsedCpuPct = Math.min(100, parseFloat(((load.oneMin / parsedCores) * 100).toFixed(1)));
        } else {
          parsedCpuPct = Math.min(100, parseFloat((load.oneMin * 20).toFixed(1)));
        }
      }
    }
  }

  // Check Uptime service
  const uptimeSvc = findServiceByKeywords(hostServices, ['uptime']);
  if (parsedLoad === null && uptimeSvc?.plugin_output) {
    parsedCores = parseCpuCores(uptimeSvc.plugin_output) || parsedCores;
    const load  = parseLoadAverage(uptimeSvc.plugin_output);
    if (load) {
      parsedLoad = load;
      if (parsedCpuPct === null && parsedCores) {
        parsedCpuPct = Math.min(100, parseFloat(((load.oneMin / parsedCores) * 100).toFixed(1)));
      }
    }
  }

  // ── Memory ─────────────────────────────────────────────────────────────
  let parsedRam = null;

  const memSvc = findServiceByKeywords(hostServices, ['memory check', 'memory', 'mem'], ['usage']);
  if (memSvc) {
    parsedRam = parseMemoryDetailed(memSvc.plugin_output || '', memSvc.long_plugin_output || '');
  }

  const memUsageSvc = findServiceByKeywords(hostServices, ['memory usage', 'ram', 'mem usage']);
  if (!parsedRam && memUsageSvc?.plugin_output) {
    const pct  = parseMemoryPercent(memUsageSvc.plugin_output);
    const total = parseTotalRamBytes(memUsageSvc.plugin_output) ||
                  parseTotalRamBytes(memUsageSvc.long_plugin_output || '');
    if (pct !== null && total) {
      parsedRam = {
        totalBytes:   total,
        usedBytes:    Math.round((pct / 100) * total),
        usagePercent: pct
      };
    } else if (pct !== null) {
      parsedRam = {
        usagePercent: pct
      };
    }
  }

  // ── Disk ───────────────────────────────────────────────────────────────
  let parsedDisk = null;

  const diskSvc = findServiceByKeywords(hostServices, ['disk', 'space', 'storage', '/']);
  if (diskSvc?.plugin_output) {
    const d = parseDiskUsage(diskSvc.plugin_output);
    if (d?.totalBytes) {
      parsedDisk = d;
    } else if (d?.usagePercent !== undefined) {
      const total = diskSvc.long_plugin_output ? parseTotalRamBytes(diskSvc.long_plugin_output) : null;
      if (total) {
        parsedDisk = {
          totalBytes:   total,
          usedBytes:    Math.round((d.usagePercent / 100) * total),
          usagePercent: d.usagePercent
        };
      } else {
        parsedDisk = {
          usagePercent: d.usagePercent
        };
      }
    }
  }

  // ── Build payload (self-healing fallbacks - DO NOT SKIP) ────
  const cpuUsageVal = isNumeric(parsedCpuPct) ? parseFloat(parsedCpuPct.toFixed(1)) : 0;
  
  let ramUsageVal = {
    totalBytes: specTotalRamBytes,
    usedBytes:  0,
    usagePercent: 0
  };
  if (parsedRam) {
    ramUsageVal = {
      totalBytes: isNumeric(parsedRam.totalBytes) ? parsedRam.totalBytes : specTotalRamBytes,
      usedBytes:  isNumeric(parsedRam.usedBytes)  ? parsedRam.usedBytes  : 0,
      usagePercent: isNumeric(parsedRam.usagePercent) ? parseFloat(parsedRam.usagePercent.toFixed(1)) : 0
    };
  }

  let loadAverageVal = { oneMin: 0, fiveMin: 0, fifteenMin: 0 };
  if (parsedLoad) {
    loadAverageVal = {
      oneMin:     isNumeric(parsedLoad.oneMin)     ? parseFloat(parsedLoad.oneMin.toFixed(2))     : 0,
      fiveMin:    isNumeric(parsedLoad.fiveMin)    ? parseFloat(parsedLoad.fiveMin.toFixed(2))    : 0,
      fifteenMin: isNumeric(parsedLoad.fifteenMin) ? parseFloat(parsedLoad.fifteenMin.toFixed(2)) : 0
    };
  }

  let diskUsageVal = {
    totalBytes: specTotalDiskBytes,
    usedBytes:  0,
    usagePercent: 0
  };
  if (parsedDisk) {
    diskUsageVal = {
      totalBytes: isNumeric(parsedDisk.totalBytes) ? parsedDisk.totalBytes : specTotalDiskBytes,
      usedBytes:  isNumeric(parsedDisk.usedBytes)  ? parsedDisk.usedBytes  : 0,
      usagePercent: isNumeric(parsedDisk.usagePercent) ? parseFloat(parsedDisk.usagePercent.toFixed(1)) : 0
    };
  }

  return {
    serverId: sanitizedId,
    serverName: serverName,
    status: hostStatusVal,
    cpuUsage: cpuUsageVal,
    ramUsage: ramUsageVal,
    diskUsage: diskUsageVal,
    loadAverage: loadAverageVal,
    cpuCores: isNumeric(parsedCores) ? parsedCores : serverCores,
    timestamp: new Date().toISOString(),
    services: servicesList
  };
}

// --- Nagios Fetch API Helpers ---
async function fetchServiceList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=servicelist&details=true&formatoptions=enumerate`;
    const response = await fetch(url, { headers: { 'Authorization': getAuthHeader() } });
    if (!response.ok) throw new Error(`Nagios HTTP status ${response.status}`);
    const data = await response.json();
    return data.data.servicelist || {};
  } catch (err) {
    console.error(`[Nagios API Error] Failed to fetch servicelist:`, err.message);
    return {};
  }
}

async function fetchHostList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=hostlist&formatoptions=enumerate`;
    const response = await fetch(url, { headers: { 'Authorization': getAuthHeader() } });
    if (!response.ok) throw new Error(`Nagios HTTP status ${response.status}`);
    const data = await response.json();
    return data.data.hostlist || {};
  } catch (err) {
    console.error(`[Nagios API Error] Failed to fetch host list:`, err.message);
    return {};
  }
}

// --- Parser Helpers for Nagios Outputs ---
function findServiceByKeywords(hostServices, keywords, excludeKeywords = []) {
  const keys = Object.keys(hostServices);
  const matchedKey = keys.find(k => {
    const lowerK = k.toLowerCase();
    const hasKeyword = keywords.some(kw => lowerK.includes(kw));
    const hasExclude = excludeKeywords.some(ex => lowerK.includes(ex));
    return hasKeyword && !hasExclude;
  });
  return matchedKey ? hostServices[matchedKey] : null;
}

function isNumeric(val) {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
}

function parseCpuPercent(output) {
  let m = output.match(/cpu\s*(?:usage)?:?\s*([\d.]+)\s*%/i);
  if (m) return Math.min(100, parseFloat(m[1]));

  const loadM = output.match(/load average:\s*([\d.]+)/i);
  const coreM = output.match(/(\d+)\s*cpu/i) || output.match(/(\d+)\s*core/i) || output.match(/(\d+)\s*processor/i);
  if (loadM) {
    const load  = parseFloat(loadM[1]);
    const cores = coreM ? parseInt(coreM[1]) : null;
    if (cores && cores > 0) {
      return Math.min(100, parseFloat(((load / cores) * 100).toFixed(1)));
    }
    return Math.min(100, parseFloat((load * 20).toFixed(1)));
  }

  m = output.match(/CPU load(?:\s+is)?\s+at\s+([\d.]+)/i);
  if (m) return Math.min(100, parseFloat(m[1]));

  return null;
}

function parseCpuCores(output) {
  const m = output.match(/(\d+)\s*(?:cpu|core|processor|logical)/i);
  return m ? parseInt(m[1]) : null;
}

function parseLoadAverage(output) {
  const m = output.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/i);
  if (m) return { oneMin: parseFloat(m[1]), fiveMin: parseFloat(m[2]), fifteenMin: parseFloat(m[3]) };
  return null;
}

function parseMemoryDetailed(pluginOutput, longPluginOutput) {
  const fullText = `${pluginOutput}\n${longPluginOutput || ''}`.trim();
  const memLine = fullText.split('\n').find(l => l.trim().startsWith('Mem:'));
  if (memLine) {
    const parts = memLine.trim().split(/\s+/);
    if (parts.length >= 3) {
      const totalMB = parseFloat(parts[1]);
      const usedMB  = parseFloat(parts[2]);
      if (totalMB > 0 && !isNaN(usedMB)) {
        return {
          totalBytes:   Math.round(totalMB * 1024 * 1024),
          usedBytes:    Math.round(usedMB  * 1024 * 1024),
          usagePercent: parseFloat(((usedMB / totalMB) * 100).toFixed(1))
        };
      }
    }
  }

  const totalM = fullText.match(/total:\s*([\d.]+)\s*(mb|gb|kb)/i);
  const usedM  = fullText.match(/used:\s*([\d.]+)\s*(mb|gb|kb)/i);
  if (totalM && usedM) {
    const unit = (v, u) => {
      const n = parseFloat(v);
      if (u.toLowerCase() === 'gb') return n * 1024 * 1024 * 1024;
      if (u.toLowerCase() === 'mb') return n * 1024 * 1024;
      if (u.toLowerCase() === 'kb') return n * 1024;
      return n;
    };
    const totalBytes = unit(totalM[1], totalM[2]);
    const usedBytes  = unit(usedM[1],  usedM[2]);
    return {
      totalBytes:   Math.round(totalBytes),
      usedBytes:    Math.round(usedBytes),
      usagePercent: parseFloat(((usedBytes / totalBytes) * 100).toFixed(1))
    };
  }
  return null;
}

function parseMemoryPercent(output) {
  const m = output.match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function parseTotalRamBytes(output) {
  const m = output.match(/(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)\s*(?:total|ram|memory)?/i) ||
            output.match(/(?:total|ram|memory)\s*:?\s*(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)/i);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith('g')) return Math.round(n * 1024 * 1024 * 1024);
    if (u.startsWith('m')) return Math.round(n * 1024 * 1024);
  }
  return null;
}

function parseDiskUsage(output) {
  const pctM = output.match(/([\d.]+)\s*%/);
  if (!pctM) return null;
  const pct = parseFloat(pctM[1]);

  const totalM = output.match(/(?:total|size)[:=]?\s*([\d.]+)\s*(GB|GiB|MB|MiB|TB|TiB)/i) ||
                 output.match(/([\d.]+)\s*(GB|GiB|MB|MiB|TB|TiB)\s+total/i);
  let totalBytes = null;
  if (totalM) {
    const n = parseFloat(totalM[1]);
    const u = totalM[2].toLowerCase();
    if (u.startsWith('t')) totalBytes = Math.round(n * 1024 * 1024 * 1024 * 1024);
    else if (u.startsWith('g')) totalBytes = Math.round(n * 1024 * 1024 * 1024);
    else if (u.startsWith('m')) totalBytes = Math.round(n * 1024 * 1024);
  }

  if (!totalBytes) return { usagePercent: pct };
  return {
    totalBytes,
    usedBytes:    Math.round((pct / 100) * totalBytes),
    usagePercent: pct
  };
}

let mongooseInstance = null;
let ServerMetricModel = null;

async function saveToMongoDirectly(payload) {
  try {

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment or .env file');
    }

    const mongoose = require('./backend/node_modules/mongoose');

    if (!mongooseInstance) {
      console.log(`[Mongo Fallback] Connecting directly to MongoDB...`);
      mongooseInstance = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('[Mongo Fallback] Connected to MongoDB successfully.');
      
      // Define schema and model matching backend/models/ServerMetric.js
      const ServerMetricSchema = new mongoose.Schema({
        serverId: { type: String, required: true, index: true },
        serverName: { type: String, required: true },
        status: { type: String, default: 'up' },
        cpuUsage: { type: Number, required: true },
        ramUsage: {
          totalBytes: { type: Number },
          usedBytes: { type: Number },
          usagePercent: { type: Number, required: true }
        },
        diskUsage: {
          totalBytes: { type: Number },
          usedBytes: { type: Number },
          usagePercent: { type: Number }
        },
        loadAverage: {
          oneMin: { type: Number, required: true },
          fiveMin: { type: Number, required: true },
          fifteenMin: { type: Number, required: true }
        },
        cpuCores: { type: Number, default: 1 },
        timestamp: { type: Date, default: Date.now, index: true },
        services: [{ name: String, status: String, output: String }]
      });
      ServerMetricSchema.index({ serverId: 1, timestamp: -1 });
      
      ServerMetricModel = mongoose.models.ServerMetric || mongoose.model('ServerMetric', ServerMetricSchema);
    }

    const metric = new ServerMetricModel(payload);
    await metric.save();
    console.log(`[Mongo Fallback Success] Successfully saved metrics for ${payload.serverName} directly to MongoDB.`);
  } catch (mongoErr) {
    console.error(`[Mongo Fallback Failed] Failed to save metrics directly to MongoDB:`, mongoErr.message);
  }
}

/**
 * Post metrics to Server Analysis backend API
 */
async function sendToBackend(payload) {
  try {
    const response = await fetch(DASHBOARD_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`HTTP ${response.status} - ${txt}`);
    }
  } catch (err) {
    console.warn(`[Collector Warning] Failed to send metrics to backend API (${err.message}). Attempting direct MongoDB storage fallback...`);
    await saveToMongoDirectly(payload);
  }
}


/**
 * Main Poll Loop
 */
async function pollAndSend() {
  console.log(`\n--- Real-Time Poll: ${new Date().toISOString()} ---`);
  
  // 1. Fetch Nagios service list and host list in parallel
  const [nagiosServices, hostStates] = await Promise.all([
    fetchServiceList(),
    fetchHostList()
  ]);

  // Create a list of hosts we have already processed
  const processedHosts = new Set();

  // 2. Probing configured target servers
  const sshPromises = SERVERS.map(async (server) => {
    processedHosts.add(server.id);
    processedHosts.add(server.name);
    
    try {
      console.log(`[SSH Probe] ${server.id} | Attempting direct connect to ${server.host}...`);
      const payload = await fetchRemoteMetrics(server);
      // Ensure status is up if direct SSH succeeded
      payload.status = 'up';
      await sendToBackend(payload);
      console.log(`[SSH Success] ${server.id} | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
    } catch (err) {
      console.warn(`[SSH Failed] ${server.id} (${server.host}): ${err.message}. Falling back to Nagios bridge...`);
      
      // Fallback: Query from Nagios cgi-bin
      const hostFoundInNagios = nagiosServices && (nagiosServices[server.name] || nagiosServices[server.id]);
      const targetNagiosHost = nagiosServices && nagiosServices[server.name] ? server.name : server.id;
      
      if (hostFoundInNagios || hostStates[server.name] || hostStates[server.id]) {
        const queryHostName = hostFoundInNagios ? targetNagiosHost : (hostStates[server.name] ? server.name : server.id);
        try {
          const payload = await fetchNagiosMetrics(queryHostName, nagiosServices || {}, hostStates);
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
  const nagiosHosts = Array.from(new Set([
    ...(nagiosServices ? Object.keys(nagiosServices) : []),
    ...Object.keys(hostStates)
  ]));

  const discoveryPromises = nagiosHosts.map(async (hostName) => {
    const sanitized = hostName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    // Skip if already processed or matches laptop pattern
    if (processedHosts.has(hostName) || processedHosts.has(sanitized) || hostName.includes('laptop')) {
      return;
    }

    console.log(`[Nagios Discovery] Discovered host: ${hostName}. Fetching metrics...`);
    try {
      const payload = await fetchNagiosMetrics(hostName, nagiosServices || {}, hostStates);
      await sendToBackend(payload);
      console.log(`[Nagios Success] ${hostName} (discovered) | CPU: ${payload.cpuUsage}% | RAM: ${payload.ramUsage.usagePercent}% | Load: ${payload.loadAverage.oneMin}`);
    } catch (err) {
      console.error(`[Failed] Discovered host ${hostName} metrics fetch failed: ${err.message}`);
    }
  });
  
  await Promise.all(discoveryPromises);
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
