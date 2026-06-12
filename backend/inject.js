import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ServerMetric from './models/ServerMetric.js';
import LaptopMetric from './models/LaptopMetric.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';
const SERVER_API_URL = process.env.METRICS_API_URL || 'http://localhost:5000/api/metrics';
const LAPTOP_API_URL = 'http://localhost:5000/api/laptop';
const INTERVAL_MS = parseInt(process.env.COLLECT_INTERVAL_MS || '3000', 10);

const SERVERS = [
  { id: 'web-server-01', name: 'Web Server 01', baseCpu: 20, ramTotalGB: 16 },
  { id: 'db-server-01', name: 'Database Server 01', baseCpu: 35, ramTotalGB: 32 },
  { id: 'cache-server-01', name: 'Redis Cache 01', baseCpu: 10, ramTotalGB: 8 }
];

const serverStates = SERVERS.map(s => ({
  ...s,
  currentCpu: s.baseCpu,
  currentRamPercent: s.id === 'db-server-01' ? 70 : 40,
  currentLoad: s.baseCpu / 50
}));

// Laptop dynamic state simulation
const laptopState = {
  id: 'sahil-laptop',
  name: 'ZenBook Pro UX',
  currentCpu: 18,
  currentRamPercent: 48,
  batteryPercent: 74,
  isCharging: false,
  batteryStatus: 'Discharging',
  cpuTemp: 44,
  screenTimeToday: 240,
  activityIndex: 35
};

const useDirectMongo = process.argv.includes('--direct');

async function init() {
  if (useDirectMongo) {
    console.log(`[Simulator] Starting in DIRECT MongoDB mode. Connecting to ${MONGODB_URI}...`);
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('[Simulator] Connected to MongoDB.');
    } catch (err) {
      console.error('[Simulator] MongoDB connection failed:', err.message);
      console.log('[Simulator] Falling back to REST API mode...');
      process.exit(1);
    }
  } else {
    console.log(`[Simulator] Starting in REST API mode. Sending metrics to ${SERVER_API_URL} and ${LAPTOP_API_URL}...`);
  }

  console.log(`[Simulator] Ingesting metrics every ${INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);

  // Start loop
  const intervalId = setInterval(injectTick, INTERVAL_MS);
  injectTick(); // first immediate run

  // Handle termination
  process.on('SIGINT', async () => {
    clearInterval(intervalId);
    console.log('\n[Simulator] Stopping injector...');
    if (useDirectMongo) {
      await mongoose.connection.close();
      console.log('[Simulator] MongoDB connection closed.');
    }
    console.log('[Simulator] Exited.');
    process.exit(0);
  });
}

async function injectTick() {
  const timestamp = new Date();
  
  // --- 1. Inject Servers ---
  for (const state of serverStates) {
    const cpuJitter = (Math.random() * 10 - 5);
    const hour = timestamp.getHours();
    let hourModifier = 1.0;
    if (hour >= 14 && hour <= 20) {
      hourModifier = 1.5;
    } else if (hour >= 1 && hour <= 5) {
      hourModifier = 0.5;
    }

    state.currentCpu = Math.min(98, Math.max(3, state.currentCpu + cpuJitter));
    const targetCpu = state.baseCpu * hourModifier;
    state.currentCpu = state.currentCpu * 0.85 + targetCpu * 0.15;

    const ramTarget = (state.id === 'db-server-01' ? 68 : 38) + (state.currentCpu * 0.15);
    state.currentRamPercent = Math.min(95, Math.max(10, state.currentRamPercent * 0.95 + ramTarget * 0.05 + (Math.random() * 2 - 1)));
    const totalBytes = state.ramTotalGB * 1024 * 1024 * 1024;
    const usedBytes = Math.round((state.currentRamPercent / 100) * totalBytes);

    const loadTarget = state.currentCpu / 45;
    state.currentLoad = state.currentLoad * 0.9 + loadTarget * 0.1;
    const load1m = parseFloat(state.currentLoad.toFixed(2));
    const load5m = parseFloat((state.currentLoad * 0.95).toFixed(2));
    const load15m = parseFloat((state.currentLoad * 0.98).toFixed(2));

    const serverPayload = {
      serverId: state.id,
      serverName: state.name,
      cpuUsage: parseFloat(state.currentCpu.toFixed(1)),
      ramUsage: {
        totalBytes,
        usedBytes,
        usagePercent: parseFloat(state.currentRamPercent.toFixed(1))
      },
      loadAverage: {
        oneMin: load1m,
        fiveMin: load5m,
        fifteenMin: load15m
      },
      timestamp: timestamp.toISOString()
    };

    try {
      if (useDirectMongo) {
        const metric = new ServerMetric(serverPayload);
        await metric.save();
        logServerConsole(serverPayload, 'DB_DIRECT');
      } else {
        const res = await fetch(SERVER_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serverPayload)
        });
        if (res.ok) {
          logServerConsole(serverPayload, 'REST_API');
        } else {
          console.error(`[Simulator] Server API error: ${res.status} ${res.statusText}`);
        }
      }
    } catch (err) {
      console.error(`[Simulator] Error injecting server ${state.id}:`, err.message);
    }
  }

  // --- 2. Inject Laptop ---
  const cpuJitter = (Math.random() * 8 - 4);
  laptopState.currentCpu = Math.min(95, Math.max(2, laptopState.currentCpu + cpuJitter));
  laptopState.currentCpu = laptopState.currentCpu * 0.85 + 15 * 0.15; // gravitate to base 15%

  const ramTarget = 45 + (laptopState.currentCpu * 0.12);
  laptopState.currentRamPercent = Math.min(90, Math.max(10, laptopState.currentRamPercent * 0.95 + ramTarget * 0.05 + (Math.random() * 1.5 - 0.75)));
  
  const ramTotalBytes = 16 * 1024 * 1024 * 1024;
  const ramUsedBytes = Math.round((laptopState.currentRamPercent / 100) * ramTotalBytes);

  // Battery Drain/Charge cycle
  if (laptopState.isCharging) {
    laptopState.batteryPercent += 0.2; // Charge slowly
    if (laptopState.batteryPercent >= 100) {
      laptopState.batteryPercent = 100;
      laptopState.isCharging = false;
      laptopState.batteryStatus = 'Full';
    } else {
      laptopState.batteryStatus = 'Charging';
    }
  } else {
    laptopState.batteryPercent -= 0.1; // Drain slowly
    if (laptopState.batteryPercent <= 15) {
      laptopState.batteryPercent = 15;
      laptopState.isCharging = true;
      laptopState.batteryStatus = 'Charging';
    } else {
      laptopState.batteryStatus = 'Discharging';
    }
  }

  // Temperature logic
  const tempBase = laptopState.isCharging ? 47 : 39;
  const tempTarget = tempBase + (laptopState.currentCpu * 0.4);
  laptopState.cpuTemp = parseFloat((laptopState.cpuTemp * 0.9 + tempTarget * 0.1 + (Math.random() * 1 - 0.5)).toFixed(1));

  // Wifi strength
  const signal = Math.round(85 + Math.random() * 15 - 7.5);

  // Screen time & app usage
  laptopState.screenTimeToday += Math.round(INTERVAL_MS / 60000); // add active minutes
  laptopState.activityIndex = Math.round(Math.max(0, Math.min(100, laptopState.activityIndex * 0.8 + (Math.random() * 40) * 0.2)));

  const defaultApps = [
    { name: 'VS Code', durationPercent: 45 },
    { name: 'Chrome', durationPercent: 30 },
    { name: 'Terminal', durationPercent: 13 },
    { name: 'Slack', durationPercent: 7 },
    { name: 'Spotify', durationPercent: 5 }
  ];

  const laptopPayload = {
    laptopId: laptopState.id,
    laptopName: laptopState.name,
    cpuUsage: parseFloat(laptopState.currentCpu.toFixed(1)),
    ramUsage: {
      totalBytes: ramTotalBytes,
      usedBytes: ramUsedBytes,
      usagePercent: parseFloat(laptopState.currentRamPercent.toFixed(1))
    },
    battery: {
      percent: Math.round(laptopState.batteryPercent),
      status: laptopState.batteryStatus,
      isCharging: laptopState.isCharging
    },
    thermals: {
      cpuTemp: laptopState.cpuTemp
    },
    wifi: {
      ssid: timestamp.getHours() >= 9 && timestamp.getHours() < 17 ? 'Office-Enterprise' : 'Home-WiFi-5G',
      signalStrength: Math.max(10, Math.min(100, signal))
    },
    screenTimeToday: laptopState.screenTimeToday,
    appUsage: defaultApps,
    activityIndex: laptopState.activityIndex,
    timestamp: timestamp.toISOString()
  };

  try {
    if (useDirectMongo) {
      const metric = new LaptopMetric(laptopPayload);
      await metric.save();
      logLaptopConsole(laptopPayload, 'DB_DIRECT');
    } else {
      const res = await fetch(LAPTOP_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(laptopPayload)
      });
      if (res.ok) {
        logLaptopConsole(laptopPayload, 'REST_API');
      } else {
        console.error(`[Simulator] Laptop API error: ${res.status} ${res.statusText}`);
      }
    }
  } catch (err) {
    console.error(`[Simulator] Error injecting laptop ${laptopState.id}:`, err.message);
  }

  console.log('--------------------------------------------------');
}

function logServerConsole(payload, mode) {
  const time = new Date(payload.timestamp).toLocaleTimeString();
  const cpuStr = `${payload.cpuUsage}%`.padEnd(6);
  const ramStr = `${payload.ramUsage.usagePercent}%`.padEnd(6);
  const loadStr = `${payload.loadAverage.oneMin}`.padEnd(5);
  
  console.log(`[${time}] [${mode}] ${payload.serverName.padEnd(18)} -> CPU: ${cpuStr} | RAM: ${ramStr} | Load: ${loadStr}`);
}

function logLaptopConsole(payload, mode) {
  const time = new Date(payload.timestamp).toLocaleTimeString();
  const cpuStr = `${payload.cpuUsage}%`.padEnd(6);
  const ramStr = `${payload.ramUsage.usagePercent}%`.padEnd(6);
  const batStr = `${payload.battery.percent}% (${payload.battery.status})`.padEnd(22);
  const tempStr = `${payload.thermals.cpuTemp}°C`.padEnd(6);
  
  console.log(`[${time}] [${mode}] ${payload.laptopName.padEnd(18)} -> CPU: ${cpuStr} | RAM: ${ramStr} | Battery: ${batStr} | Temp: ${tempStr}`);
}

init();
