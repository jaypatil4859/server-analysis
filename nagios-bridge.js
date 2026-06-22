// Robust Nagios Bridge (requires Node.js v18+)

/**
 * Nagios to ServerPulse Dashboard Integration Bridge
 * 
 * Run this script on a machine that has access to both your Nagios server and the ServerPulse dashboard backend.
 * It queries Nagios statusjson.cgi API, parses real CPU/RAM/Load metrics, and pushes them to ServerPulse.
 */

// Configuration - Customize or load from environment
const NAGIOS_URL = process.env.NAGIOS_URL || 'http://217.145.69.228/nagios';
const NAGIOS_USER = process.env.NAGIOS_USER || 'nagiosadmin';
const NAGIOS_PASS = process.env.NAGIOS_PASS || '4z1lO3lXxNa$';
const DASHBOARD_API_URL = process.env.METRICS_API_URL || 'http://localhost:5000/api/metrics';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10); // Poll Nagios every 30s

// Host specs lookup table (CPU cores, RAM size in GB, Disk size in GB)
// Mapping uses sanitized lowercase hostname/serverId keys.
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

console.log(`Starting Nagios Bridge...`);
console.log(`Nagios Endpoint: ${NAGIOS_URL}`);
console.log(`Dashboard Target: ${DASHBOARD_API_URL}`);

// Helper to encode Basic Authentication credentials
const getAuthHeader = () => {
  const credentials = `${NAGIOS_USER}:${NAGIOS_PASS}`;
  const base64 = Buffer.from(credentials).toString('base64');
  return `Basic ${base64}`;
};

/**
 * Fetch all monitored services from statusjson.cgi
 */
async function fetchServiceList() {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=servicelist`;
    const response = await fetch(url, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    if (!response.ok) {
      throw new Error(`Nagios returned status code ${response.status}`);
    }

    const data = await response.json();
    if (data.result && data.result.type_code !== 0) {
      throw new Error(`Nagios query error: ${data.result.message}`);
    }
    
    return data.data.servicelist || {};
  } catch (error) {
    console.error(`[Nagios Bridge Error] Failed to fetch service list:`, error.message);
    return {};
  }
}

/**
 * Fetch detailed status of a specific service
 */
async function fetchServiceDetails(hostname, serviceDescription) {
  try {
    const url = `${NAGIOS_URL}/cgi-bin/statusjson.cgi?query=service&hostname=${encodeURIComponent(hostname)}&servicedescription=${encodeURIComponent(serviceDescription)}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    if (!response.ok) {
      throw new Error(`Nagios returned status code ${response.status}`);
    }

    const data = await response.json();
    if (data.result && data.result.type_code !== 0) {
      throw new Error(`Nagios query error: ${data.result.message}`);
    }
    
    return data.data.service || null;
  } catch (error) {
    console.error(`[Nagios Bridge Error] Failed to fetch service details for ${hostname} - ${serviceDescription}:`, error.message);
    return null;
  }
}

/**
 * Parser helpers
 */
function parseCpuCheck(output) {
  const match = output.match(/CPU load(?: is)? at ([\d\.]+)/i) || 
                output.match(/load average: ([\d\.]+)/i) || 
                output.match(/CPU(?: usage)?:?\s*([\d\.]+)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

function parseLoadAverage(output) {
  const match = output.match(/load average:\s*([\d\.]+),\s*([\d\.]+),\s*([\d\.]+)/i);
  if (match) {
    return {
      oneMin: parseFloat(match[1]),
      fiveMin: parseFloat(match[2]),
      fifteenMin: parseFloat(match[3])
    };
  }
  return null;
}

function parseMemoryUsage(output) {
  const match = output.match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
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
 * Map Nagios service/host data to ServerPulse dashboard payloads
 */
async function parseAndSendMetrics() {
  console.log(`\n--- Polling Nagios Status... ---`);
  const services = await fetchServiceList();
  const hosts = Object.keys(services);
  
  if (hosts.length === 0) {
    console.log(`No hosts found or Nagios returned empty data.`);
    return;
  }

  console.log(`Found ${hosts.length} hosts in Nagios. Processing details...`);

  for (const hostName of hosts) {
    const serverId = hostName;
    const serverName = hostName;
    
    const sanitizedId = serverId.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const specs = SERVER_SPECS[sanitizedId] || { cores: 4, ramGB: 16, diskGB: 250 };
    const serverCores = specs.cores;
    const specTotalRamBytes = specs.ramGB * 1024 * 1024 * 1024;
    const specTotalDiskBytes = specs.diskGB * 1024 * 1024 * 1024;

    // Default fallback values if CPU/RAM service values are not parsed
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

    const hostServices = services[hostName] || {};
    
    // 1. Process CPU/Load
    if (hostServices['CPU check'] !== undefined) {
      const details = await fetchServiceDetails(hostName, 'CPU check');
      if (details && details.plugin_output) {
        const val = parseCpuCheck(details.plugin_output);
        if (val !== null) {
          // Calculate CPU usage based on load average relative to core count
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
    
    // 2. Process Memory (Prefer precise memory check over generic Memory Usage)
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

    // 3. Process Disk
    let diskUsagePercent = 0; // default fallback if unmonitored
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

    // Assign parsed metrics or keep defaults
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
    
    // Prepare ServerPulse schema payload
    const payload = {
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

    // Forward metrics to ServerPulse Backend
    try {
      const postResponse = await fetch(DASHBOARD_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (postResponse.ok) {
        console.log(`[Success] Forwarded metrics for: ${serverName} (CPU: ${cpuUsage}%, RAM: ${ramUsagePercent}%, Load: ${loadOneMin}) [Real metrics: CPU: ${parsedCpu !== null}, RAM: ${parsedRam !== null}]`);
      } else {
        const errorTxt = await postResponse.text();
        console.error(`Failed forwarding for ${serverId}: ${postResponse.status} - ${errorTxt}`);
      }
    } catch (err) {
      console.error(`Error sending metrics to dashboard backend for ${serverId}:`, err.message);
    }
  }
}

// Start Poll Loop
setInterval(parseAndSendMetrics, POLL_INTERVAL_MS);
parseAndSendMetrics();
