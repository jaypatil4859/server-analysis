// Nagios Bridge — Server Analysis Dashboard Integration (Self-Healing Edition)
// Queries Nagios statusjson.cgi and pushes real-time metrics to the dashboard backend.
// All server specs (RAM, disk, CPU cores) are extracted dynamically from Nagios plugin outputs.
//
// Self-Healing Features:
//   - Watchdog timer: force-exits if any poll hangs > 90s (PM2/Docker auto-restarts)
//   - Uncaught exception + unhandled rejection handlers → graceful exit for PM2 restart
//   - Orphan cleanup: tells backend to remove hosts that disappeared from Nagios
//   - Exponential backoff retry on Nagios network errors
//   - nagiosLastSeen + nagiosStatus in every payload for frontend stale-override
//
// Usage:  node nagios-bridge.js
// Env vars:
//   NAGIOS_URL          Nagios base URL          (default: http://217.145.69.228/nagios)
//   NAGIOS_USER         Nagios admin user         (default: nagiosadmin)
//   NAGIOS_PASS         Nagios admin password
//   METRICS_API_URL     Dashboard backend URL     (default: http://localhost:3971/api/metrics)
//   MONGODB_URI         Direct Mongo fallback URI
//   POLL_INTERVAL_MS    How often to poll (ms)    (default: 20000)
//   WATCHDOG_TIMEOUT_MS Max ms a poll can run     (default: 90000)

'use strict';

const path = require('path');
try {
  let dotenv;
  try { dotenv = require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')); }
  catch { dotenv = require('dotenv'); }
  dotenv.config({ path: path.join(__dirname, '.env') });
  dotenv.config({ path: path.join(__dirname, 'backend', '.env') });
} catch { /* dotenv optional */ }

const NAGIOS_URL          = process.env.NAGIOS_URL          || 'http://217.145.69.228/nagios';
const NAGIOS_USER         = process.env.NAGIOS_USER         || 'nagiosadmin';
const NAGIOS_PASS         = process.env.NAGIOS_PASS         || '4z1lO3lXxNa$';
const DASHBOARD_API_URL   = process.env.METRICS_API_URL     || 'http://localhost:3971/api/metrics';
const POLL_INTERVAL_MS    = parseInt(process.env.POLL_INTERVAL_MS    || '20000', 10);
const WATCHDOG_TIMEOUT_MS = parseInt(process.env.WATCHDOG_TIMEOUT_MS || '90000', 10);
const MAX_CONCURRENCY     = 5;
const MAX_NAGIOS_RETRIES  = 3;

// ─── Self-healing: crash-exit on unhandled errors so PM2/Docker restarts ─────
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] Uncaught exception — restarting via PM2/Docker:`, err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] Unhandled promise rejection — restarting via PM2/Docker:`, reason);
  process.exit(1);
});

console.log(`[Nagios Bridge] Starting (self-healing edition)...`);
console.log(`[Nagios Bridge] Nagios   : ${NAGIOS_URL}`);
console.log(`[Nagios Bridge] Dashboard: ${DASHBOARD_API_URL}`);
console.log(`[Nagios Bridge] Interval : ${POLL_INTERVAL_MS}ms`);
console.log(`[Nagios Bridge] Watchdog : ${WATCHDOG_TIMEOUT_MS}ms`);

// ─── Direct MongoDB fallback ──────────────────────────────────────────────────
let mongooseInstance = null;
let ServerMetricModel = null;

async function saveToMongoDirectly(payload) {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) return;

  try {
    let mongoose;
    try { mongoose = require(path.join(__dirname, 'backend', 'node_modules', 'mongoose')); }
    catch { mongoose = require('mongoose'); }

    if (!mongooseInstance) {
      mongooseInstance = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('[Mongo Fallback] Connected directly to MongoDB.');

      const schema = new mongoose.Schema({
        serverId:   { type: String, required: true, index: true },
        serverName: { type: String, required: true },
        status:     { type: String, default: 'up' },
        cpuUsage:   { type: Number, required: true },
        ramUsage: {
          totalBytes: { type: Number },
          usedBytes:  { type: Number },
          usagePercent: { type: Number, required: true }
        },
        diskUsage: {
          totalBytes: Number, usedBytes: Number, usagePercent: Number
        },
        loadAverage: {
          oneMin: { type: Number, required: true },
          fiveMin: { type: Number, required: true },
          fifteenMin: { type: Number, required: true }
        },
        cpuCores:       { type: Number },
        timestamp:      { type: Date, default: Date.now, index: true },
        nagiosLastSeen: { type: Date },
        nagiosStatus:   { type: String, default: 'UP' },
        services:       [{ name: String, status: String, output: String }]
      });
      schema.index({ serverId: 1, timestamp: -1 });
      ServerMetricModel = mongoose.models.ServerMetric || mongoose.model('ServerMetric', schema);
    }

    await new ServerMetricModel(payload).save();
    console.log(`[Mongo Fallback] Saved metrics for ${payload.serverName}`);
  } catch (err) {
    console.error(`[Mongo Fallback] Failed:`, err.message);
  }
}

// ─── Nagios HTTP helpers ──────────────────────────────────────────────────────
const getAuthHeader = () => `Basic ${Buffer.from(`${NAGIOS_USER}:${NAGIOS_PASS}`).toString('base64')}`;

/**
 * Fetch from Nagios with candidate URL fallback and exponential backoff retry.
 * Rotates across candidate base URLs (env, localhost, public IP) to withstand loopback routing issues.
 */
async function fetchWithRetry(queryPath, retries = MAX_NAGIOS_RETRIES) {
  const candidateBaseUrls = [
    process.env.NAGIOS_URL,
    'http://127.0.0.1/nagios',
    'http://localhost/nagios',
    'http://217.145.69.228/nagios'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const baseUrl = candidateBaseUrls[attempt % candidateBaseUrls.length];
    const fullUrl = `${baseUrl}/${queryPath.replace(/^\//, '')}`;
    try {
      const res = await fetch(fullUrl, {
        headers: { Authorization: getAuthHeader() },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result?.type_code !== 0) throw new Error(`Nagios error: ${data.result?.message}`);
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

async function fetchServiceList() {
  try {
    const data = await fetchWithRetry('cgi-bin/statusjson.cgi?query=servicelist&details=true&formatoptions=enumerate');
    return data.data.servicelist || {};
  } catch (err) {
    console.error(`[Nagios] Failed to fetch service list after retries:`, err.message);
    return null; // null signals a hard failure — don't run cleanup
  }
}

async function fetchHostList() {
  try {
    const data = await fetchWithRetry('cgi-bin/statusjson.cgi?query=hostlist&formatoptions=enumerate');
    return data.data.hostlist || {};
  } catch (err) {
    console.error(`[Nagios] Failed to fetch host list after retries:`, err.message);
    return null;
  }
}

// ─── Metric parsers — extract real values from plugin output ─────────────────

function parseCpuPercent(output) {
  let m = output.match(/cpu\s*(?:usage)?:?\s*([\d.]+)\s*%/i);
  if (m) return Math.min(100, parseFloat(m[1]));

  // Fast-path: "CPU load: X.XX, Total CPU cores: N" (Nagios custom check format)
  const nagiosLoadM = output.match(/CPU load:\s*([\d.]+)[^\n]*Total CPU cores:\s*(\d+)/i);
  if (nagiosLoadM) {
    const load  = parseFloat(nagiosLoadM[1]);
    const cores = parseInt(nagiosLoadM[2]);
    if (cores > 0) return Math.min(100, parseFloat(((load / cores) * 100).toFixed(1)));
  }

  m = output.match(/CPU load(?:\s+is)?\s+at\s+([\d.]+)/i);
  if (m) {
    // Try to find cores in same string
    const coresM = parseCpuCores(output);
    if (coresM && coresM > 0) {
      return Math.min(100, parseFloat(((parseFloat(m[1]) / coresM) * 100).toFixed(1)));
    }
    return Math.min(100, parseFloat(m[1]));
  }

  const loadM = output.match(/load average:\s*([\d.]+)/i);
  if (loadM) {
    const load  = parseFloat(loadM[1]);
    const cores = parseCpuCores(output);
    if (cores && cores > 0) {
      return Math.min(100, parseFloat(((load / cores) * 100).toFixed(1)));
    }
    return Math.min(100, parseFloat((load * 20).toFixed(1)));
  }

  return null;
}

function parseLoadAverage(output) {
  const m = output.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/i);
  if (m) return { oneMin: parseFloat(m[1]), fiveMin: parseFloat(m[2]), fifteenMin: parseFloat(m[3]) };
  return null;
}

function parseCpuCores(output) {
  // Highest priority: "Total CPU cores: N" (Nagios custom plugin format)
  let m = output.match(/Total CPU cores:\s*(\d+)/i);
  if (m) return parseInt(m[1]);

  // "N cpu", "N core", "N processor", "N logical" (number before keyword)
  m = output.match(/(\d+)\s*(?:cpu|core|processor|logical)/i);
  if (m) return parseInt(m[1]);

  // "cpus: N", "cores: N", "processors: N", "logical: N" (number after keyword)
  m = output.match(/(?:cpu|core|processor|logical)s?:\s*(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function parseMemoryDetailed(pluginOutput, longPluginOutput) {
  // Combine all available text — some plugins put the header in plugin_output
  // and the actual Mem: data row in long_plugin_output.
  // Normalize: join with real newline (long_plugin_output may already contain \n)
  const combined = [pluginOutput || '', longPluginOutput || ''].join('\n');
  const lines = combined.split(/\n|\\n/);  // handle literal \n in some API formats

  // Strategy 1: find "Mem:   total  used  ..." style row from `free -m` output
  const memLine = lines.find(l => l.trim().startsWith('Mem:'));
  if (memLine) {
    const parts = memLine.trim().split(/\s+/);
    // free -m: Mem: <total> <used> <free> <shared> <buff/cache> <available>
    if (parts.length >= 3) {
      const totalMB = parseFloat(parts[1]);
      const usedMB  = parseFloat(parts[2]);
      if (totalMB > 0 && !isNaN(usedMB) && usedMB <= totalMB) {
        return {
          totalBytes:   Math.round(totalMB * 1024 * 1024),
          usedBytes:    Math.round(usedMB  * 1024 * 1024),
          usagePercent: parseFloat(((usedMB / totalMB) * 100).toFixed(1))
        };
      }
    }
  }

  // Strategy 2: "Total: 16384 MB  Used: 8192 MB" style
  const fullText = combined;
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
  // Sanity: disk % should be 0-100
  if (pct < 0 || pct > 100) return null;

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

  // Always return at minimum the %, even when byte sizes are unknown
  if (!totalBytes) return { usagePercent: pct, totalBytes: null, usedBytes: null };
  return {
    totalBytes,
    usedBytes:    Math.round((pct / 100) * totalBytes),
    usagePercent: pct
  };
}

/**
 * Parse uptime from Nagios Uptime service output.
 * Handles: "15:20:31 up 166 days, 15:44" or "up 2:30" or "up 1 day, 2:30"
 * Returns total seconds, or null if unparseable.
 */
function parseUptimeSeconds(output) {
  // Match "up N days, H:MM" or "up N day, H:MM"
  let m = output.match(/up\s+(\d+)\s+days?,\s*(\d+):(\d+)/i);
  if (m) {
    return parseInt(m[1]) * 86400 + parseInt(m[2]) * 3600 + parseInt(m[3]) * 60;
  }
  // Match "up N days, NNmin"
  m = output.match(/up\s+(\d+)\s+days?,\s*(\d+)\s*min/i);
  if (m) {
    return parseInt(m[1]) * 86400 + parseInt(m[2]) * 60;
  }
  // Match "up H:MM" (no days)
  m = output.match(/up\s+(\d+):(\d+)/i);
  if (m) {
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60;
  }
  // Match "up N min"
  m = output.match(/up\s+(\d+)\s*min/i);
  if (m) {
    return parseInt(m[1]) * 60;
  }
  return null;
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function runNext() {
    if (i >= tasks.length) return;
    const idx = i++;
    results[idx] = await tasks[idx]();
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, runNext));
  return results;
}

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

/**
 * Decode Nagios numeric host status to string.
 * Nagios statusjson: 2=UP, 4=DOWN, 8=UNREACHABLE, 1=PENDING
 */
function decodeNagiosHostStatus(rawStatus) {
  if (typeof rawStatus === 'number') {
    if (rawStatus === 2) return 'UP';
    if (rawStatus === 4) return 'DOWN';
    if (rawStatus === 8) return 'UNREACHABLE';
    if (rawStatus === 1) return 'PENDING';
    return 'UNKNOWN';
  }
  const s = String(rawStatus).toUpperCase();
  return ['UP', 'DOWN', 'UNREACHABLE', 'PENDING'].includes(s) ? s : 'UP';
}

// ─── Orphan cleanup ───────────────────────────────────────────────────────────
async function reportOrphans(activeHostIds) {
  try {
    const res = await fetch(`${DASHBOARD_API_URL}/cleanup-orphans`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        activeHostIds,
        maxAgeMs: POLL_INTERVAL_MS * 3, // remove after 3 missed polls
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const result = await res.json();
      if (result.removed > 0) {
        console.log(`[Cleanup] Removed ${result.removed} orphan server(s): ${(result.orphanIds || []).join(', ')}`);
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] Orphan cleanup failed (non-fatal):`, err.message);
  }
}

// ─── Main poll function ───────────────────────────────────────────────────────
async function parseAndSendMetrics() {
  console.log(`\n[Nagios Bridge] --- Polling ---`);
  const pollStart = Date.now();

  const [services, hostStates] = await Promise.all([
    fetchServiceList(),
    fetchHostList()
  ]);

  // If BOTH calls returned null, Nagios is unreachable — skip this cycle entirely.
  if (services === null && hostStates === null) {
    console.error(`[Nagios Bridge] Nagios unreachable after retries — skipping poll cycle.`);
    return;
  }

  const safeServices   = services   || {};
  const safeHostStates = hostStates || {};

  const hosts = Array.from(new Set([...Object.keys(safeServices), ...Object.keys(safeHostStates)]));

  if (hosts.length === 0) {
    console.log(`[Nagios Bridge] No hosts found or Nagios returned empty data.`);
    return;
  }

  console.log(`[Nagios Bridge] Found ${hosts.length} hosts.`);
  const nagiosNowISO    = new Date().toISOString();
  const activeHostIds   = [];

  const tasks = hosts.map(hostName => async () => {
    const sanitizedId   = hostName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const hostServices  = safeServices[hostName] || {};
    const hostRawState  = safeHostStates[hostName];
    const nagiosStatus  = hostRawState !== undefined
      ? decodeNagiosHostStatus(typeof hostRawState === 'object' ? hostRawState.status : hostRawState)
      : 'UP';

    // Map Nagios status to dashboard status
    const dashboardStatus = nagiosStatus === 'UP' ? 'up'
      : nagiosStatus === 'DOWN'        ? 'down'
      : nagiosStatus === 'UNREACHABLE' ? 'unreachable'
      : 'up';

    activeHostIds.push(sanitizedId);

    // Collect all service statuses
    const servicesList = Object.entries(hostServices)
      .filter(([, sDetails]) => sDetails != null)
      .map(([serviceDesc, sDetails]) => ({
        name:   serviceDesc,
        status: sDetails.status || 'unknown',
        output: sDetails.plugin_output || ''
      }));

    // Prepend host status as a virtual service
    servicesList.unshift({
      name:   'Host Status',
      status: nagiosStatus === 'UP' ? 'OK' : 'CRITICAL',
      output: `Nagios host check: ${nagiosStatus}`
    });

    // ── CPU & Load Average ──────────────────────────────────────────────────
    let parsedCpuPct  = null;
    let parsedLoad    = null;
    let parsedCores   = null;

    const cpuSvc = findServiceByKeywords(hostServices, ['cpu', 'processor', 'util'], ['usage', 'load average']);
    if (cpuSvc?.plugin_output) {
      parsedCores  = parsedCores || parseCpuCores(cpuSvc.plugin_output);
      parsedLoad   = parsedLoad  || parseLoadAverage(cpuSvc.plugin_output);
      parsedCpuPct = parseCpuPercent(cpuSvc.plugin_output);
    }

    const loadSvc = findServiceByKeywords(hostServices, ['load average', 'load']) || findServiceByKeywords(hostServices, ['uptime']);
    if (loadSvc?.plugin_output) {
      parsedCores = parsedCores || parseCpuCores(loadSvc.plugin_output);
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

    const uptimeSvc = findServiceByKeywords(hostServices, ['uptime']);
    // Always parse uptime string regardless of whether load was already found
    let parsedUptimeSeconds = null;
    if (uptimeSvc?.plugin_output) {
      parsedUptimeSeconds = parseUptimeSeconds(uptimeSvc.plugin_output);
      // Also try load average and cores from uptime output if not found yet
      parsedCores = parsedCores || parseCpuCores(uptimeSvc.plugin_output);
      if (parsedLoad === null) {
        const load  = parseLoadAverage(uptimeSvc.plugin_output);
        if (load) {
          parsedLoad = load;
          if (parsedCpuPct === null && parsedCores) {
            parsedCpuPct = Math.min(100, parseFloat(((load.oneMin / parsedCores) * 100).toFixed(1)));
          }
        }
      }
    }
    // Also try Load Average service output for uptime string
    if (parsedUptimeSeconds === null && loadSvc?.plugin_output) {
      parsedUptimeSeconds = parseUptimeSeconds(loadSvc.plugin_output);
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
        parsedRam = { usagePercent: pct };
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
          parsedDisk = { usagePercent: d.usagePercent };
        }
      }
    }

    // ── Build payload (self-healing fallbacks) ─────────────────────────────
    const cpuUsageVal = isNumeric(parsedCpuPct) ? parseFloat(parsedCpuPct.toFixed(1)) : 0;

    // Use null (not undefined) for missing byte values — null survives JSON.stringify
    // and stores explicitly in MongoDB, while undefined gets stripped and triggers schema defaults
    let ramUsageVal = { totalBytes: null, usedBytes: null, usagePercent: 0 };
    if (parsedRam) {
      ramUsageVal = {
        totalBytes:   isNumeric(parsedRam.totalBytes)   ? parsedRam.totalBytes : null,
        usedBytes:    isNumeric(parsedRam.usedBytes)    ? parsedRam.usedBytes  : null,
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

    // cpuCores: send null explicitly when unknown so Mongoose stores null (not default 1)
    const cpuCoresVal = (isNumeric(parsedCores) && parsedCores > 0) ? parsedCores : null;
    if (cpuCoresVal === null) {
      console.warn(`[WARN] ${hostName}: No core count found in plugin output — storing null`);
    }

    const payload = {
      serverId:       sanitizedId,
      serverName:     hostName,
      status:         dashboardStatus,
      cpuUsage:       cpuUsageVal,
      ramUsage:       ramUsageVal,
      loadAverage:    loadAverageVal,
      cpuCores:       cpuCoresVal,
      uptimeSeconds:  isNumeric(parsedUptimeSeconds) ? parsedUptimeSeconds : null,
      timestamp:      nagiosNowISO,
      // ── Nagios ground-truth (critical for stale-override in frontend) ──
      nagiosLastSeen: nagiosNowISO,
      nagiosStatus,
      services:       servicesList
    };

    // Always include diskUsage if we have at least the percentage
    // Bug fix: old code only set diskUsage if totalBytes existed — this hid disk bars for
    // servers where Nagios only reports % (e.g. "73%", "91%")
    if (parsedDisk && isNumeric(parsedDisk.usagePercent)) {
      payload.diskUsage = {
        totalBytes:   isNumeric(parsedDisk.totalBytes) ? parsedDisk.totalBytes : null,
        usedBytes:    isNumeric(parsedDisk.usedBytes)  ? parsedDisk.usedBytes  : null,
        usagePercent: parseFloat(parsedDisk.usagePercent.toFixed(1))
      };
    }

    // ── Push to backend API ─────────────────────────────────────────────────
    try {
      const res = await fetch(DASHBOARD_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const ramStr    = `${ramUsageVal.usagePercent}%` + (ramUsageVal.totalBytes ? ` (${(ramUsageVal.totalBytes / 1073741824).toFixed(1)}GB)` : '');
        const diskStr   = payload.diskUsage ? ` Disk: ${payload.diskUsage.usagePercent}%` : '';
        const coresStr  = cpuCoresVal !== null ? ` [${cpuCoresVal}c]` : ' [?c]';
        const uptimeStr = payload.uptimeSeconds !== null ? ` Up: ${Math.floor(payload.uptimeSeconds / 86400)}d` : '';
        console.log(`[OK] ${hostName} [${nagiosStatus}]${coresStr}${uptimeStr} — CPU: ${payload.cpuUsage}% Load: ${payload.loadAverage.oneMin} RAM: ${ramStr}${diskStr}`);
      } else {
        const err = await res.text();
        console.error(`[WARN] ${hostName} HTTP ${res.status}: ${err}`);
        await saveToMongoDirectly(payload);
      }
    } catch (err) {
      console.warn(`[WARN] ${hostName} network error: ${err.message}`);
      await saveToMongoDirectly(payload);
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENCY);

  // ── Orphan cleanup: tell backend which hosts are alive in Nagios ───────────
  if (activeHostIds.length > 0) {
    await reportOrphans(activeHostIds);
  }

  const elapsed = Date.now() - pollStart;
  console.log(`[Nagios Bridge] --- Done (${elapsed}ms for ${hosts.length} hosts) ---`);
}

// ─── Watchdog-wrapped poll loop ───────────────────────────────────────────────
// If a poll cycle hangs longer than WATCHDOG_TIMEOUT_MS, force-exit so PM2 restarts.
let pollRunning = false;
let watchdogTimer = null;

async function safePoll() {
  if (pollRunning) {
    console.warn(`[Nagios Bridge] Previous poll still running — skipping this cycle.`);
    return;
  }
  pollRunning = true;

  // Set watchdog
  watchdogTimer = setTimeout(() => {
    console.error(`[WATCHDOG] Poll exceeded ${WATCHDOG_TIMEOUT_MS}ms — forcing restart.`);
    process.exit(1);
  }, WATCHDOG_TIMEOUT_MS);

  try {
    await parseAndSendMetrics();
  } catch (err) {
    console.error(`[Nagios Bridge] Poll error:`, err.message);
  } finally {
    clearTimeout(watchdogTimer);
    pollRunning = false;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
safePoll();
setInterval(safePoll, POLL_INTERVAL_MS);
