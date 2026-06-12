import express from 'express';
import mongoose from 'mongoose';
import ServerMetric from '../models/ServerMetric.js';

const router = express.Router();

// Hybrid In-Memory Data Store for fallback when MongoDB is not connected
let inMemoryMetrics = [];

// Seed in-memory database with initial simulated 24h metric logs
const SERVERS = [
  { id: 'web-server-01', name: 'Web Server 01', baseCpu: 20, ramTotalGB: 16 },
  { id: 'db-server-01', name: 'Database Server 01', baseCpu: 35, ramTotalGB: 32 },
  { id: 'cache-server-01', name: 'Redis Cache 01', baseCpu: 10, ramTotalGB: 8 }
];

const seedInMemory = () => {
  console.log('Initializing in-memory metrics database fallback (7 days)...');
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const intervalMs = 30 * 60 * 1000; // 30 min intervals
  
  for (let offset = sevenDaysMs; offset >= 0; offset -= intervalMs) {
    const timestamp = new Date(now - offset);
    const hour = timestamp.getHours();

    for (const server of SERVERS) {
      let modifier = 1.0;
      if (hour >= 14 && hour <= 20) {
        modifier += 1.5 + Math.random() * 0.5;
      } else if (hour >= 1 && hour <= 5) {
        modifier -= 0.6;
      }

      let backupSpike = 0;
      if (server.id === 'db-server-01' && hour === 3) {
        backupSpike = 40;
      }

      const cpu = Math.min(98, Math.max(2, server.baseCpu * modifier + backupSpike + (Math.random() * 10 - 5)));
      const ramPercent = Math.min(95, Math.max(10, (server.id === 'db-server-01' ? 70 : 40) + (cpu * 0.2) + (Math.random() * 6 - 3)));
      const totalBytes = server.ramTotalGB * 1024 * 1024 * 1024;
      const usedBytes = Math.round((ramPercent / 100) * totalBytes);
      const load1m = parseFloat((cpu / 50 + Math.random() * 0.5).toFixed(2));

      inMemoryMetrics.push({
        serverId: server.id,
        serverName: server.name,
        cpuUsage: parseFloat(cpu.toFixed(1)),
        ramUsage: {
          totalBytes,
          usedBytes,
          usagePercent: parseFloat(ramPercent.toFixed(1))
        },
        loadAverage: {
          oneMin: load1m,
          fiveMin: parseFloat((load1m * 0.9 + Math.random() * 0.2).toFixed(2)),
          fifteenMin: parseFloat((load1m * 0.85 + Math.random() * 0.1).toFixed(2))
        },
        timestamp
      });
    }
  }
  console.log(`Seeded in-memory store with ${inMemoryMetrics.length} samples.`);
};

// Initialize in-memory logs
seedInMemory();

// Helper helper to check MongoDB connection status
const isMongoConnected = () => mongoose.connection.readyState === 1;

// 1. Log metrics from a server
router.post('/', async (req, res) => {
  try {
    const { serverId, serverName, cpuUsage, ramUsage, loadAverage, timestamp } = req.body;
    
    if (!serverId || !serverName || cpuUsage === undefined || !ramUsage || !loadAverage) {
      return res.status(400).json({ error: 'Missing required metrics fields.' });
    }

    const payload = {
      serverId,
      serverName,
      cpuUsage: parseFloat(cpuUsage),
      ramUsage: {
        totalBytes: parseInt(ramUsage.totalBytes),
        usedBytes: parseInt(ramUsage.usedBytes),
        usagePercent: parseFloat(ramUsage.usagePercent)
      },
      loadAverage: {
        oneMin: parseFloat(loadAverage.oneMin),
        fiveMin: parseFloat(loadAverage.fiveMin),
        fifteenMin: parseFloat(loadAverage.fifteenMin)
      },
      timestamp: timestamp ? new Date(timestamp) : new Date()
    };

    if (isMongoConnected()) {
      const metric = new ServerMetric(payload);
      await metric.save();
    } else {
      // In-memory fallback: append and prune oldest if too large
      inMemoryMetrics.push(payload);
      if (inMemoryMetrics.length > 5000) {
        inMemoryMetrics.shift();
      }
      console.log(`[In-Memory API] Logged metrics for ${serverId}`);
    }

    res.status(201).json({ message: 'Metric logged successfully.' });
  } catch (error) {
    console.error('Error logging metric:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 2. Get current status of all servers (most recent metric per server)
router.get('/current', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const servers = await ServerMetric.aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$serverId',
            serverId: { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            cpuUsage: { $first: '$cpuUsage' },
            ramUsage: { $first: '$ramUsage' },
            loadAverage: { $first: '$loadAverage' },
            timestamp: { $first: '$timestamp' },
          }
        }
      ]);
      return res.json(servers);
    } else {
      // In-memory fallback
      const current = {};
      // Iterate chronological list so later updates overwrite earlier ones
      inMemoryMetrics.forEach(m => {
        current[m.serverId] = m;
      });
      return res.json(Object.values(current));
    }
  } catch (error) {
    console.error('Error fetching current status:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3. Get RAM usage over the last 24 hours (aggregated by hour to plot the graph)
router.get('/ram-history-24h', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: twentyFourHoursAgo } } },
        {
          $project: {
            serverId: 1,
            serverName: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            ramUsedGB: { $divide: ['$ramUsage.usedBytes', 1024 * 1024 * 1024] },
            year: { $year: '$timestamp' },
            month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' },
            hour: { $hour: '$timestamp' }
          }
        },
        {
          $group: {
            _id: {
              serverId: '$serverId',
              year: '$year',
              month: '$month',
              day: '$day',
              hour: '$hour'
            },
            serverName: { $first: '$serverName' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            maxRamUsedGB: { $max: '$ramUsedGB' }
          }
        },
        {
          $project: {
            _id: 0,
            serverId: '$_id.serverId',
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
            hour: '$_id.hour',
            serverName: 1,
            maxRamUsagePercent: 1,
            maxRamUsedGB: 1,
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
      // In-memory fallback: filter last 24h, group by server & hour, compute max
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = inMemoryMetrics.filter(m => new Date(m.timestamp).getTime() >= twentyFourHoursAgo);
      
      const hourlyMax = {};
      recent.forEach(m => {
        const d = new Date(m.timestamp);
        const key = `${m.serverId}-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
        if (!hourlyMax[key] || m.ramUsage.usagePercent > hourlyMax[key].maxRamUsagePercent) {
          hourlyMax[key] = {
            serverId: m.serverId,
            serverName: m.serverName,
            maxRamUsagePercent: m.ramUsage.usagePercent,
            maxRamUsedGB: m.ramUsage.usedBytes / (1024 * 1024 * 1024),
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hour: d.getHours(),
            timeLabel: `${d.getHours()}:00`
          };
        }
      });
      
      const sortedHistory = Object.values(hourlyMax).sort((a, b) => {
        return a.year - b.year || a.month - b.month || a.day - b.day || a.hour - b.hour;
      });
      return res.json(sortedHistory);
    }
  } catch (error) {
    console.error('Error fetching RAM history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3.5. Get weekly cluster analytics (aggregated daily for 7 days)
router.get('/history-weekly', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        {
          $project: {
            serverId: 1,
            serverName: 1,
            cpuUsage: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin',
            year: { $year: '$timestamp' },
            month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' }
          }
        },
        {
          $group: {
            _id: {
              serverId: '$serverId',
              year: '$year',
              month: '$month',
              day: '$day'
            },
            serverName: { $first: '$serverName' },
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }
          }
        },
        {
          $project: {
            _id: 0,
            serverId: '$_id.serverId',
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
            serverName: 1,
            avgCpuUsage: { $round: ['$avgCpuUsage', 1] },
            maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 1] },
            avgLoad: { $round: ['$avgLoad', 2] }
          }
        },
        { $sort: { year: 1, month: 1, day: 1 } }
      ]);
      return res.json(history);
    } else {
      // In-memory fallback
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recent = inMemoryMetrics.filter(m => new Date(m.timestamp).getTime() >= sevenDaysAgo);
      
      const dailyGroups = {};
      recent.forEach(m => {
        const d = new Date(m.timestamp);
        const dateKey = `${m.serverId}-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        if (!dailyGroups[dateKey]) {
          dailyGroups[dateKey] = {
            serverId: m.serverId,
            serverName: m.serverName,
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            cpus: [],
            rams: [],
            loads: []
          };
        }
        dailyGroups[dateKey].cpus.push(m.cpuUsage);
        dailyGroups[dateKey].rams.push(m.ramUsage.usagePercent);
        dailyGroups[dateKey].loads.push(m.loadAverage.oneMin);
      });

      const weeklyList = Object.values(dailyGroups).map(group => {
        const count = group.loads.length;
        const sum = arr => arr.reduce((a, b) => a + b, 0);
        const max = arr => Math.max(...arr);

        return {
          serverId: group.serverId,
          serverName: group.serverName,
          year: group.year,
          month: group.month,
          day: group.day,
          avgCpuUsage: parseFloat((sum(group.cpus) / count).toFixed(1)),
          maxRamUsagePercent: parseFloat(max(group.rams).toFixed(1)),
          avgLoad: parseFloat((sum(group.loads) / count).toFixed(2))
        };
      }).sort((a, b) => {
        return a.year - b.year || a.month - b.month || a.day - b.day;
      });

      return res.json(weeklyList);
    }
  } catch (error) {
    console.error('Error fetching weekly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 4. Time of day analysis across all servers
router.get('/peak-analysis', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const analysis = await ServerMetric.aggregate([
        {
          $project: {
            serverId: 1,
            serverName: 1,
            cpuUsage: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin',
            hour: { $hour: '$timestamp' }
          }
        },
        {
          $group: {
            _id: '$hour',
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxCpuUsage: { $max: '$cpuUsage' },
            avgRamUsagePercent: { $avg: '$ramUsagePercent' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' },
            maxLoad: { $max: '$loadAverageOneMin' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            hour: '$_id',
            avgCpuUsage: { $round: ['$avgCpuUsage', 2] },
            maxCpuUsage: { $round: ['$maxCpuUsage', 2] },
            avgRamUsagePercent: { $round: ['$avgRamUsagePercent', 2] },
            maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 2] },
            avgLoad: { $round: ['$avgLoad', 2] },
            maxLoad: { $round: ['$maxLoad', 2] },
            count: 1
          }
        },
        { $sort: { hour: 1 } }
      ]);
      return res.json(analysis);
    } else {
      // In-memory fallback: group by hour (0-23)
      const hourlyGroups = {};
      for (let i = 0; i < 24; i++) {
        hourlyGroups[i] = { cpus: [], rams: [], loads: [] };
      }
      
      inMemoryMetrics.forEach(m => {
        const hour = new Date(m.timestamp).getHours();
        hourlyGroups[hour].cpus.push(m.cpuUsage);
        hourlyGroups[hour].rams.push(m.ramUsage.usagePercent);
        hourlyGroups[hour].loads.push(m.loadAverage.oneMin);
      });

      const analysis = Object.keys(hourlyGroups).map(hrStr => {
        const hour = parseInt(hrStr, 10);
        const group = hourlyGroups[hour];
        const count = group.loads.length;
        
        if (count === 0) {
          return { hour, avgCpuUsage: 0, maxCpuUsage: 0, avgRamUsagePercent: 0, maxRamUsagePercent: 0, avgLoad: 0, maxLoad: 0, count: 0 };
        }

        const sum = arr => arr.reduce((a, b) => a + b, 0);
        const max = arr => Math.max(...arr);
        
        return {
          hour,
          avgCpuUsage: parseFloat((sum(group.cpus) / count).toFixed(2)),
          maxCpuUsage: parseFloat(max(group.cpus).toFixed(2)),
          avgRamUsagePercent: parseFloat((sum(group.rams) / count).toFixed(2)),
          maxRamUsagePercent: parseFloat(max(group.rams).toFixed(2)),
          avgLoad: parseFloat((sum(group.loads) / count).toFixed(2)),
          maxLoad: parseFloat(max(group.loads).toFixed(2)),
          count
        };
      }).sort((a, b) => a.hour - b.hour);
      
      return res.json(analysis);
    }
  } catch (error) {
    console.error('Error performing peak analysis:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
