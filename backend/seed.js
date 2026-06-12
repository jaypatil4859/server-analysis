import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ServerMetric from './models/ServerMetric.js';
import LaptopMetric from './models/LaptopMetric.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

const SERVERS = [
  { id: 'web-server-01', name: 'Web Server 01', baseCpu: 20, ramTotalGB: 16 },
  { id: 'db-server-01', name: 'Database Server 01', baseCpu: 35, ramTotalGB: 32 },
  { id: 'cache-server-01', name: 'Redis Cache 01', baseCpu: 10, ramTotalGB: 8 }
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seeding...');

    // Clear existing collections
    await ServerMetric.deleteMany({});
    await LaptopMetric.deleteMany({});
    console.log('Cleared existing metrics.');

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const intervalMs = 30 * 60 * 1000; // 30-minute intervals
    
    const serverMetricsToInsert = [];
    const laptopMetricsToInsert = [];

    // App usage distribution
    const defaultApps = [
      { name: 'VS Code', durationPercent: 45 },
      { name: 'Chrome', durationPercent: 30 },
      { name: 'Terminal', durationPercent: 13 },
      { name: 'Slack', durationPercent: 7 },
      { name: 'Spotify', durationPercent: 5 }
    ];

    // Loop through the last 7 days
    for (let timeOffset = sevenDaysMs; timeOffset >= 0; timeOffset -= intervalMs) {
      const timestamp = new Date(now - timeOffset);
      const hour = timestamp.getHours();

      // --- 1. Seed Server Metrics ---
      for (const server of SERVERS) {
        let timeModifier = 1.0;
        if (hour >= 14 && hour <= 20) {
          timeModifier += 1.5 + Math.random() * 0.5;
        } else if (hour >= 1 && hour <= 5) {
          timeModifier -= 0.6;
        }

        let backupSpike = 0;
        if (server.id === 'db-server-01' && hour === 3) {
          backupSpike = 40;
        }

        const cpuUsage = Math.min(98, Math.max(2, server.baseCpu * timeModifier + backupSpike + (Math.random() * 10 - 5)));
        const ramPercent = Math.min(95, Math.max(10, (server.id === 'db-server-01' ? 70 : 40) + (cpuUsage * 0.2) + (Math.random() * 6 - 3)));
        const totalBytes = server.ramTotalGB * 1024 * 1024 * 1024;
        const usedBytes = Math.round((ramPercent / 100) * totalBytes);

        const load1m = parseFloat((cpuUsage / 50 + Math.random() * 0.5).toFixed(2));
        const load5m = parseFloat((load1m * 0.9 + Math.random() * 0.2).toFixed(2));
        const load15m = parseFloat((load5m * 0.95 + Math.random() * 0.1).toFixed(2));

        serverMetricsToInsert.push({
          serverId: server.id,
          serverName: server.name,
          cpuUsage: parseFloat(cpuUsage.toFixed(1)),
          ramUsage: {
            totalBytes,
            usedBytes,
            usagePercent: parseFloat(ramPercent.toFixed(1))
          },
          loadAverage: {
            oneMin: load1m,
            fiveMin: load5m,
            fifteenMin: load15m
          },
          timestamp
        });
      }

      // --- 2. Seed Laptop Metrics ---
      // Simulate battery levels (discharging during day, charging at specific hours)
      let batteryPercent = 100;
      let batteryStatus = 'Full';
      let isCharging = true;

      if (hour >= 8 && hour < 13) {
        const progress = (hour - 8 + (timestamp.getMinutes() / 60)) / 5;
        batteryPercent = Math.round(100 - progress * 85);
        batteryStatus = 'Discharging';
        isCharging = false;
      } else if (hour >= 13 && hour < 16) {
        const progress = (hour - 13 + (timestamp.getMinutes() / 60)) / 3;
        batteryPercent = Math.round(15 + progress * 85);
        batteryStatus = 'Charging';
        isCharging = true;
      } else if (hour >= 16 && hour < 20) {
        const progress = (hour - 16 + (timestamp.getMinutes() / 60)) / 4;
        batteryPercent = Math.round(100 - progress * 65);
        batteryStatus = 'Discharging';
        isCharging = false;
      } else if (hour >= 20) {
        const progress = (hour - 20 + (timestamp.getMinutes() / 60)) / 4;
        batteryPercent = Math.round(35 + progress * 65);
        batteryStatus = 'Charging';
        isCharging = true;
      } else {
        batteryPercent = 100;
        batteryStatus = 'Full';
        isCharging = true;
      }

      batteryPercent = Math.max(0, Math.min(100, batteryPercent));
      if (batteryPercent === 100 && isCharging) {
        batteryStatus = 'Full';
      }

      let activityModifier = 0.2;
      if (hour >= 9 && hour < 12) activityModifier = 1.2;
      else if (hour >= 12 && hour < 14) activityModifier = 0.4;
      else if (hour >= 14 && hour < 18) activityModifier = 1.4;
      else if (hour >= 18 && hour < 22) activityModifier = 0.8;

      const cpu = Math.min(95, Math.max(3, (15 * activityModifier) + (Math.random() * 15 - 5.5)));
      const ramPercent = Math.min(90, Math.max(25, 45 + (cpu * 0.25) + (Math.random() * 4 - 2)));
      const ramTotalBytes = 16 * 1024 * 1024 * 1024;
      const ramUsedBytes = Math.round((ramPercent / 100) * ramTotalBytes);

      const baseTemp = isCharging ? 48 : 40;
      const cpuTemp = parseFloat((baseTemp + (cpu * 0.35) + (Math.random() * 5 - 2)).toFixed(1));

      const ssid = (hour >= 9 && hour < 17) ? 'Office-Enterprise' : 'Home-WiFi-5G';
      const signal = Math.round(80 + Math.random() * 20);
      const activityIndex = Math.round(Math.max(0, Math.min(100, (activityModifier * 50) + (Math.random() * 20 - 10))));
      const screenTimeToday = (hour < 8) ? 0 : Math.round(((hour - 8) * 45) + (timestamp.getMinutes() * 0.75));

      laptopMetricsToInsert.push({
        laptopId: 'sahil-laptop',
        laptopName: 'ZenBook Pro UX',
        cpuUsage: parseFloat(cpu.toFixed(1)),
        ramUsage: {
          totalBytes: ramTotalBytes,
          usedBytes: ramUsedBytes,
          usagePercent: parseFloat(ramPercent.toFixed(1))
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
          ssid,
          signalStrength: signal
        },
        screenTimeToday,
        appUsage: defaultApps,
        activityIndex,
        timestamp
      });
    }

    await ServerMetric.insertMany(serverMetricsToInsert);
    await LaptopMetric.insertMany(laptopMetricsToInsert);
    console.log(`Successfully seeded ${serverMetricsToInsert.length} server metrics and ${laptopMetricsToInsert.length} laptop metrics!`);
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seed();
