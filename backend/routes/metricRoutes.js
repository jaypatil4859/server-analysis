import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import tls from 'tls';
import ServerMetric from '../models/ServerMetric.js';
import Alert from '../models/Alert.js';

const router = express.Router();

// ─── In-Memory Fallback Store (no dummy seeding — only real data pushed by Nagios) ───
let inMemoryMetrics = []; // keyed latest per serverId
let inMemoryAlerts  = [];

// Alert throttle: 5 minutes between notifications for the same server+metric
const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const lastAlertedTimes  = {};

// Cleanup stale alert throttle entries every hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const sid of Object.keys(lastAlertedTimes)) {
    for (const metric of Object.keys(lastAlertedTimes[sid])) {
      if (lastAlertedTimes[sid][metric] < cutoff) {
        delete lastAlertedTimes[sid][metric];
      }
    }
    if (Object.keys(lastAlertedTimes[sid]).length === 0) {
      delete lastAlertedTimes[sid];
    }
  }
}, 60 * 60 * 1000);

// Helper to check MongoDB connection
const isMongoConnected = () => mongoose.connection.readyState === 1;

// ─── Alert Logging ───────────────────────────────────────────────────────────
const logAlertToFile = async (alert) => {
  try {
    const logPath = path.join(process.cwd(), 'alerts.log');
    const logLine = `[${alert.timestamp.toISOString()}] [ALERT] Server: ${alert.serverName} (${alert.serverId}) | Type: ${alert.metricType} | Value: ${alert.metricValue}% (Threshold: ${alert.threshold}%)\n`;
    await fs.promises.appendFile(logPath, logLine);
  } catch (error) {
    console.error('Error logging alert to file:', error);
  }
};

const sendAlertEmail = async (alert) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_RECIPIENT } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_RECIPIENT) {
    console.log(`[ALERT EMAIL SIMULATION] SMTP not configured. Logged alert: Server ${alert.serverName} is using ${alert.metricValue}% ${alert.metricType}`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10),
      secure: parseInt(SMTP_PORT, 10) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"Server Analysis Alerts" <${SMTP_USER}>`,
      to: ALERT_EMAIL_RECIPIENT,
      subject: `🚨 CRITICAL ALERT: Server ${alert.serverName} ${alert.metricType} Usage Exceeds 90%`,
      text: `Critical resource usage detected on server:\nServer: ${alert.serverName} (${alert.serverId})\nResource: ${alert.metricType}\nUsage: ${alert.metricValue}% (Threshold: ${alert.threshold}%)\nTimestamp: ${alert.timestamp.toISOString()}`,
    });
  } catch (error) {
    console.error('[ALERT EMAIL ERROR]', error.message);
  }
};

const sendAlertMessage = async (alert) => {
  const { SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL } = process.env;
  if (!SLACK_WEBHOOK_URL && !DISCORD_WEBHOOK_URL) return;

  try {
    const url = SLACK_WEBHOOK_URL || DISCORD_WEBHOOK_URL;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *CRITICAL RESOURCE ALERT*\n*Server*: ${alert.serverName} (\`${alert.serverId}\`)\n*Resource*: ${alert.metricType}\n*Usage*: *${alert.metricValue}%* (Threshold: ${alert.threshold}%)`
      }),
    });
  } catch (error) {
    console.error('[ALERT WEBHOOK ERROR]', error.message);
  }
};

const triggerAlertNotifications = async (alert) => {
  await logAlertToFile(alert);
  await sendAlertEmail(alert);
  await sendAlertMessage(alert);
};

// ─── 1. POST /api/metrics — Ingest metrics from Nagios bridge ────────────────
router.post('/', async (req, res) => {
  try {
    const { serverId, serverName, cpuUsage, ramUsage, loadAverage, cpuCores, diskUsage, timestamp, services } = req.body;

    if (!serverId || !serverName || cpuUsage === undefined || cpuUsage === null || !ramUsage || !loadAverage) {
      return res.status(400).json({ error: 'Missing required metrics fields.' });
    }

    const parsedCpu    = parseFloat(cpuUsage);
    const parsedRamPct = parseFloat(ramUsage.usagePercent);
    const parsedRamTotal = ramUsage.totalBytes !== undefined && ramUsage.totalBytes !== null ? parseInt(ramUsage.totalBytes) : undefined;
    const parsedRamUsed  = ramUsage.usedBytes !== undefined && ramUsage.usedBytes !== null ? parseInt(ramUsage.usedBytes) : undefined;
    const parsedLoad1m   = parseFloat(loadAverage.oneMin);
    const parsedLoad5m   = parseFloat(loadAverage.fiveMin);
    const parsedLoad15m  = parseFloat(loadAverage.fifteenMin);

    if ([parsedCpu, parsedRamPct, parsedLoad1m, parsedLoad5m, parsedLoad15m].some(isNaN)) {
      return res.status(400).json({ error: 'Invalid metrics: numeric values cannot be NaN.' });
    }

    let parsedDisk;
    if (diskUsage) {
      const dp = parseFloat(diskUsage.usagePercent);
      if (!isNaN(dp)) {
        const dt = diskUsage.totalBytes !== undefined && diskUsage.totalBytes !== null ? parseInt(diskUsage.totalBytes) : undefined;
        const du = diskUsage.usedBytes !== undefined && diskUsage.usedBytes !== null ? parseInt(diskUsage.usedBytes) : undefined;
        parsedDisk = {
          totalBytes: dt && !isNaN(dt) ? dt : undefined,
          usedBytes:  du && !isNaN(du) ? du : undefined,
          usagePercent: dp
        };
      }
    }

    const payload = {
      serverId,
      serverName,
      cpuUsage:   parsedCpu,
      ramUsage:   { totalBytes: parsedRamTotal, usedBytes: parsedRamUsed, usagePercent: parsedRamPct },
      diskUsage:  parsedDisk,
      loadAverage: { oneMin: parsedLoad1m, fiveMin: parsedLoad5m, fifteenMin: parsedLoad15m },
      cpuCores:   cpuCores ? parseInt(cpuCores) : undefined,
      timestamp:  timestamp ? new Date(timestamp) : new Date(),
      services:   services || []
    };

    if (isMongoConnected()) {
      const metric = new ServerMetric(payload);
      await metric.save();
    } else {
      // In-memory fallback: keep only the latest entry per server (no history in fallback)
      const idx = inMemoryMetrics.findIndex(m => m.serverId === serverId);
      if (idx >= 0) {
        inMemoryMetrics[idx] = payload;
      } else {
        inMemoryMetrics.push(payload);
      }
      console.log(`[In-Memory] Updated metrics for ${serverId}`);
    }

    // Alert threshold checks (>=90%)
    const triggerAlert = async (type, val) => {
      const alertPayload = {
        serverId, serverName,
        metricType:  type,
        metricValue: parseFloat(val.toFixed(1)),
        threshold:   90,
        timestamp:   new Date(),
        resolved:    false
      };
      if (isMongoConnected()) {
        await new Alert(alertPayload).save();
      } else {
        inMemoryAlerts.push(alertPayload);
        if (inMemoryAlerts.length > 500) inMemoryAlerts.shift();
      }
      await triggerAlertNotifications(alertPayload);
    };

    const now = Date.now();
    if (payload.cpuUsage >= 90) {
      if (!lastAlertedTimes[serverId]) lastAlertedTimes[serverId] = {};
      const last = lastAlertedTimes[serverId]['CPU'];
      if (!last || now - last > ALERT_THROTTLE_MS) {
        lastAlertedTimes[serverId]['CPU'] = now;
        await triggerAlert('CPU', payload.cpuUsage);
      }
    }
    if (payload.ramUsage.usagePercent >= 90) {
      if (!lastAlertedTimes[serverId]) lastAlertedTimes[serverId] = {};
      const last = lastAlertedTimes[serverId]['RAM'];
      if (!last || now - last > ALERT_THROTTLE_MS) {
        lastAlertedTimes[serverId]['RAM'] = now;
        await triggerAlert('RAM', payload.ramUsage.usagePercent);
      }
    }

    res.status(201).json({ message: 'Metric logged successfully.' });
  } catch (error) {
    console.error('Error logging metric:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 2. GET /api/metrics/current — Latest metric per server ─────────────────
router.get('/current', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const serverIds = await ServerMetric.distinct('serverId');
      const docs = await Promise.all(
        serverIds.map(id => ServerMetric.findOne({ serverId: id }).sort({ timestamp: -1 }).lean())
      );
      const valid = docs.filter(Boolean).sort((a, b) => (a.serverName || '').localeCompare(b.serverName || ''));
      return res.json(valid);
    } else {
      const sorted = [...inMemoryMetrics].sort((a, b) => (a.serverName || '').localeCompare(b.serverName || ''));
      return res.json(sorted);
    }
  } catch (error) {
    console.error('Error fetching current status:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 3. GET /api/metrics/ram-history-24h ────────────────────────────────────
router.get('/ram-history-24h', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $project: {
            serverId: 1, serverName: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            ramUsedGB: { $divide: ['$ramUsage.usedBytes', 1073741824] },
            year: { $year: '$timestamp' }, month: { $month: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' }, hour: { $hour: '$timestamp' }
          }
        },
        {
          $group: {
            _id: { serverId: '$serverId', year: '$year', month: '$month', day: '$day', hour: '$hour' },
            serverName: { $first: '$serverName' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            maxRamUsedGB: { $max: '$ramUsedGB' }
          }
        },
        {
          $project: {
            _id: 0,
            serverId: '$_id.serverId', serverName: 1,
            year: '$_id.year', month: '$_id.month', day: '$_id.day', hour: '$_id.hour',
            maxRamUsagePercent: 1, maxRamUsedGB: 1,
            timeLabel: { $concat: [{ $toString: '$_id.hour' }, ':00'] }
          }
        },
        { $sort: { year: 1, month: 1, day: 1, hour: 1 } }
      ]);
      return res.json(history);
    } else {
      // In-memory: no historical data in fallback mode — return empty
      return res.json([]);
    }
  } catch (error) {
    console.error('Error fetching RAM history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 3.5 GET /api/metrics/history-weekly ────────────────────────────────────
router.get('/history-weekly', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $project: {
            serverId: 1, serverName: 1, cpuUsage: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin',
            year: { $year: '$timestamp' }, month: { $month: '$timestamp' }, day: { $dayOfMonth: '$timestamp' }
          }
        },
        {
          $group: {
            _id: { serverId: '$serverId', year: '$year', month: '$month', day: '$day' },
            serverName: { $first: '$serverName' },
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }
          }
        },
        {
          $project: {
            _id: 0,
            serverId: '$_id.serverId', serverName: 1,
            year: '$_id.year', month: '$_id.month', day: '$_id.day',
            avgCpuUsage: { $round: ['$avgCpuUsage', 1] },
            maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 1] },
            avgLoad: { $round: ['$avgLoad', 2] }
          }
        },
        { $sort: { year: 1, month: 1, day: 1 } }
      ]);
      return res.json(history);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error('Error fetching weekly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 3.6 GET /api/metrics/history-monthly ───────────────────────────────────
router.get('/history-monthly', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $project: {
            serverId: 1, serverName: 1, cpuUsage: 1,
            ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin',
            year: { $year: '$timestamp' }, month: { $month: '$timestamp' }, day: { $dayOfMonth: '$timestamp' }
          }
        },
        {
          $group: {
            _id: { serverId: '$serverId', year: '$year', month: '$month', day: '$day' },
            serverName: { $first: '$serverName' },
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }
          }
        },
        {
          $project: {
            _id: 0,
            serverId: '$_id.serverId', serverName: 1,
            year: '$_id.year', month: '$_id.month', day: '$_id.day',
            avgCpuUsage: { $round: ['$avgCpuUsage', 1] },
            maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 1] },
            avgLoad: { $round: ['$avgLoad', 2] }
          }
        },
        { $sort: { year: 1, month: 1, day: 1 } }
      ]);
      return res.json(history);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error('Error fetching monthly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 3.7 GET /api/metrics/server-history-weekly ─────────────────────────────
router.get('/server-history-weekly', async (req, res) => {
  const { serverId } = req.query;
  if (!serverId) return res.status(400).json({ error: 'Missing serverId parameter.' });

  try {
    if (isMongoConnected()) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { $match: { serverId, timestamp: { $gte: since } } },
        {
          $project: {
            cpuUsage: 1, ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin',
            year: { $year: '$timestamp' }, month: { $month: '$timestamp' }, day: { $dayOfMonth: '$timestamp' }
          }
        },
        {
          $group: {
            _id: { year: '$year', month: '$month', day: '$day' },
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }
          }
        },
        {
          $project: {
            _id: 0,
            year: '$_id.year', month: '$_id.month', day: '$_id.day',
            avgCpuUsage: { $round: ['$avgCpuUsage', 1] },
            maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 1] },
            avgLoad: { $round: ['$avgLoad', 2] }
          }
        },
        { $sort: { year: 1, month: 1, day: 1 } }
      ]);
      return res.json(history);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error('Error fetching server weekly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 3.8 GET /api/metrics/combustion-summary ────────────────────────────────
router.get('/combustion-summary', async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenWeeksAgo      = new Date(Date.now() - 49 * 24 * 60 * 60 * 1000);

    const computeSummaryPayload = (serverSummaries) => {
      let current80Count = 0, current90Count = 0;
      let peak24h80Count = 0, peak24h90Count = 0;
      let peak7d80Count  = 0, peak7d90Count  = 0;
      const above80in24h = [], above80in7d = [];

      serverSummaries.forEach(s => {
        const maxCurrent = Math.max(s.currentCpu, s.currentRam);
        if (maxCurrent >= 90) current90Count++;
        if (maxCurrent >= 80) current80Count++;

        const max24h = Math.max(s.maxCpu24h, s.maxRam24h);
        if (max24h >= 90) peak24h90Count++;
        if (max24h >= 80) {
          peak24h80Count++;
          above80in24h.push({ serverId: s.serverId, serverName: s.serverName, maxCpu: s.maxCpu24h, maxRam: s.maxRam24h, peakValue: max24h });
        }

        const max7d = Math.max(s.maxCpu7d, s.maxRam7d);
        if (max7d >= 90) peak7d90Count++;
        if (max7d >= 80) {
          peak7d80Count++;
          above80in7d.push({ serverId: s.serverId, serverName: s.serverName, maxCpu: s.maxCpu7d, maxRam: s.maxRam7d, peakValue: max7d });
        }
      });

      above80in24h.sort((a, b) => b.peakValue - a.peakValue);
      above80in7d.sort((a, b) => b.peakValue - a.peakValue);

      return {
        serverSummaries,
        above80in24h,
        above80in7d,
        counts: { current80Count, current90Count, peak24h80Count, peak24h90Count, peak7d80Count, peak7d90Count }
      };
    };

    if (isMongoConnected()) {
      const [currentServers, metrics24h, metrics7d] = await Promise.all([
        ServerMetric.aggregate([
          { $sort: { timestamp: -1 } },
          { $group: { _id: '$serverId', serverId: { $first: '$serverId' }, serverName: { $first: '$serverName' }, cpuUsage: { $first: '$cpuUsage' }, ramUsagePercent: { $first: '$ramUsage.usagePercent' } } }
        ]),
        ServerMetric.aggregate([
          { $match: { timestamp: { $gte: twentyFourHoursAgo } } },
          { $group: { _id: '$serverId', serverId: { $first: '$serverId' }, serverName: { $first: '$serverName' }, maxCpu: { $max: '$cpuUsage' }, maxRam: { $max: '$ramUsage.usagePercent' } } }
        ]),
        ServerMetric.aggregate([
          { $match: { timestamp: { $gte: sevenWeeksAgo } } },
          { $group: { _id: '$serverId', serverId: { $first: '$serverId' }, serverName: { $first: '$serverName' }, maxCpu: { $max: '$cpuUsage' }, maxRam: { $max: '$ramUsage.usagePercent' } } }
        ])
      ]);

      const currentMap = Object.fromEntries(currentServers.map(s => [s.serverId, s]));
      const map24h     = Object.fromEntries(metrics24h.map(s => [s.serverId, s]));
      const map7d      = Object.fromEntries(metrics7d.map(s => [s.serverId, s]));

      const allIds = Array.from(new Set([
        ...currentServers.map(s => s.serverId),
        ...metrics24h.map(s => s.serverId),
        ...metrics7d.map(s => s.serverId)
      ]));

      const serverSummaries = allIds.map(sid => {
        const cur  = currentMap[sid] || { cpuUsage: 0, ramUsagePercent: 0, serverName: sid };
        const m24  = map24h[sid]     || { maxCpu: 0, maxRam: 0 };
        const m7   = map7d[sid]      || { maxCpu: 0, maxRam: 0 };
        return {
          serverId:    sid,
          serverName:  cur.serverName || sid,
          currentCpu:  cur.cpuUsage        || 0,
          currentRam:  cur.ramUsagePercent  || 0,
          maxCpu24h:   m24.maxCpu || 0,
          maxRam24h:   m24.maxRam || 0,
          maxCpu7d:    m7.maxCpu  || 0,
          maxRam7d:    m7.maxRam  || 0
        };
      });

      return res.json(computeSummaryPayload(serverSummaries));
    } else {
      // In-memory fallback: use only live entries
      const serverSummaries = inMemoryMetrics.map(m => ({
        serverId:   m.serverId,
        serverName: m.serverName,
        currentCpu: m.cpuUsage,
        currentRam: m.ramUsage.usagePercent,
        maxCpu24h:  m.cpuUsage,
        maxRam24h:  m.ramUsage.usagePercent,
        maxCpu7d:   m.cpuUsage,
        maxRam7d:   m.ramUsage.usagePercent
      }));
      return res.json(computeSummaryPayload(serverSummaries));
    }
  } catch (error) {
    console.error('Error computing combustion summary:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 4. GET /api/metrics/peak-analysis ──────────────────────────────────────
router.get('/peak-analysis', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const analysis = await ServerMetric.aggregate([
        {
          $project: {
            cpuUsage: 1, ramUsagePercent: '$ramUsage.usagePercent',
            loadAverageOneMin: '$loadAverage.oneMin', hour: { $hour: '$timestamp' }
          }
        },
        {
          $group: {
            _id: '$hour',
            avgCpuUsage: { $avg: '$cpuUsage' }, maxCpuUsage: { $max: '$cpuUsage' },
            avgRamUsagePercent: { $avg: '$ramUsagePercent' }, maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }, maxLoad: { $max: '$loadAverageOneMin' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0, hour: '$_id',
            avgCpuUsage: { $round: ['$avgCpuUsage', 2] }, maxCpuUsage: { $round: ['$maxCpuUsage', 2] },
            avgRamUsagePercent: { $round: ['$avgRamUsagePercent', 2] }, maxRamUsagePercent: { $round: ['$maxRamUsagePercent', 2] },
            avgLoad: { $round: ['$avgLoad', 2] }, maxLoad: { $round: ['$maxLoad', 2] }, count: 1
          }
        },
        { $sort: { hour: 1 } }
      ]);
      return res.json(analysis);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error('Error performing peak analysis:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 5. GET /api/metrics/alerts ─────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const alerts = await Alert.find().sort({ timestamp: -1 }).limit(50);
      return res.json(alerts);
    } else {
      return res.json([...inMemoryAlerts].reverse());
    }
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 6. POST /api/metrics/alerts/clear ──────────────────────────────────────
router.post('/alerts/clear', async (req, res) => {
  try {
    if (isMongoConnected()) {
      await Alert.deleteMany({});
    } else {
      inMemoryAlerts = [];
    }
    return res.json({ success: true, message: 'All alerts cleared.' });
  } catch (error) {
    console.error('Error clearing alerts:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── 7. GET /api/metrics/server-history-24h ─────────────────────────────────
router.get('/server-history-24h', async (req, res) => {
  const { serverId } = req.query;
  if (!serverId) return res.status(400).json({ error: 'Missing serverId parameter.' });

  try {
    if (isMongoConnected()) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const history = await ServerMetric.find({ serverId, timestamp: { $gte: since } }).sort({ timestamp: 1 });

      const hourlyData = {};
      history.forEach(m => {
        const d   = new Date(m.timestamp);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
        if (!hourlyData[key]) {
          hourlyData[key] = { cpuUsage: [], ramUsagePercent: [], loadOneMin: [], hour: d.getHours() };
        }
        hourlyData[key].cpuUsage.push(m.cpuUsage);
        hourlyData[key].ramUsagePercent.push(m.ramUsage.usagePercent);
        hourlyData[key].loadOneMin.push(m.loadAverage.oneMin);
      });

      const formatted = Object.values(hourlyData).map(h => {
        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        return {
          timeLabel:   `${h.hour.toString().padStart(2, '0')}:00`,
          cpuUsage:    parseFloat(avg(h.cpuUsage).toFixed(1)),
          ramUsage:    parseFloat(avg(h.ramUsagePercent).toFixed(1)),
          loadAverage: parseFloat(avg(h.loadOneMin).toFixed(2))
        };
      }).sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));

      return res.json(formatted);
    } else {
      return res.json([]);
    }
  } catch (error) {
    console.error('Error fetching server history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── SSL / Domain Expiry Checker ─────────────────────────────────────────────
const DOMAINS_TO_CHECK = [
  { domain: 'anvaya.sify.net',        path: '/sify/',  name: 'Sify Anvaya (Secure)' },
  { domain: 'punctualiti.co',         path: '/',       name: 'Punctualiti Website' },
  { domain: 'pulse.punctualiti.co',   path: '/',       name: 'Punctualiti Pulse Portal' },
  { domain: 'sify.net',               path: '/',       name: 'Sify Net Portal' }
];

const checkSslExpiry = (domain) => new Promise((resolve) => {
  const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false }, () => {
    const cert = socket.getPeerCertificate();
    if (!cert || !cert.valid_to) { socket.destroy(); return resolve({ domain, error: 'No certificate found' }); }
    const expiryDate   = new Date(cert.valid_to);
    const daysRemaining = Math.max(0, Math.floor((expiryDate - new Date()) / 86400000));
    socket.destroy();
    resolve({ domain, expiryDate: expiryDate.toISOString(), daysRemaining, issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown', isValid: new Date() < expiryDate });
  });
  socket.on('error', err => resolve({ domain, error: err.message }));
  socket.setTimeout(8000);
  socket.on('timeout', () => { socket.destroy(); resolve({ domain, error: 'Connection timed out' }); });
});

const checkHttpStatus = async (domain, urlPath) => {
  try {
    const r = await fetch(`https://${domain}${urlPath}`, { headers: { 'User-Agent': 'Server-Monitoring-Agent/1.0' }, signal: AbortSignal.timeout(6000) });
    return { status: r.status, statusText: r.statusText, ok: r.ok || r.status === 301 || r.status === 302 };
  } catch (err) {
    return { error: err.message, ok: false };
  }
};

const checkDomainExpiry = async (domain) => {
  try {
    const clean = domain.replace(/^[^.]+\./, '');
    const r     = await fetch(`https://rdap.org/domain/${clean}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`RDAP HTTP ${r.status}`);
    const data = await r.json();
    const exp  = (data.events || []).find(e => e.eventAction === 'expiration');
    if (exp?.eventDate) {
      const expiryDate    = new Date(exp.eventDate);
      const daysRemaining = Math.max(0, Math.floor((expiryDate - new Date()) / 86400000));
      return { domain, expiryDate: expiryDate.toISOString(), daysRemaining };
    }
    return { domain, error: 'Expiration date not found in RDAP' };
  } catch (err) {
    return { domain, error: err.message };
  }
};

router.get('/ssl-expiry', async (req, res) => {
  try {
    const results = await Promise.all(DOMAINS_TO_CHECK.map(async (item) => {
      const [ssl, http, reg] = await Promise.all([
        checkSslExpiry(item.domain),
        checkHttpStatus(item.domain, item.path),
        checkDomainExpiry(item.domain).catch(() => ({ domain: item.domain, error: 'RDAP timeout' }))
      ]);
      return {
        name:      item.name,
        domain:    item.domain,
        url:       `https://${item.domain}${item.path}`,
        ssl:       ssl.error ? { error: ssl.error } : { expiryDate: ssl.expiryDate, daysRemaining: ssl.daysRemaining, issuer: ssl.issuer, isValid: ssl.isValid },
        http:      { status: http.status || 'ERROR', statusText: http.statusText || http.error || 'Connection Error', ok: http.ok },
        registrar: reg.error ? { error: reg.error } : { expiryDate: reg.expiryDate, daysRemaining: reg.daysRemaining }
      };
    }));
    return res.json(results);
  } catch (error) {
    console.error('Error checking SSL/domains:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/metrics/services-summary ───────────────────────────────────────
router.get('/services-summary', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const servers = await ServerMetric.aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$serverId',
            serverId:   { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            services:   { $first: '$services' },
            timestamp:  { $first: '$timestamp' }
          }
        },
        { $sort: { serverName: 1 } }
      ]);
      return res.json(servers);
    } else {
      const sorted = [...inMemoryMetrics]
        .sort((a, b) => (a.serverName || '').localeCompare(b.serverName || ''))
        .map(m => ({ serverId: m.serverId, serverName: m.serverName, services: m.services || [], timestamp: m.timestamp }));
      return res.json(sorted);
    }
  } catch (error) {
    console.error('Error fetching services summary:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
