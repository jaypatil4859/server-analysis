import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

const API_URL = process.env.METRICS_API_URL || 'http://localhost:5000/api/laptop';
const LAPTOP_ID = process.env.LAPTOP_ID || os.hostname() || 'linux-laptop';
const LAPTOP_NAME = process.env.LAPTOP_NAME || `${os.hostname()} (Linux)` || 'ZenBook Pro UX';
const INTERVAL_MS = parseInt(process.env.COLLECT_INTERVAL_MS || '5000', 10);

console.log(`Starting laptop collector for ${LAPTOP_NAME} (${LAPTOP_ID}). Sending telemetry to ${API_URL} every ${INTERVAL_MS / 1000}s`);

// Helper to find battery directory on Linux
function getBatteryPaths() {
  const baseDir = '/sys/class/power_supply';
  try {
    if (fs.existsSync(baseDir)) {
      const supplies = fs.readdirSync(baseDir);
      // Look for a supply starting with BAT or containing battery properties
      const batDir = supplies.find(name => name.startsWith('BAT') || name.toLowerCase().includes('battery'));
      if (batDir) {
        return {
          capacityPath: `${baseDir}/${batDir}/capacity`,
          statusPath: `${baseDir}/${batDir}/status`
        };
      }
    }
  } catch (err) {
    // Ignore and fallback to simulated battery
  }
  return null;
}

const batteryPaths = getBatteryPaths();
if (batteryPaths) {
  console.log(`[Collector] Found Linux system battery at: ${batteryPaths.capacityPath}`);
} else {
  console.log('[Collector] System battery directory not found. Telemetry will fallback to simulated battery metrics.');
}

// State for simulated battery in case of non-Linux/no battery
let simBatteryPercent = 85;
let simIsCharging = false;
let simScreenTime = 120;

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

// Read CPU temperature on Linux
function getCpuTemperature() {
  const paths = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/class/thermal/thermal_zone1/temp',
    '/sys/class/hwmon/hwmon0/temp1_input',
    '/sys/class/hwmon/hwmon1/temp1_input'
  ];
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) {
        const raw = fs.readFileSync(path, 'utf8').trim();
        const temp = parseFloat(raw);
        if (!isNaN(temp)) {
          // Linux temp is usually in milli-Celsius (e.g. 54000 = 54C)
          return temp > 1000 ? parseFloat((temp / 1000).toFixed(1)) : temp;
        }
      }
    } catch (err) {
      // Try next path
    }
  }
  return null;
}

// Read Wi-Fi SSID dynamically if possible
function getWifiSsid() {
  try {
    // Try iwgetid
    const ssid = execSync('iwgetid -r', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (ssid) return ssid;
  } catch (err) {
    // Try nmcli
    try {
      const nmcliOutput = execSync("nmcli -t -f active,ssid dev wifi | grep '^yes:' | cut -d: -f2", { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      if (nmcliOutput) return nmcliOutput;
    } catch (err2) {
      // Try proc/net/wireless check or other fallbacks
    }
  }
  return 'Home-WiFi-5G'; // Default mockup
}

// App usage percentage lookup (simulated active window distribution)
function getAppUsageDistribution() {
  return [
    { name: 'VS Code', durationPercent: 48 },
    { name: 'Chrome', durationPercent: 28 },
    { name: 'Terminal', durationPercent: 14 },
    { name: 'Slack', durationPercent: 6 },
    { name: 'Spotify', durationPercent: 4 }
  ];
}

async function collectAndSend() {
  try {
    const cpuUsage = await getCpuUsage();
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUsagePercent = parseFloat(((usedMem / totalMem) * 100).toFixed(2));

    // Get hardware Battery or mock
    let batteryPercent = simBatteryPercent;
    let batteryStatus = simIsCharging ? 'Charging' : 'Discharging';
    let isCharging = simIsCharging;

    if (batteryPaths && fs.existsSync(batteryPaths.capacityPath)) {
      try {
        const capRaw = fs.readFileSync(batteryPaths.capacityPath, 'utf8').trim();
        const statRaw = fs.readFileSync(batteryPaths.statusPath, 'utf8').trim();
        batteryPercent = parseInt(capRaw, 10);
        batteryStatus = statRaw;
        isCharging = statRaw.toLowerCase() === 'charging';
      } catch (err) {
        console.warn('[Collector] Error reading hardware battery files. Using mock calculations.');
      }
    } else {
      // Update simulated battery
      if (simIsCharging) {
        simBatteryPercent += 0.5;
        if (simBatteryPercent >= 100) {
          simBatteryPercent = 100;
          simIsCharging = false;
        }
      } else {
        simBatteryPercent -= 0.25;
        if (simBatteryPercent <= 15) {
          simBatteryPercent = 15;
          simIsCharging = true;
        }
      }
      batteryPercent = Math.round(simBatteryPercent);
      batteryStatus = simIsCharging ? 'Charging' : 'Discharging';
      isCharging = simIsCharging;
    }

    // Get temperature
    let cpuTemp = getCpuTemperature();
    if (cpuTemp === null) {
      // Simulate thermal behavior
      const base = isCharging ? 46 : 39;
      cpuTemp = parseFloat((base + (cpuUsage * 0.4) + (Math.random() * 2 - 1)).toFixed(1));
    }

    // WiFi SSID
    const wifiSsid = getWifiSsid();
    const wifiStrength = Math.round(82 + Math.random() * 18);

    // Screen Time Today
    simScreenTime += Math.round(INTERVAL_MS / 60000);
    const screenTimeToday = simScreenTime;

    // Activity Index (simulated keys/clicks based on CPU load activity)
    const activityIndex = Math.round(Math.max(0, Math.min(100, (cpuUsage * 1.2) + (Math.random() * 20 - 10))));

    const payload = {
      laptopId: LAPTOP_ID,
      laptopName: LAPTOP_NAME,
      cpuUsage: parseFloat(cpuUsage.toFixed(2)),
      ramUsage: {
        totalBytes: totalMem,
        usedBytes: usedMem,
        usagePercent: ramUsagePercent
      },
      battery: {
        percent: batteryPercent,
        status: batteryStatus,
        isCharging
      },
      thermals: {
        cpuTemp
      },
      wifi: {
        ssid: wifiSsid,
        signalStrength: wifiStrength
      },
      screenTimeToday,
      appUsage: getAppUsageDistribution(),
      activityIndex,
      timestamp: new Date().toISOString()
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] Failed to send laptop telemetry: ${response.status} - ${errorText}`);
    } else {
      console.log(`[${new Date().toISOString()}] Telemetry sent for ${LAPTOP_NAME} -> CPU: ${payload.cpuUsage}% | Battery: ${batteryPercent}% (${batteryStatus}) | Temp: ${cpuTemp}°C`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error collecting laptop telemetry:`, error.message);
  }
}

// Start collection loop
setInterval(collectAndSend, INTERVAL_MS);
collectAndSend();
