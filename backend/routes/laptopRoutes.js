import express from 'express';
import mongoose from 'mongoose';
import LaptopMetric from '../models/LaptopMetric.js';

const router = express.Router();

// Hybrid In-Memory Data Store for fallback when MongoDB is not connected
let inMemoryLaptopMetrics = [];

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
      const metric = new LaptopMetric(payload);
      await metric.save();
    } else {
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
