import express from 'express';
import mongoose from 'mongoose';
import LaptopMetric from '../models/LaptopMetric.js';

const router = express.Router();

// Hybrid In-Memory Data Store for fallback when MongoDB is not connected
let inMemoryLaptopMetrics = [];

// Seed in-memory database with initial simulated 24h laptop logs
const LAPTOPS = [
  { id: 'sahil-laptop', name: 'ZenBook Pro UX' }
];

const seedInMemory = () => {
  console.log('Initializing in-memory laptop metrics database fallback...');
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const intervalMs = 15 * 60 * 1000; // 15 min intervals
  
  // App usage distribution
  const defaultApps = [
    { name: 'VS Code', durationPercent: 45 },
    { name: 'Chrome', durationPercent: 30 },
    { name: 'Terminal', durationPercent: 13 },
    { name: 'Slack', durationPercent: 7 },
    { name: 'Spotify', durationPercent: 5 }
  ];

  for (let offset = oneDayMs; offset >= 0; offset -= intervalMs) {
    const timestamp = new Date(now - offset);
    const hour = timestamp.getHours();

    for (const laptop of LAPTOPS) {
      // Simulate battery levels (discharging during day, charging at specific hours)
      // Cycle 1: 00:00 - 08:00 (Plugged in overnight -> 100%)
      // Cycle 2: 08:00 - 13:00 (Unplugged, working -> drains to ~15%)
      // Cycle 3: 13:00 - 15:30 (Plugged back in, charging -> back to 100%)
      // Cycle 4: 15:30 - 20:00 (Unplugged, working -> drains to ~35%)
      // Cycle 5: 20:00 - 24:00 (Plugged in, charging / resting -> 100%)
      let batteryPercent = 100;
      let batteryStatus = 'Full';
      let isCharging = true;

      if (hour >= 8 && hour < 13) {
        // Discharging from 100% to 15%
        const progress = (hour - 8 + (timestamp.getMinutes() / 60)) / 5; // 0 to 1
        batteryPercent = Math.round(100 - progress * 85);
        batteryStatus = 'Discharging';
        isCharging = false;
      } else if (hour >= 13 && hour < 16) {
        // Charging from 15% to 100%
        const progress = (hour - 13 + (timestamp.getMinutes() / 60)) / 3; // 0 to 1
        batteryPercent = Math.round(15 + progress * 85);
        batteryStatus = 'Charging';
        isCharging = true;
      } else if (hour >= 16 && hour < 20) {
        // Discharging from 100% to 35%
        const progress = (hour - 16 + (timestamp.getMinutes() / 60)) / 4; // 0 to 1
        batteryPercent = Math.round(100 - progress * 65);
        batteryStatus = 'Discharging';
        isCharging = false;
      } else if (hour >= 20) {
        // Charging back up
        const progress = (hour - 20 + (timestamp.getMinutes() / 60)) / 4; // 0 to 1
        batteryPercent = Math.round(35 + progress * 65);
        batteryStatus = 'Charging';
        isCharging = true;
      } else {
        // Overnight, stays at 100%
        batteryPercent = 100;
        batteryStatus = 'Full';
        isCharging = true;
      }

      // Ensure boundaries
      batteryPercent = Math.max(0, Math.min(100, batteryPercent));
      if (batteryPercent === 100 && isCharging) {
        batteryStatus = 'Full';
      }

      // CPU correlates with active periods
      let activityModifier = 0.2; // Idle overnight
      if (hour >= 9 && hour < 12) activityModifier = 1.2; // Morning work
      else if (hour >= 12 && hour < 14) activityModifier = 0.4; // Lunch break
      else if (hour >= 14 && hour < 18) activityModifier = 1.4; // Afternoon intense dev
      else if (hour >= 18 && hour < 22) activityModifier = 0.8; // Evening casual usage

      const cpu = Math.min(95, Math.max(3, (15 * activityModifier) + (Math.random() * 15 - 5.5)));
      const ramPercent = Math.min(90, Math.max(25, 45 + (cpu * 0.25) + (Math.random() * 4 - 2)));
      
      const ramTotalBytes = 16 * 1024 * 1024 * 1024; // 16GB
      const ramUsedBytes = Math.round((ramPercent / 100) * ramTotalBytes);

      // Thermals correlate with CPU
      const baseTemp = isCharging ? 48 : 40; // Charging warms up the laptop
      const cpuTemp = parseFloat((baseTemp + (cpu * 0.35) + (Math.random() * 5 - 2)).toFixed(1));

      // Network SSID
      const ssid = (hour >= 9 && hour < 17) ? 'Office-Enterprise' : 'Home-WiFi-5G';
      const signal = Math.round(80 + Math.random() * 20);

      // Activity level (keystrokes/clicks proxy)
      const activityIndex = Math.round(Math.max(0, Math.min(100, (activityModifier * 50) + (Math.random() * 20 - 10))));

      // Screen time accumulation
      const screenTimeToday = (hour < 8) ? 0 : Math.round(((hour - 8) * 45) + (timestamp.getMinutes() * 0.75));

      inMemoryLaptopMetrics.push({
        laptopId: laptop.id,
        laptopName: laptop.name,
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
  }
  console.log(`Seeded in-memory laptop store with ${inMemoryLaptopMetrics.length} samples.`);
};

// Initialize in-memory logs
seedInMemory();

const isMongoConnected = () => mongoose.connection.readyState === 1;

// 1. Post telemetry for a laptop
router.post('/', async (req, res) => {
  try {
    const { 
      laptopId, laptopName, cpuUsage, ramUsage, battery, thermals, 
      wifi, screenTimeToday, appUsage, activityIndex, timestamp 
    } = req.body;

    if (!laptopId || !laptopName || cpuUsage === undefined || !ramUsage || !battery || !thermals) {
      return res.status(400).json({ error: 'Missing required laptop telemetry fields.' });
    }

    const payload = {
      laptopId,
      laptopName,
      cpuUsage: parseFloat(cpuUsage),
      ramUsage: {
        totalBytes: parseInt(ramUsage.totalBytes),
        usedBytes: parseInt(ramUsage.usedBytes),
        usagePercent: parseFloat(ramUsage.usagePercent)
      },
      battery: {
        percent: parseInt(battery.percent),
        status: battery.status,
        isCharging: !!battery.isCharging
      },
      thermals: {
        cpuTemp: parseFloat(thermals.cpuTemp)
      },
      wifi: {
        ssid: wifi?.ssid || 'Disconnected',
        signalStrength: parseInt(wifi?.signalStrength || 0)
      },
      screenTimeToday: parseInt(screenTimeToday || 0),
      appUsage: appUsage || [],
      activityIndex: parseInt(activityIndex || 0),
      timestamp: timestamp ? new Date(timestamp) : new Date()
    };

    if (isMongoConnected()) {
      const existingCount = await LaptopMetric.countDocuments({ laptopId });
      if (existingCount === 0 && process.env.SEED_DUMMY_HISTORY === 'true') {
        console.log(`[DB Laptop API] Seeding 24h of history in MongoDB for new laptop: ${laptopId}`);
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const intervalMs = 15 * 60 * 1000; // 15 min intervals
        const defaultApps = [
          { name: 'VS Code', durationPercent: 45 },
          { name: 'Chrome', durationPercent: 30 },
          { name: 'Terminal', durationPercent: 13 },
          { name: 'Slack', durationPercent: 7 },
          { name: 'Spotify', durationPercent: 5 }
        ];
        const laptopMetricsToInsert = [];
        for (let offset = oneDayMs; offset > 0; offset -= intervalMs) {
          const timestamp = new Date(now - offset);
          const hour = timestamp.getHours();
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
          if (batteryPercent === 100 && isCharging) batteryStatus = 'Full';

          let activityModifier = 0.2;
          if (hour >= 9 && hour < 12) activityModifier = 1.2;
          else if (hour >= 12 && hour < 14) activityModifier = 0.4;
          else if (hour >= 14 && hour < 18) activityModifier = 1.4;
          else if (hour >= 18 && hour < 22) activityModifier = 0.8;

          const cpu = Math.min(95, Math.max(3, (15 * activityModifier) + (Math.random() * 15 - 5.5)));
          const ramPercent = Math.min(90, Math.max(25, 45 + (cpu * 0.25) + (Math.random() * 4 - 2)));
          const ramTotalBytes = payload.ramUsage?.totalBytes || (16 * 1024 * 1024 * 1024);
          const ramUsedBytes = Math.round((ramPercent / 100) * ramTotalBytes);
          const baseTemp = isCharging ? 48 : 40;
          const cpuTemp = parseFloat((baseTemp + (cpu * 0.35) + (Math.random() * 5 - 2)).toFixed(1));
          const ssid = (hour >= 9 && hour < 17) ? 'Office-Enterprise' : 'Home-WiFi-5G';
          const signal = Math.round(80 + Math.random() * 20);
          const activityIndex = Math.round(Math.max(0, Math.min(100, (activityModifier * 50) + (Math.random() * 20 - 10))));
          const screenTimeToday = (hour < 8) ? 0 : Math.round(((hour - 8) * 45) + (timestamp.getMinutes() * 0.75));

          laptopMetricsToInsert.push({
            laptopId,
            laptopName,
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
        await LaptopMetric.insertMany(laptopMetricsToInsert);
      }
      const metric = new LaptopMetric(payload);
      await metric.save();
    } else {
      const hasHistory = inMemoryLaptopMetrics.some(m => m.laptopId === laptopId);
      if (!hasHistory && process.env.SEED_DUMMY_HISTORY === 'true') {
        console.log(`[In-Memory Laptop API] Seeding 24h of history for new laptop: ${laptopId}`);
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const intervalMs = 15 * 60 * 1000; // 15 min intervals
        const defaultApps = [
          { name: 'VS Code', durationPercent: 45 },
          { name: 'Chrome', durationPercent: 30 },
          { name: 'Terminal', durationPercent: 13 },
          { name: 'Slack', durationPercent: 7 },
          { name: 'Spotify', durationPercent: 5 }
        ];
        for (let offset = oneDayMs; offset > 0; offset -= intervalMs) {
          const timestamp = new Date(now - offset);
          const hour = timestamp.getHours();
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
          if (batteryPercent === 100 && isCharging) batteryStatus = 'Full';

          let activityModifier = 0.2;
          if (hour >= 9 && hour < 12) activityModifier = 1.2;
          else if (hour >= 12 && hour < 14) activityModifier = 0.4;
          else if (hour >= 14 && hour < 18) activityModifier = 1.4;
          else if (hour >= 18 && hour < 22) activityModifier = 0.8;

          const cpu = Math.min(95, Math.max(3, (15 * activityModifier) + (Math.random() * 15 - 5.5)));
          const ramPercent = Math.min(90, Math.max(25, 45 + (cpu * 0.25) + (Math.random() * 4 - 2)));
          const ramTotalBytes = payload.ramUsage?.totalBytes || (16 * 1024 * 1024 * 1024);
          const ramUsedBytes = Math.round((ramPercent / 100) * ramTotalBytes);
          const baseTemp = isCharging ? 48 : 40;
          const cpuTemp = parseFloat((baseTemp + (cpu * 0.35) + (Math.random() * 5 - 2)).toFixed(1));
          const ssid = (hour >= 9 && hour < 17) ? 'Office-Enterprise' : 'Home-WiFi-5G';
          const signal = Math.round(80 + Math.random() * 20);
          const activityIndex = Math.round(Math.max(0, Math.min(100, (activityModifier * 50) + (Math.random() * 20 - 10))));
          const screenTimeToday = (hour < 8) ? 0 : Math.round(((hour - 8) * 45) + (timestamp.getMinutes() * 0.75));

          inMemoryLaptopMetrics.push({
            laptopId,
            laptopName,
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
      }
      inMemoryLaptopMetrics.push(payload);
      if (inMemoryLaptopMetrics.length > 5000) {
        inMemoryLaptopMetrics.shift();
      }
      console.log(`[In-Memory Laptop API] Logged metrics for ${laptopId}`);
    }

    res.status(201).json({ message: 'Laptop metrics logged successfully.' });
  } catch (error) {
    console.error('Error logging laptop metric:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2. Get current status of all laptops (most recent metric per laptop, latest active first)
router.get('/current', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const laptops = await LaptopMetric.aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$laptopId',
            laptopId: { $first: '$laptopId' },
            laptopName: { $first: '$laptopName' },
            cpuUsage: { $first: '$cpuUsage' },
            ramUsage: { $first: '$ramUsage' },
            battery: { $first: '$battery' },
            thermals: { $first: '$thermals' },
            wifi: { $first: '$wifi' },
            screenTimeToday: { $first: '$screenTimeToday' },
            appUsage: { $first: '$appUsage' },
            activityIndex: { $first: '$activityIndex' },
            timestamp: { $first: '$timestamp' },
          }
        },
        { $sort: { timestamp: -1 } }
      ]);
      return res.json(laptops);
    } else {
      const current = {};
      inMemoryLaptopMetrics.forEach(m => {
        current[m.laptopId] = m;
      });
      const sorted = Object.values(current).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return res.json(sorted);
    }
  } catch (error) {
    console.error('Error fetching current laptop status:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3. Get history of laptop metrics over last 24 hours (grouped/sorted hourly, filtered by device)
router.get('/history-24h', async (req, res) => {
  try {
    let targetLaptopId = req.query.laptopId;

    if (isMongoConnected()) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      if (!targetLaptopId) {
        const latest = await LaptopMetric.findOne({}).sort({ timestamp: -1 }).select('laptopId');
        if (latest) {
          targetLaptopId = latest.laptopId;
        }
      }

      if (!targetLaptopId) {
        return res.json([]);
      }

      const history = await LaptopMetric.aggregate([
        { 
          $match: { 
            laptopId: targetLaptopId,
            timestamp: { $gte: twentyFourHoursAgo } 
          } 
        },
        {
          $project: {
            laptopId: 1,
            laptopName: 1,
            cpuUsage: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            batteryPercent: '$battery.percent',
            cpuTemp: '$thermals.cpuTemp',
            activityIndex: 1,
            year: { $year: '$timestamp' },
            month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' },
            hour: { $hour: '$timestamp' }
          }
        },
        {
          $group: {
            _id: {
              laptopId: '$laptopId',
              year: '$year',
              month: '$month',
              day: '$day',
              hour: '$hour'
            },
            laptopName: { $first: '$laptopName' },
            avgCpuUsage: { $avg: '$cpuUsage' },
            avgRamUsagePercent: { $avg: '$ramUsagePercent' },
            avgBatteryPercent: { $avg: '$batteryPercent' },
            avgCpuTemp: { $avg: '$cpuTemp' },
            avgActivityIndex: { $avg: '$activityIndex' }
          }
        },
        {
          $project: {
            _id: 0,
            laptopId: '$_id.laptopId',
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
            hour: '$_id.hour',
            laptopName: 1,
            avgCpuUsage: { $round: ['$avgCpuUsage', 1] },
            avgRamUsagePercent: { $round: ['$avgRamUsagePercent', 1] },
            avgBatteryPercent: { $round: ['$avgBatteryPercent', 1] },
            avgCpuTemp: { $round: ['$avgCpuTemp', 1] },
            avgActivityIndex: { $round: ['$avgActivityIndex', 1] },
            timeLabel: {
              $concat: [
                { $toString: '$_id.hour' },
                ':00'
              ]
            }
          }
        },
        { $sort: { year: 1, month: 1, day: 1, hour: 1 } }
      ]);
      return res.json(history);
    } else {
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      
      if (!targetLaptopId) {
        if (inMemoryLaptopMetrics.length > 0) {
          const sorted = [...inMemoryLaptopMetrics].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          targetLaptopId = sorted[0].laptopId;
        }
      }

      if (!targetLaptopId) {
        return res.json([]);
      }

      const recent = inMemoryLaptopMetrics.filter(m => 
        m.laptopId === targetLaptopId && 
        new Date(m.timestamp).getTime() >= twentyFourHoursAgo
      );
      
      const hourlyStats = {};
      recent.forEach(m => {
        const d = new Date(m.timestamp);
        const key = `${m.laptopId}-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
        if (!hourlyStats[key]) {
          hourlyStats[key] = {
            laptopId: m.laptopId,
            laptopName: m.laptopName,
            cpus: [],
            rams: [],
            batteries: [],
            temps: [],
            activities: [],
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hour: d.getHours(),
            timeLabel: `${d.getHours()}:00`
          };
        }
        hourlyStats[key].cpus.push(m.cpuUsage);
        hourlyStats[key].rams.push(m.ramUsage.usagePercent);
        hourlyStats[key].batteries.push(m.battery.percent);
        hourlyStats[key].temps.push(m.thermals.cpuTemp);
        hourlyStats[key].activities.push(m.activityIndex);
      });

      const sortedHistory = Object.values(hourlyStats).map(h => {
        const count = h.cpus.length;
        const sum = arr => arr.reduce((a, b) => a + b, 0);
        return {
          laptopId: h.laptopId,
          laptopName: h.laptopName,
          year: h.year,
          month: h.month,
          day: h.day,
          hour: h.hour,
          timeLabel: h.timeLabel,
          avgCpuUsage: parseFloat((sum(h.cpus) / count).toFixed(1)),
          avgRamUsagePercent: parseFloat((sum(h.rams) / count).toFixed(1)),
          avgBatteryPercent: parseFloat((sum(h.batteries) / count).toFixed(1)),
          avgCpuTemp: parseFloat((sum(h.temps) / count).toFixed(1)),
          avgActivityIndex: parseFloat((sum(h.activities) / count).toFixed(1))
        };
      }).sort((a, b) => {
        return a.year - b.year || a.month - b.month || a.day - b.day || a.hour - b.hour;
      });

      return res.json(sortedHistory);
    }
  } catch (error) {
    console.error('Error fetching laptop history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
