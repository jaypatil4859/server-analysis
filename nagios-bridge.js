// Nagios Bridge — Server Analysis Dashboard Integration
// Queries Nagios statusjson.cgi and pushes real-time metrics to the dashboard backend.
// All server specs (RAM, disk, CPU cores) are extracted dynamically from Nagios plugin outputs.
//
// Usage:  node nagios-bridge.js
// Env vars:
//   NAGIOS_URL          Nagios base URL          (default: http://217.145.69.228/nagios)
//   NAGIOS_USER         Nagios admin user         (default: nagiosadmin)
//   NAGIOS_PASS         Nagios admin password
//   METRICS_API_URL     Dashboard backend URL     (default: http://localhost:3971/api/metrics)
//   MONGODB_URI         Direct Mongo fallback URI
//   POLL_INTERVAL_MS    How often to poll (ms)    (default: 30000)

const path = require('path');
try {
  let dotenv;
  try { dotenv = require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')); }
  catch { dotenv = require('dotenv'); }
  dotenv.config({ path: path.join(__dirname, '.env') });
  dotenv.config({ path: path.join(__dirname, 'backend', '.env') });
} catch { /* dotenv optional */ }

const NAGIOS_URL        = process.env.NAGIOS_URL        || 'http://217.145.69.228/nagios';
const NAGIOS_USER       = process.env.NAGIOS_USER       || 'nagiosadmin';
const NAGIOS_PASS       = process.env.NAGIOS_PASS       || '4z1lO3lXxNa$';
const DASHBOARD_API_URL = process.env.METRICS_API_URL   || 'http://localhost:3971/api/metrics';
const POLL_INTERVAL_MS  = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const MAX_CONCURRENCY   = 5; // max parallel host pushes

console.log(`[Nagios Bridge] Starting...`);
console.log(`[Nagios Bridge] Nagios   : ${NAGIOS_URL}`);
console.log(`[Nagios Bridge] Dashboard: ${DASHBOARD_API_URL}`);
console.log(`[Nagios Bridge] Interval : ${POLL_INTERVAL_MS}ms`);

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
        cpuCores:  { type: Number },
        timestamp: { type: Date, default: Date.now, index: true },
        services:  [{ name: String, status: String, output: String }]
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

async function fetchServiceList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=servicelist&details=true&formatoptions=enumerate`;
    const res  = await fetch(url, { headers: { Authorization: getAuthHeader() }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result?.type_code !== 0) throw new Error(`Nagios error: ${data.result?.message}`);
    return data.data.servicelist || {};
  } catch (err) {
    console.error(`[Nagios] Failed to fetch service list:`, err.message);
    return {};
  }
}

// ─── Metric parsers — extract real values from plugin output ─────────────────

/**
 * Parse CPU usage percentage directly from Nagios plugin output.
 * Returns a percentage 0-100.
 */
function parseCpuPercent(output) {
  // Try "CPU Usage: 45.2%" or "cpu: 45.2%"
  let m = output.match(/cpu\s*(?:usage)?:?\s*([\d.]+)\s*%/i);
  if (m) return Math.min(100, parseFloat(m[1]));

  // Try "load average: 1.5, 1.2, 0.9" with optional core count "4 CPUs"
  const loadM = output.match(/load average:\s*([\d.]+)/i);
  const coreM = output.match(/(\d+)\s*cpu/i) || output.match(/(\d+)\s*core/i) || output.match(/(\d+)\s*processor/i);
  if (loadM) {
    const load  = parseFloat(loadM[1]);
    const cores = coreM ? parseInt(coreM[1]) : null;
    if (cores && cores > 0) {
      return Math.min(100, parseFloat(((load / cores) * 100).toFixed(1)));
    }
    // Without core count, use load directly as utilisation proxy (capped at 100)
    return Math.min(100, parseFloat((load * 20).toFixed(1))); // conservative: assume 5-core equivalent
  }

  // Try "CPU load is at 45%"
  m = output.match(/CPU load(?:\s+is)?\s+at\s+([\d.]+)/i);
  if (m) return Math.min(100, parseFloat(m[1]));

  return null;
}

/**
 * Parse load average triple from plugin output.
 */
function parseLoadAverage(output) {
  const m = output.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/i);
  if (m) return { oneMin: parseFloat(m[1]), fiveMin: parseFloat(m[2]), fifteenMin: parseFloat(m[3]) };
  return null;
}

/**
 * Parse CPU core count from any plugin output line.
 */
function parseCpuCores(output) {
  const m = output.match(/(\d+)\s*(?:cpu|core|processor|logical)/i);
  return m ? parseInt(m[1]) : null;
}

/**
 * Parse RAM from "Mem:" style free/vmstat output (returned by memory check plugin).
 * Returns { totalBytes, usedBytes, usagePercent } or null.
 */
function parseMemoryDetailed(pluginOutput, longPluginOutput) {
  const fullText = `${pluginOutput}\n${longPluginOutput || ''}`.trim();

  // Prefer "Mem: total used" table row
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

  // Try "Total: 16384 MB  Used: 8192 MB" style
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

/**
 * Parse RAM usage percentage from simple output like "Memory: 72.5% used".
 */
function parseMemoryPercent(output) {
  const m = output.match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Parse total RAM bytes from any plugin output.
 * Looks for patterns like "16384 MB", "16 GB", "16.0GB".
 */
function parseTotalRamBytes(output) {
  // "Total: 16384 MB" or "16384MB total"
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

/**
 * Parse disk usage from plugin output.
 * Returns { totalBytes, usedBytes, usagePercent } or null.
 */
function parseDiskUsage(output) {
  // Percent
  const pctM = output.match(/([\d.]+)\s*%/);
  if (!pctM) return null;
  const pct = parseFloat(pctM[1]);

  // Total size
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

  if (!totalBytes) return { usagePercent: pct }; // partial result — caller handles
  return {
    totalBytes,
    usedBytes:    Math.round((pct / 100) * totalBytes),
    usagePercent: pct
  };
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

// ─── Main poll function ───────────────────────────────────────────────────────
async function parseAndSendMetrics() {
  console.log(`\n[Nagios Bridge] --- Polling ---`);
  const services = await fetchServiceList();
  const hosts    = Object.keys(services);

  if (hosts.length === 0) {
    console.log(`[Nagios Bridge] No hosts found or Nagios returned empty data.`);
    return;
  }

  console.log(`[Nagios Bridge] Found ${hosts.length} hosts.`);

  const tasks = hosts.map(hostName => async () => {
    const sanitizedId  = hostName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const hostServices = services[hostName] || {};

    // Collect all service statuses (passed through to frontend as-is from Nagios)
    const servicesList = Object.entries(hostServices)
      .filter(([, sDetails]) => sDetails != null)
      .map(([serviceDesc, sDetails]) => ({
        name:   serviceDesc,
        status: sDetails.status || 'unknown',
        output: sDetails.plugin_output || ''
      }));

    // ── CPU & Load Average ──────────────────────────────────────────────────
    let parsedCpuPct  = null;
    let parsedLoad    = null;
    let parsedCores   = null;

    // Check 'CPU check' service
    const cpuSvc = hostServices['CPU check'] || hostServices['CPU Check'] || hostServices['cpu check'];
    if (cpuSvc?.plugin_output) {
      parsedCores  = parsedCores || parseCpuCores(cpuSvc.plugin_output);
      parsedLoad   = parsedLoad  || parseLoadAverage(cpuSvc.plugin_output);
      parsedCpuPct = parseCpuPercent(cpuSvc.plugin_output);
    }

    // Check 'Load Average' service
    const loadSvc = hostServices['Load Average'] || hostServices['load average'] || hostServices['Load'];
    if (loadSvc?.plugin_output) {
      parsedCores = parsedCores || parseCpuCores(loadSvc.plugin_output);
      const load  = parseLoadAverage(loadSvc.plugin_output);
      if (load) {
        parsedLoad = load;
        if (parsedCpuPct === null) {
          // Derive CPU% from load + cores (if we have cores)
          if (parsedCores) {
            parsedCpuPct = Math.min(100, parseFloat(((load.oneMin / parsedCores) * 100).toFixed(1)));
          } else {
            // No core info — use load as a heuristic (capped)
            parsedCpuPct = Math.min(100, parseFloat((load.oneMin * 20).toFixed(1)));
          }
        }
      }
    }

    // Check 'Uptime' service as a load fallback
    const uptimeSvc = hostServices['Uptime'] || hostServices['uptime'];
    if (parsedLoad === null && uptimeSvc?.plugin_output) {
      parsedCores = parsedCores || parseCpuCores(uptimeSvc.plugin_output);
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

    const memSvc = hostServices['memory check'] || hostServices['Memory Check'] ||
                   hostServices['Memory']        || hostServices['memory'];
    if (memSvc) {
      parsedRam = parseMemoryDetailed(memSvc.plugin_output || '', memSvc.long_plugin_output || '');
    }

    const memUsageSvc = hostServices['Memory Usage'] || hostServices['memory usage'];
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

    const diskSvc = hostServices['Disk Space']  || hostServices['Disk Usage'] ||
                    hostServices['disk space']   || hostServices['disk usage']  ||
                    hostServices['Disk']         || hostServices['disk'];
    if (diskSvc?.plugin_output) {
      const d = parseDiskUsage(diskSvc.plugin_output);
      if (d?.totalBytes) {
        parsedDisk = d;
      } else if (d?.usagePercent !== undefined) {
        // Try long output for total size
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

    // ── Build payload (only real data — skip if critical fields missing) ────
    if (parsedCpuPct === null && parsedLoad === null) {
      console.warn(`[${hostName}] No CPU/Load data found — skipping.`);
      return;
    }
    if (!parsedRam) {
      console.warn(`[${hostName}] No RAM data found — skipping.`);
      return;
    }

    const payload = {
      serverId:    sanitizedId,
      serverName:  hostName,
      cpuUsage:    parseFloat((parsedCpuPct ?? 0).toFixed(1)),
      ramUsage:    parsedRam,
      loadAverage: {
        oneMin:     parseFloat((parsedLoad?.oneMin     ?? 0).toFixed(2)),
        fiveMin:    parseFloat((parsedLoad?.fiveMin    ?? 0).toFixed(2)),
        fifteenMin: parseFloat((parsedLoad?.fifteenMin ?? 0).toFixed(2))
      },
      cpuCores:  parsedCores || undefined,
      timestamp: new Date().toISOString(),
      services:  servicesList
    };

    if (parsedDisk) payload.diskUsage = parsedDisk;

    // ── Push to backend API ─────────────────────────────────────────────────
    try {
      const res = await fetch(DASHBOARD_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const ramStr  = `${parsedRam.usagePercent}%` + (parsedRam.totalBytes ? ` (${(parsedRam.totalBytes / 1073741824).toFixed(1)}GB total)` : '');
        const diskStr = parsedDisk ? ` Disk: ${parsedDisk.usagePercent}%` : '';
        console.log(`[OK] ${hostName} — CPU: ${payload.cpuUsage}% Load: ${payload.loadAverage.oneMin} RAM: ${ramStr}${diskStr}`);
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
  console.log(`[Nagios Bridge] --- Done ---`);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
parseAndSendMetrics();
setInterval(parseAndSendMetrics, POLL_INTERVAL_MS);
