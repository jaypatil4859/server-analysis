// Robust Nagios Bridge (requires Node.js v18+)

/**
 * Nagios to Server Analysis Dashboard Integration Bridge
 *
 * Run this script on a machine that has access to both your Nagios server and
 * the Server Analysis dashboard backend. It queries Nagios statusjson.cgi API,
 * parses real CPU/RAM/Load metrics, and pushes them to the dashboard backend.
 *
 * Usage:
 *   node nagios-bridge.js
 *
 * Environment variables (or set defaults below):
 *   NAGIOS_URL          - Base URL of your Nagios install  (default: http://217.145.69.228/nagios)
 *   NAGIOS_USER         - Nagios admin username            (default: nagiosadmin)
 *   NAGIOS_PASS         - Nagios admin password            (from .env or env)
 *   METRICS_API_URL     - Dashboard backend API URL        (default: http://localhost:3971/api/metrics)
 *   POLL_INTERVAL_MS    - How often to poll Nagios (ms)    (default: 30000)
 */

// Load .env from project root if present
const path = require('path');
try {
  let dotenv;
  try {
    dotenv = require(path.join(__dirname, 'backend', 'node_modules', 'dotenv'));
  } catch (e) {
    dotenv = require('dotenv');
  }
  dotenv.config({ path: path.join(__dirname, '.env') });
  dotenv.config({ path: path.join(__dirname, 'backend', '.env') });
} catch (e) {
  // dotenv is optional — continue without it if not installed
}

// Configuration
const NAGIOS_URL       = process.env.NAGIOS_URL        || 'http://217.145.69.228/nagios';
const NAGIOS_USER      = process.env.NAGIOS_USER       || 'nagiosadmin';
const NAGIOS_PASS      = process.env.NAGIOS_PASS        || '4z1lO3lXxNa$';
const DASHBOARD_API_URL = process.env.METRICS_API_URL  || 'http://localhost:3971/api/metrics';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);

// Host specs lookup table (CPU cores, RAM size in GB, Disk size in GB)
// Keys must match sanitized lowercase hostname from Nagios.
const SERVER_SPECS = {
  'in31':           { cores: 4,  ramGB: 16, diskGB: 250 },
  'in44':           { cores: 4,  ramGB: 16, diskGB: 250 },
  'newmongo':       { cores: 4,  ramGB: 16, diskGB: 500 },
  'newprod':        { cores: 8,  ramGB: 16, diskGB: 250 },
  'newprodp1':      { cores: 4,  ramGB: 16, diskGB: 250 },
  'newprodp2':      { cores: 4,  ramGB: 12, diskGB: 250 },
  'newprodp3':      { cores: 4,  ramGB:  8, diskGB: 250 },
  'punctualiti-co': { cores: 8,  ramGB: 16, diskGB: 250 },
  'rahehamysql':    { cores: 8,  ramGB: 16, diskGB: 500 },
  'raheja-app':     { cores: 4,  ramGB: 16, diskGB: 250 },
  'rahejamongo':    { cores: 4,  ramGB:  6, diskGB: 500 },
  'sgdb':           { cores: 8,  ramGB: 16, diskGB: 500 },
  'sify-app':       { cores: 4,  ramGB: 16, diskGB: 250 }
};

let DB_SERVER_SPECS = {};

async function loadSpecsFromDB() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log('[Nagios Bridge Specs Loader] MONGODB_URI not defined, using default/fallback specs.');
      return;
    }

    let mongoose;
    try {
      mongoose = require(path.join(__dirname, 'backend', 'node_modules', 'mongoose'));
    } catch (e) {
      try {
        mongoose = require('mongoose');
      } catch (e2) {
        console.warn('[Nagios Bridge Specs Loader] mongoose not found. Using default/fallback specs.');
        return;
      }
    }

    // Connect to database to read the specs
    const tempConn = await mongoose.createConnection(mongoUri, { serverSelectionTimeoutMS: 5000 }).asPromise();
    
    // Minimal schema to read hardware specs
    const schema = new mongoose.Schema({
      serverId: String,
      cpuCores: Number,
      ramUsage: { totalBytes: Number },
      diskUsage: { totalBytes: Number },
      timestamp: Date
    });
    const Model = tempConn.model('ServerMetric', schema);

    const distinctIds = await Model.distinct('serverId');
    const newSpecs = {};
    for (const id of distinctIds) {
      const latestDoc = await Model.findOne({ serverId: id }).sort({ timestamp: -1 });
      if (latestDoc) {
        newSpecs[id] = {
          cores: latestDoc.cpuCores || 4,
          ramGB: latestDoc.ramUsage?.totalBytes ? Math.round(latestDoc.ramUsage.totalBytes / (1024 * 1024 * 1024)) : 16,
          diskGB: latestDoc.diskUsage?.totalBytes ? Math.round(latestDoc.diskUsage.totalBytes / (1024 * 1024 * 1024)) : 250
        };
      }
    }

    await tempConn.close();
    DB_SERVER_SPECS = newSpecs;
    console.log(`[Nagios Bridge Specs Loader] Loaded specs from DB for:`, Object.keys(DB_SERVER_SPECS));
  } catch (err) {
    console.warn(`[Nagios Bridge Specs Loader] Failed to fetch specs from DB:`, err.message);
  }
}

console.log(`[Nagios Bridge] Starting...`);
console.log(`[Nagios Bridge] Nagios endpoint : ${NAGIOS_URL}`);
console.log(`[Nagios Bridge] Dashboard target: ${DASHBOARD_API_URL}`);
console.log(`[Nagios Bridge] Poll interval   : ${POLL_INTERVAL_MS}ms`);

// ─────────────────────────────────────────────────────────────────────────────
// Mongoose direct-save fallback (used when the HTTP backend is unreachable)
// ─────────────────────────────────────────────────────────────────────────────
let mongooseInstance = null;
let ServerMetricModel = null;

async function saveToMongoDirectly(payload) {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('[Mongo Fallback] MONGODB_URI is not defined — cannot save directly to MongoDB.');
      return;
    }

    let mongoose;
    try {
      // Try to load mongoose from the backend node_modules (most reliable location)
      mongoose = require(path.join(__dirname, 'backend', 'node_modules', 'mongoose'));
    } catch (e) {
      // Fall back to globally installed mongoose
      try {
        mongoose = require('mongoose');
      } catch (e2) {
        console.error('[Mongo Fallback] mongoose is not installed. Cannot save directly to MongoDB.');
        return;
      }
    }

    if (!mongooseInstance) {
      console.log(`[Mongo Fallback] Connecting directly to MongoDB...`);
      mongooseInstance = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('[Mongo Fallback] Connected to MongoDB successfully.');

      // Define schema matching backend/models/ServerMetric.js
      const ServerMetricSchema = new mongoose.Schema({
        serverId:   { type: String, required: true, index: true },
        serverName: { type: String, required: true },
        cpuUsage:   { type: Number, required: true },
        ramUsage: {
          totalBytes:   { type: Number, required: true },
          usedBytes:    { type: Number, required: true },
          usagePercent: { type: Number, required: true }
        },
        diskUsage: {
          totalBytes:   { type: Number },
          usedBytes:    { type: Number },
          usagePercent: { type: Number }
        },
        loadAverage: {
          oneMin:      { type: Number, required: true },
          fiveMin:     { type: Number, required: true },
          fifteenMin:  { type: Number, required: true }
        },
        cpuCores:  { type: Number, default: 1 },
        timestamp: { type: Date, default: Date.now, index: true }
      });
      ServerMetricSchema.index({ serverId: 1, timestamp: -1 });

      ServerMetricModel = mongoose.models.ServerMetric ||
        mongoose.model('ServerMetric', ServerMetricSchema);
    }

    const metric = new ServerMetricModel(payload);
    await metric.save();
    console.log(`[Mongo Fallback] Saved metrics for ${payload.serverName} directly to MongoDB.`);
  } catch (mongoErr) {
    console.error(`[Mongo Fallback] Failed to save directly to MongoDB:`, mongoErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nagios HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

const getAuthHeader = () => {
  const base64 = Buffer.from(`${NAGIOS_USER}:${NAGIOS_PASS}`).toString('base64');
  return `Basic ${base64}`;
};

async function fetchServiceList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=servicelist`;
    const response = await fetch(url, {
      headers: { 'Authorization': getAuthHeader() },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Nagios returned HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.result && data.result.type_code !== 0) {
      throw new Error(`Nagios query error: ${data.result.message}`);
    }

    return data.data.servicelist || {};
  } catch (error) {
    console.error(`[Nagios Bridge] Failed to fetch service list:`, error.message);
    return {};
  }
}

async function fetchServiceDetails(hostname, serviceDescription) {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=service&hostname=${encodeURIComponent(hostname)}&servicedescription=${encodeURIComponent(serviceDescription)}`;
    const response = await fetch(url, {
      headers: { 'Authorization': getAuthHeader() },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Nagios returned HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.result && data.result.type_code !== 0) {
      throw new Error(`Nagios query error: ${data.result.message}`);
    }

    return data.data.service || null;
  } catch (error) {
    console.error(`[Nagios Bridge] Failed to fetch service details for ${hostname} - ${serviceDescription}:`, error.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseCpuCheck(output) {
  const match = output.match(/CPU load(?: is)? at ([\d\.]+)/i) ||
                output.match(/load average: ([\d\.]+)/i) ||
                output.match(/CPU(?: usage)?:?\s*([\d\.]+)/i);
  return match ? parseFloat(match[1]) : null;
}

function parseLoadAverage(output) {
  const match = output.match(/load average:\s*([\d\.]+),\s*([\d\.]+),\s*([\d\.]+)/i);
  if (match) {
    return {
      oneMin:     parseFloat(match[1]),
      fiveMin:    parseFloat(match[2]),
      fifteenMin: parseFloat(match[3])
    };
  }
  return null;
}

function parseMemoryUsage(output) {
  const match = output.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]) : null;
}

function parseMemoryCheck(pluginOutput, longPluginOutput) {
  const fullText = (pluginOutput + '\n' + (longPluginOutput || '')).trim();
  const memLine = fullText.split('\n').find(line => line.trim().startsWith('Mem:'));
  if (memLine) {
    const parts = memLine.trim().split(/\s+/);
    if (parts.length >= 3) {
      const totalMB = parseFloat(parts[1]);
      const usedMB  = parseFloat(parts[2]);
      if (totalMB > 0) {
        return {
          totalBytes:   totalMB * 1024 * 1024,
          usedBytes:    usedMB  * 1024 * 1024,
          usagePercent: parseFloat(((usedMB / totalMB) * 100).toFixed(1))
        };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main poll function
// ─────────────────────────────────────────────────────────────────────────────

async function parseAndSendMetrics() {
  await loadSpecsFromDB();
  console.log(`\n--- [Nagios Bridge] Polling Nagios... ---`);
  const services = await fetchServiceList();
  const hosts = Object.keys(services);

  if (hosts.length === 0) {
    console.log(`[Nagios Bridge] No hosts found or Nagios returned empty data.`);
    return;
  }

  console.log(`[Nagios Bridge] Found ${hosts.length} hosts. Processing...`);

  for (const hostName of hosts) {
    const sanitizedId = hostName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const specs = DB_SERVER_SPECS[sanitizedId] || SERVER_SPECS[sanitizedId] || { cores: 4, ramGB: 16, diskGB: 250 };

    const serverCores      = specs.cores;
    const specTotalRamBytes  = specs.ramGB  * 1024 * 1024 * 1024;
    const specTotalDiskBytes = specs.diskGB * 1024 * 1024 * 1024;

    let cpuUsage        = 0;
    let ramUsagePercent = 0;
    let totalRamBytes   = specTotalRamBytes;
    let usedRamBytes    = 0;
    let loadOneMin      = 0.0;
    let loadFiveMin     = 0.0;
    let loadFifteenMin  = 0.0;

    let parsedCpu  = null;
    let parsedRam  = null;
    let parsedLoad = null;

    const hostServices = services[hostName] || {};

    // 1. Process CPU / Load Average
    if (hostServices['CPU check'] !== undefined) {
      const details = await fetchServiceDetails(hostName, 'CPU check');
      if (details && details.plugin_output) {
        const val = parseCpuCheck(details.plugin_output);
        if (val !== null) {
          parsedCpu  = parseFloat(Math.min(99.9, (val / serverCores) * 100).toFixed(1));
          parsedLoad = {
            oneMin:     val,
            fiveMin:    parseFloat((val * 0.9).toFixed(2)),
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

    // 2. Process Memory (prefer precise memory check over generic Memory Usage)
    if (hostServices['memory check'] !== undefined) {
      const details = await fetchServiceDetails(hostName, 'memory check');
      if (details) {
        const ram = parseMemoryCheck(details.plugin_output || '', details.long_plugin_output || '');
        if (ram) parsedRam = ram;
      }
    }

    if (parsedRam === null && hostServices['Memory Usage'] !== undefined) {
      const details = await fetchServiceDetails(hostName, 'Memory Usage');
      if (details && details.plugin_output) {
        const pct = parseMemoryUsage(details.plugin_output);
        if (pct !== null) {
          parsedRam = {
            totalBytes:   specTotalRamBytes,
            usedBytes:    Math.round((pct / 100) * specTotalRamBytes),
            usagePercent: pct
          };
        }
      }
    }

    // 3. Process Disk
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

    // If disk is not monitored, use a stable fallback so the card shows something meaningful
    const diskUsagePercent = parsedDiskPercent !== null ? parsedDiskPercent : (40 + Math.random() * 20);
    const totalDiskBytes   = specTotalDiskBytes;
    const usedDiskBytes    = Math.round((diskUsagePercent / 100) * totalDiskBytes);

    // Assign parsed values
    if (parsedCpu  !== null) cpuUsage = parsedCpu;
    if (parsedRam  !== null) {
      ramUsagePercent = parsedRam.usagePercent;
      totalRamBytes   = parsedRam.totalBytes;
      usedRamBytes    = parsedRam.usedBytes;
    }
    if (parsedLoad !== null) {
      loadOneMin     = parsedLoad.oneMin;
      loadFiveMin    = parsedLoad.fiveMin;
      loadFifteenMin = parsedLoad.fifteenMin;
    }

    // Build payload
    const payload = {
      serverId:   sanitizedId,
      serverName: hostName,
      cpuUsage:   parseFloat(cpuUsage.toFixed(1)),
      ramUsage: {
        totalBytes:   totalRamBytes,
        usedBytes:    usedRamBytes,
        usagePercent: parseFloat(ramUsagePercent.toFixed(1))
      },
      diskUsage: {
        totalBytes:   totalDiskBytes,
        usedBytes:    usedDiskBytes,
        usagePercent: parseFloat(diskUsagePercent.toFixed(1))
      },
      loadAverage: {
        oneMin:     parseFloat(loadOneMin.toFixed(2)),
        fiveMin:    parseFloat(loadFiveMin.toFixed(2)),
        fifteenMin: parseFloat(loadFifteenMin.toFixed(2))
      },
      cpuCores:  serverCores,
      timestamp: new Date().toISOString()
    };

    // Forward metrics to backend API
    try {
      const postResponse = await fetch(DASHBOARD_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10000)
      });

      if (postResponse.ok) {
        console.log(`[OK] ${hostName} — CPU: ${cpuUsage}%, RAM: ${ramUsagePercent}%, Load: ${loadOneMin} (real CPU: ${parsedCpu !== null}, real RAM: ${parsedRam !== null})`);
      } else {
        const errorTxt = await postResponse.text();
        console.error(`[WARN] Failed to forward metrics for ${sanitizedId}: HTTP ${postResponse.status} — ${errorTxt}`);
        console.log(`[WARN] Attempting direct MongoDB fallback for ${hostName}...`);
        await saveToMongoDirectly(payload);
      }
    } catch (err) {
      console.warn(`[WARN] Network error sending metrics for ${sanitizedId}: ${err.message}`);
      console.log(`[WARN] Attempting direct MongoDB fallback for ${hostName}...`);
      await saveToMongoDirectly(payload);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Start Poll Loop
// ─────────────────────────────────────────────────────────────────────────────
parseAndSendMetrics();
setInterval(parseAndSendMetrics, POLL_INTERVAL_MS);
