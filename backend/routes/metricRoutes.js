import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import ServerMetric from '../models/ServerMetric.js';
import Alert from '../models/Alert.js';

const router = express.Router();

// Hybrid In-Memory Data Store for fallback when MongoDB is not connected
let inMemoryMetrics = [];
let inMemoryAlerts = [];

// Throttle active alerts in memory to prevent notification storms (5 minutes = 300,000 ms)
const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const lastAlertedTimes = {}; // e.g., { 'web-server-01': { CPU: timestamp, RAM: timestamp } }

// 13 Active Servers Configuration (Emptied to disable dummy server seeding)
const SERVERS = [];

// Dummy server IDs and prefixes to filter out
const DUMMY_PREFIXES = ['web-server-', 'db-server-', 'cache-server-', 'test-server-', 'preview-vm-'];
const isDummyServer = (serverId) => DUMMY_PREFIXES.some(prefix => serverId && serverId.startsWith(prefix));

const seedInMemory = () => {
  console.log('Initializing in-memory metrics database fallback (7 weeks)...');
  const now = Date.now();
  const sevenWeeksMs = 7 * 7 * 24 * 60 * 60 * 1000;
  const intervalMs = 30 * 60 * 1000; // 30 min intervals
  
  for (let offset = sevenWeeksMs; offset >= 0; offset -= intervalMs) {
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

      const diskTotalGB = (server.id.includes('db') ? 500 : 250);
      const diskTotalBytes = diskTotalGB * 1024 * 1024 * 1024;
      const diskPercent = Math.min(95, Math.max(10, (server.id.includes('db') ? 60 : 40) + (Math.random() * 10 - 5)));
      const diskUsedBytes = Math.round((diskPercent / 100) * diskTotalBytes);

      inMemoryMetrics.push({
        serverId: server.id,
        serverName: server.name,
        cpuUsage: parseFloat(cpu.toFixed(1)),
        ramUsage: {
          totalBytes,
          usedBytes,
          usagePercent: parseFloat(ramPercent.toFixed(1))
        },
        diskUsage: {
          totalBytes: diskTotalBytes,
          usedBytes: diskUsedBytes,
          usagePercent: parseFloat(diskPercent.toFixed(1))
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

// Helper to log alerts to backend/alerts.log
const logAlertToFile = async (alert) => {
  try {
    const logPath = path.join(process.cwd(), 'alerts.log');
    const logLine = `[${alert.timestamp.toISOString()}] [ALERT] Server: ${alert.serverName} (${alert.serverId}) | Type: ${alert.metricType} | Value: ${alert.metricValue}% (Threshold: ${alert.threshold}%)\n`;
    await fs.promises.appendFile(logPath, logLine);
  } catch (error) {
    console.error('Error logging alert to file:', error);
  }
};

// Send email using nodemailer
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
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Server Analysis Alerts" <${SMTP_USER}>`,
      to: ALERT_EMAIL_RECIPIENT,
      subject: `🚨 CRITICAL ALERT: Server ${alert.serverName} ${alert.metricType} Usage Exceeds 90%`,
      text: `Critical resource usage detected on server:
Server Name: ${alert.serverName}
Server ID: ${alert.serverId}
Resource Type: ${alert.metricType}
Current Usage: ${alert.metricValue}% (Threshold: ${alert.threshold}%)
Timestamp: ${alert.timestamp.toISOString()}
Please investigate immediately.`,
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #b87158; border-radius: 8px; max-width: 600px; background-color: #f7f6f2; color: #2c2b29;">
        <h2 style="color: #b87158; margin-top: 0; font-weight: 600;">🚨 CRITICAL RESOURCE ALERT</h2>
        <p>Critical resource usage has been detected on your server fleet:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Server Name:</td>
            <td style="padding: 8px; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">${alert.serverName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Server ID:</td>
            <td style="padding: 8px; border-bottom: 1px solid rgba(168, 132, 72, 0.12);"><code>${alert.serverId}</code></td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Resource:</td>
            <td style="padding: 8px; color: #b87158; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">${alert.metricType}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Current Usage:</td>
            <td style="padding: 8px; color: #b87158; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">${alert.metricValue}%</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Threshold:</td>
            <td style="padding: 8px; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">${alert.threshold}%</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">Timestamp:</td>
            <td style="padding: 8px; border-bottom: 1px solid rgba(168, 132, 72, 0.12);">${alert.timestamp.toLocaleString()}</td>
          </tr>
        </table>
        <p style="font-size: 11px; color: #9c9790; margin-top: 25px; border-top: 1px solid rgba(168, 132, 72, 0.12); padding-top: 10px;">
          This message was triggered automatically by Server Analysis Analytics.
        </p>
      </div>`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[ALERT EMAIL] Sent email alert. Message ID: ${info.messageId}`);
  } catch (error) {
    console.error('[ALERT EMAIL ERROR] Failed to send email alert:', error);
  }
};

// Send webhook slack/discord message
const sendAlertMessage = async (alert) => {
  const { SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL } = process.env;

  if (!SLACK_WEBHOOK_URL && !DISCORD_WEBHOOK_URL) {
    console.log(`[ALERT WEBHOOK SIMULATION] Webhook not configured. Logged alert: Server ${alert.serverName} is using ${alert.metricValue}% ${alert.metricType}`);
    return;
  }

  try {
    const payload = {
      text: `🚨 *CRITICAL RESOURCE ALERT* 🚨\n*Server*: ${alert.serverName} (\`${alert.serverId}\`)\n*Resource*: ${alert.metricType}\n*Usage*: *${alert.metricValue}%* (Threshold: ${alert.threshold}%)\n*Timestamp*: ${alert.timestamp.toLocaleString()}`
    };

    const url = SLACK_WEBHOOK_URL || DISCORD_WEBHOOK_URL;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[ALERT WEBHOOK ERROR] Webhook server responded with status: ${response.status}`);
    } else {
      console.log(`[ALERT WEBHOOK] Sent message alert to webhook successfully.`);
    }
  } catch (error) {
    console.error('[ALERT WEBHOOK ERROR] Failed to send webhook alert:', error);
  }
};

const triggerAlertNotifications = async (alert) => {
  await logAlertToFile(alert);
  await sendAlertEmail(alert);
  await sendAlertMessage(alert);
};

// 1. Log metrics from a server
router.post('/', async (req, res) => {
  try {
    const { serverId, serverName, cpuUsage, ramUsage, loadAverage, cpuCores, diskUsage, timestamp } = req.body;
    
    if (!serverId || !serverName || cpuUsage === undefined || !ramUsage || !loadAverage) {
      return res.status(400).json({ error: 'Missing required metrics fields.' });
    }

    let parsedDisk = undefined;
    if (diskUsage) {
      parsedDisk = {
        totalBytes: parseInt(diskUsage.totalBytes),
        usedBytes: parseInt(diskUsage.usedBytes),
        usagePercent: parseFloat(diskUsage.usagePercent)
      };
    } else {
      const diskPct = 40 + Math.random() * 20;
      const totalGB = (serverName.toLowerCase().includes('db') || serverName.toLowerCase().includes('mongo') || serverName.toLowerCase().includes('mysql')) ? 500 : 250;
      const totalBytes = totalGB * 1024 * 1024 * 1024;
      const usedBytes = Math.round((diskPct / 100) * totalBytes);
      parsedDisk = {
        totalBytes,
        usedBytes,
        usagePercent: parseFloat(diskPct.toFixed(1))
      };
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
      diskUsage: parsedDisk,
      loadAverage: {
        oneMin: parseFloat(loadAverage.oneMin),
        fiveMin: parseFloat(loadAverage.fiveMin),
        fifteenMin: parseFloat(loadAverage.fifteenMin)
      },
      cpuCores: cpuCores ? parseInt(cpuCores) : undefined,
      timestamp: timestamp ? new Date(timestamp) : new Date()
    };

    if (isMongoConnected()) {
      const existingCount = await ServerMetric.countDocuments({ serverId });
      if (existingCount === 0 && process.env.SEED_DUMMY_HISTORY === 'true') {
        console.log(`[DB API] Seeding 7 weeks of history in MongoDB for new server: ${serverId}`);
        const now = Date.now();
        const sevenWeeksMs = 7 * 7 * 24 * 60 * 60 * 1000;
        const intervalMs = 30 * 60 * 1000; // 30 min intervals
        const serverMetricsToInsert = [];
        
        for (let offset = sevenWeeksMs; offset > 0; offset -= intervalMs) {
          const timestamp = new Date(now - offset);
          const hour = timestamp.getHours();
          let modifier = 1.0;
          if (hour >= 14 && hour <= 20) {
            modifier += 1.5 + Math.random() * 0.5;
          } else if (hour >= 1 && hour <= 5) {
            modifier -= 0.6;
          }
          const baseCpu = payload.cpuUsage || 25;
          const ramTotalGB = payload.ramUsage?.totalBytes ? (payload.ramUsage.totalBytes / (1024 * 1024 * 1024)) : 16;

          const cpu = Math.min(98, Math.max(2, baseCpu * modifier + (Math.random() * 10 - 5)));
          const ramPercent = Math.min(95, Math.max(10, (payload.ramUsage?.usagePercent || 50) + (Math.random() * 6 - 3)));
          const totalBytes = ramTotalGB * 1024 * 1024 * 1024;
          const usedBytes = Math.round((ramPercent / 100) * totalBytes);
          const load1m = parseFloat((cpu / 50 + Math.random() * 0.5).toFixed(2));

          const diskTotalGB = payload.diskUsage?.totalBytes ? (payload.diskUsage.totalBytes / (1024 * 1024 * 1024)) : (serverId.includes('db') || serverId.includes('mongo') || serverId.includes('mysql') ? 500 : 250);
          const diskTotalBytes = diskTotalGB * 1024 * 1024 * 1024;
          const diskPercent = Math.min(95, Math.max(10, (payload.diskUsage?.usagePercent || (serverId.includes('db') ? 60 : 40)) + (Math.random() * 8 - 4)));
          const diskUsedBytes = Math.round((diskPercent / 100) * diskTotalBytes);

          serverMetricsToInsert.push({
            serverId,
            serverName,
            cpuUsage: parseFloat(cpu.toFixed(1)),
            ramUsage: {
              totalBytes,
              usedBytes,
              usagePercent: parseFloat(ramPercent.toFixed(1))
            },
            diskUsage: {
              totalBytes: diskTotalBytes,
              usedBytes: diskUsedBytes,
              usagePercent: parseFloat(diskPercent.toFixed(1))
            },
            loadAverage: {
              oneMin: load1m,
              fiveMin: parseFloat((load1m * 0.9 + Math.random() * 0.2).toFixed(2)),
              fifteenMin: parseFloat((load1m * 0.85 + Math.random() * 0.1).toFixed(2))
            },
            timestamp
          });
        }
        await ServerMetric.insertMany(serverMetricsToInsert);
      }
      const metric = new ServerMetric(payload);
      await metric.save();
    } else {
      const hasHistory = inMemoryMetrics.some(m => m.serverId === serverId);
      if (!hasHistory && process.env.SEED_DUMMY_HISTORY === 'true') {
        console.log(`[In-Memory API] Seeding 7 weeks of history for new server: ${serverId}`);
        const now = Date.now();
        const sevenWeeksMs = 7 * 7 * 24 * 60 * 60 * 1000;
        const intervalMs = 30 * 60 * 1000; // 30 min intervals
        
        for (let offset = sevenWeeksMs; offset > 0; offset -= intervalMs) {
          const timestamp = new Date(now - offset);
          const hour = timestamp.getHours();
          let modifier = 1.0;
          if (hour >= 14 && hour <= 20) {
            modifier += 1.5 + Math.random() * 0.5;
          } else if (hour >= 1 && hour <= 5) {
            modifier -= 0.6;
          }
          const baseCpu = payload.cpuUsage || 25;
          const ramTotalGB = payload.ramUsage?.totalBytes ? (payload.ramUsage.totalBytes / (1024 * 1024 * 1024)) : 16;

          const cpu = Math.min(98, Math.max(2, baseCpu * modifier + (Math.random() * 10 - 5)));
          const ramPercent = Math.min(95, Math.max(10, (payload.ramUsage?.usagePercent || 50) + (Math.random() * 6 - 3)));
          const totalBytes = ramTotalGB * 1024 * 1024 * 1024;
          const usedBytes = Math.round((ramPercent / 100) * totalBytes);
          const load1m = parseFloat((cpu / 50 + Math.random() * 0.5).toFixed(2));

          const diskTotalGB = payload.diskUsage?.totalBytes ? (payload.diskUsage.totalBytes / (1024 * 1024 * 1024)) : (serverId.includes('db') || serverId.includes('mongo') || serverId.includes('mysql') ? 500 : 250);
          const diskTotalBytes = diskTotalGB * 1024 * 1024 * 1024;
          const diskPercent = Math.min(95, Math.max(10, (payload.diskUsage?.usagePercent || (serverId.includes('db') ? 60 : 40)) + (Math.random() * 8 - 4)));
          const diskUsedBytes = Math.round((diskPercent / 100) * diskTotalBytes);

          inMemoryMetrics.push({
            serverId,
            serverName,
            cpuUsage: parseFloat(cpu.toFixed(1)),
            ramUsage: {
              totalBytes,
              usedBytes,
              usagePercent: parseFloat(ramPercent.toFixed(1))
            },
            diskUsage: {
              totalBytes: diskTotalBytes,
              usedBytes: diskUsedBytes,
              usagePercent: parseFloat(diskPercent.toFixed(1))
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

      // In-memory fallback: append and prune oldest if too large
      inMemoryMetrics.push(payload);
      if (inMemoryMetrics.length > 10000) {
        inMemoryMetrics.shift();
      }
      console.log(`[In-Memory API] Logged metrics for ${serverId}`);
    }

    // Check thresholds (>=90%)
    const triggerAlert = async (type, val) => {
      const alertPayload = {
        serverId,
        serverName,
        metricType: type,
        metricValue: parseFloat(val.toFixed(1)),
        threshold: 90,
        timestamp: new Date(),
        resolved: false
      };

      if (isMongoConnected()) {
        const newAlert = new Alert(alertPayload);
        await newAlert.save();
      } else {
        inMemoryAlerts.push(alertPayload);
        if (inMemoryAlerts.length > 500) {
          inMemoryAlerts.shift(); // Prune old alerts
        }
      }

      await triggerAlertNotifications(alertPayload);
    };

    const nowTime = Date.now();

    // CPU Alert Trigger
    if (payload.cpuUsage >= 90) {
      if (!lastAlertedTimes[serverId]) lastAlertedTimes[serverId] = {};
      const lastCpuAlert = lastAlertedTimes[serverId]['CPU'];
      if (!lastCpuAlert || (nowTime - lastCpuAlert > ALERT_THROTTLE_MS)) {
        lastAlertedTimes[serverId]['CPU'] = nowTime;
        await triggerAlert('CPU', payload.cpuUsage);
      }
    }

    // RAM Alert Trigger
    if (payload.ramUsage.usagePercent >= 90) {
      if (!lastAlertedTimes[serverId]) lastAlertedTimes[serverId] = {};
      const lastRamAlert = lastAlertedTimes[serverId]['RAM'];
      if (!lastRamAlert || (nowTime - lastRamAlert > ALERT_THROTTLE_MS)) {
        lastAlertedTimes[serverId]['RAM'] = nowTime;
        await triggerAlert('RAM', payload.ramUsage.usagePercent);
      }
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
        { $match: { serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$serverId',
            serverId: { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            cpuUsage: { $first: '$cpuUsage' },
            ramUsage: { $first: '$ramUsage' },
            diskUsage: { $first: '$diskUsage' },
            loadAverage: { $first: '$loadAverage' },
            cpuCores: { $first: '$cpuCores' },
            timestamp: { $first: '$timestamp' },
          }
        },
        { $sort: { serverName: 1 } }
      ]);
      return res.json(servers);
    } else {
      // In-memory fallback
      const current = {};
      inMemoryMetrics.forEach(m => {
        if (!isDummyServer(m.serverId)) {
          current[m.serverId] = m;
        }
      });
      const sortedCurrent = Object.values(current).sort((a, b) => 
        (a.serverName || '').localeCompare(b.serverName || '')
      );
      return res.json(sortedCurrent);
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
        { 
          $match: { 
            serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ },
            timestamp: { $gte: twentyFourHoursAgo } 
          } 
        },
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
      const recent = inMemoryMetrics.filter(m => !isDummyServer(m.serverId) && new Date(m.timestamp).getTime() >= twentyFourHoursAgo);
      
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
        { 
          $match: { 
            serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ },
            timestamp: { $gte: sevenDaysAgo } 
          } 
        },
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
      const recent = inMemoryMetrics.filter(m => !isDummyServer(m.serverId) && new Date(m.timestamp).getTime() >= sevenDaysAgo);
      
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

// 3.6. Get monthly cluster analytics (aggregated daily for 30 days)
router.get('/history-monthly', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { 
          $match: { 
            serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ },
            timestamp: { $gte: thirtyDaysAgo } 
          } 
        },
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
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recent = inMemoryMetrics.filter(m => !isDummyServer(m.serverId) && new Date(m.timestamp).getTime() >= thirtyDaysAgo);
      
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

      const list = Object.values(dailyGroups).map(group => {
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

      return res.json(list);
    }
  } catch (error) {
    console.error('Error fetching monthly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3.7. Get weekly server analytics for single server (aggregated daily for 7 days)
router.get('/server-history-weekly', async (req, res) => {
  const { serverId } = req.query;
  if (!serverId) {
    return res.status(400).json({ error: 'Missing serverId parameter.' });
  }
  try {
    if (isMongoConnected()) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const history = await ServerMetric.aggregate([
        { 
          $match: { 
            serverId: serverId,
            timestamp: { $gte: sevenDaysAgo } 
          } 
        },
        {
          $project: {
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
              year: '$year',
              month: '$month',
              day: '$day'
            },
            avgCpuUsage: { $avg: '$cpuUsage' },
            maxRamUsagePercent: { $max: '$ramUsagePercent' },
            avgLoad: { $avg: '$loadAverageOneMin' }
          }
        },
        {
          $project: {
            _id: 0,
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
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
      const recent = inMemoryMetrics.filter(m => m.serverId === serverId && new Date(m.timestamp).getTime() >= sevenDaysAgo);
      
      const dailyGroups = {};
      recent.forEach(m => {
        const d = new Date(m.timestamp);
        const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        if (!dailyGroups[dateKey]) {
          dailyGroups[dateKey] = {
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

      const list = Object.values(dailyGroups).map(group => {
        const count = group.loads.length;
        const sum = arr => arr.reduce((a, b) => a + b, 0);
        const max = arr => Math.max(...arr);

        return {
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

      return res.json(list);
    }
  } catch (error) {
    console.error('Error fetching server weekly history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3.8. Get combustion summary for all servers (counts, 24h peaks, 7d peaks above 80%)
router.get('/combustion-summary', async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenWeeksAgo = new Date(Date.now() - 7 * 7 * 24 * 60 * 60 * 1000);

    const computeSummaryPayload = (serverSummaries) => {
      let current80Count = 0;
      let current90Count = 0;
      let peak24h80Count = 0;
      let peak24h90Count = 0;
      let peak7d80Count = 0;
      let peak7d90Count = 0;

      const above80in24h = [];
      const above80in7d = [];

      serverSummaries.forEach(s => {
        // Current
        const maxCurrent = Math.max(s.currentCpu, s.currentRam);
        if (maxCurrent >= 90) current90Count++;
        if (maxCurrent >= 80) current80Count++;

        // 24h
        const max24h = Math.max(s.maxCpu24h, s.maxRam24h);
        if (max24h >= 90) peak24h90Count++;
        if (max24h >= 80) {
          peak24h80Count++;
          above80in24h.push({
            serverId: s.serverId,
            serverName: s.serverName,
            maxCpu: s.maxCpu24h,
            maxRam: s.maxRam24h,
            peakValue: max24h
          });
        }

        // 7d
        const max7d = Math.max(s.maxCpu7d, s.maxRam7d);
        if (max7d >= 90) peak7d90Count++;
        if (max7d >= 80) {
          peak7d80Count++;
          above80in7d.push({
            serverId: s.serverId,
            serverName: s.serverName,
            maxCpu: s.maxCpu7d,
            maxRam: s.maxRam7d,
            peakValue: max7d
          });
        }
      });

      above80in24h.sort((a, b) => b.peakValue - a.peakValue);
      above80in7d.sort((a, b) => b.peakValue - a.peakValue);

      return {
        serverSummaries,
        above80in24h,
        above80in7d,
        counts: {
          current80Count,
          current90Count,
          peak24h80Count,
          peak24h90Count,
          peak7d80Count,
          peak7d90Count
        }
      };
    };

    if (isMongoConnected()) {
      // 1. Current metrics per server
      const currentServers = await ServerMetric.aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$serverId',
            serverId: { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            cpuUsage: { $first: '$cpuUsage' },
            ramUsagePercent: { $first: '$ramUsage.usagePercent' }
          }
        }
      ]);

      // 2. Max metrics in last 24h per server
      const metrics24h = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: twentyFourHoursAgo } } },
        {
          $group: {
            _id: '$serverId',
            serverId: { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            maxCpu: { $max: '$cpuUsage' },
            maxRam: { $max: '$ramUsage.usagePercent' }
          }
        }
      ]);

      // 3. Max metrics in last 7w (49 days) per server
      const metrics7d = await ServerMetric.aggregate([
        { $match: { timestamp: { $gte: sevenWeeksAgo } } },
        {
          $group: {
            _id: '$serverId',
            serverId: { $first: '$serverId' },
            serverName: { $first: '$serverName' },
            maxCpu: { $max: '$cpuUsage' },
            maxRam: { $max: '$ramUsage.usagePercent' }
          }
        }
      ]);

      const currentMap = {};
      currentServers.forEach(s => {
        currentMap[s.serverId] = s;
      });

      const map24h = {};
      metrics24h.forEach(s => {
        map24h[s.serverId] = s;
      });

      const map7d = {};
      metrics7d.forEach(s => {
        map7d[s.serverId] = s;
      });

      const serverSummaries = [];
      const allServerIds = Array.from(new Set([
        ...currentServers.map(s => s.serverId),
        ...metrics24h.map(s => s.serverId),
        ...metrics7d.map(s => s.serverId)
      ])).filter(id => !isDummyServer(id));

      allServerIds.forEach(serverId => {
        const current = currentMap[serverId] || { cpuUsage: 0, ramUsagePercent: 0, serverName: serverId };
        const m24h = map24h[serverId] || { maxCpu: 0, maxRam: 0, serverName: current.serverName };
        const m7d = map7d[serverId] || { maxCpu: 0, maxRam: 0, serverName: current.serverName };

        serverSummaries.push({
          serverId,
          serverName: current.serverName,
          currentCpu: current.cpuUsage,
          currentRam: current.ramUsagePercent,
          maxCpu24h: m24h.maxCpu,
          maxRam24h: m24h.maxRam,
          maxCpu7d: m7d.maxCpu,
          maxRam7d: m7d.maxRam
        });
      });

      return res.json(computeSummaryPayload(serverSummaries));
    } else {
      // In-Memory Fallback
      const nowTime = Date.now();
      const m24hList = inMemoryMetrics.filter(m => !isDummyServer(m.serverId) && new Date(m.timestamp).getTime() >= (nowTime - 24 * 60 * 60 * 1000));
      const m7dList = inMemoryMetrics.filter(m => !isDummyServer(m.serverId) && new Date(m.timestamp).getTime() >= (nowTime - 7 * 7 * 24 * 60 * 60 * 1000));

      const serverSummariesMap = {};

      const getOrInit = (serverId, serverName) => {
        if (!serverSummariesMap[serverId]) {
          serverSummariesMap[serverId] = {
            serverId,
            serverName,
            currentCpu: 0,
            currentRam: 0,
            maxCpu24h: 0,
            maxRam24h: 0,
            maxCpu7d: 0,
            maxRam7d: 0
          };
        }
        return serverSummariesMap[serverId];
      };

      const current = {};
      inMemoryMetrics.forEach(m => {
        if (!isDummyServer(m.serverId)) {
          current[m.serverId] = m;
        }
      });
      Object.values(current).forEach(m => {
        const s = getOrInit(m.serverId, m.serverName);
        s.currentCpu = m.cpuUsage;
        s.currentRam = m.ramUsage.usagePercent;
      });

      m24hList.forEach(m => {
        const s = getOrInit(m.serverId, m.serverName);
        if (m.cpuUsage > s.maxCpu24h) s.maxCpu24h = m.cpuUsage;
        if (m.ramUsage.usagePercent > s.maxRam24h) s.maxRam24h = m.ramUsage.usagePercent;
      });

      m7dList.forEach(m => {
        const s = getOrInit(m.serverId, m.serverName);
        if (m.cpuUsage > s.maxCpu7d) s.maxCpu7d = m.cpuUsage;
        if (m.ramUsage.usagePercent > s.maxRam7d) s.maxRam7d = m.ramUsage.usagePercent;
      });

      return res.json(computeSummaryPayload(Object.values(serverSummariesMap)));
    }
  } catch (error) {
    console.error('Error computing combustion summary:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 4. Time of day analysis across all servers
router.get('/peak-analysis', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const analysis = await ServerMetric.aggregate([
        { $match: { serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ } } },
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
      
      const filteredMetrics = inMemoryMetrics.filter(m => !isDummyServer(m.serverId));
      filteredMetrics.forEach(m => {
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

// 5. Get recent alerts feed
router.get('/alerts', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const alerts = await Alert.find({ serverId: { $not: /^(web-server-|db-server-|cache-server-|test-server-|preview-vm-)/ } }).sort({ timestamp: -1 }).limit(50);
      return res.json(alerts);
    } else {
      // Return memory alerts sorted newest first
      const alerts = [...inMemoryAlerts].filter(a => !isDummyServer(a.serverId)).reverse();
      return res.json(alerts);
    }
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 6. Clear alert history
router.post('/alerts/clear', async (req, res) => {
  try {
    if (isMongoConnected()) {
      await Alert.deleteMany({});
    } else {
      inMemoryAlerts = [];
    }
    return res.json({ success: true, message: 'All alerts cleared successfully.' });
  } catch (error) {
    console.error('Error clearing alerts:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 7. Get 24-hour history for a specific server
router.get('/server-history-24h', async (req, res) => {
  const { serverId } = req.query;
  if (!serverId) {
    return res.status(400).json({ error: 'Missing serverId parameter.' });
  }
  try {
    if (isMongoConnected()) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const history = await ServerMetric.find({
        serverId,
        timestamp: { $gte: twentyFourHoursAgo }
      }).sort({ timestamp: 1 });
      
      const hourlyData = {};
      history.forEach(m => {
        const d = new Date(m.timestamp);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
        if (!hourlyData[key]) {
          hourlyData[key] = {
            timestamp: m.timestamp,
            cpuUsage: [],
            ramUsagePercent: [],
            loadOneMin: [],
            hour: d.getHours()
          };
        }
        hourlyData[key].cpuUsage.push(m.cpuUsage);
        hourlyData[key].ramUsagePercent.push(m.ramUsage.usagePercent);
        hourlyData[key].loadOneMin.push(m.loadAverage.oneMin);
      });

      const formatted = Object.values(hourlyData).map(h => {
        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        return {
          timeLabel: `${h.hour.toString().padStart(2, '0')}:00`,
          cpuUsage: parseFloat(avg(h.cpuUsage).toFixed(1)),
          ramUsage: parseFloat(avg(h.ramUsagePercent).toFixed(1)),
          loadAverage: parseFloat(avg(h.loadOneMin).toFixed(2))
        };
      });
      
      return res.json(formatted);
    } else {
      // In-memory fallback
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = inMemoryMetrics.filter(m => m.serverId === serverId && new Date(m.timestamp).getTime() >= twentyFourHoursAgo);
      
      const hourlyData = {};
      recent.forEach(m => {
        const d = new Date(m.timestamp);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
        if (!hourlyData[key]) {
          hourlyData[key] = {
            cpuUsage: [],
            ramUsagePercent: [],
            loadOneMin: [],
            hour: d.getHours()
          };
        }
        hourlyData[key].cpuUsage.push(m.cpuUsage);
        hourlyData[key].ramUsagePercent.push(m.ramUsage.usagePercent);
        hourlyData[key].loadOneMin.push(m.loadAverage.oneMin);
      });

      const formatted = Object.values(hourlyData).map(h => {
        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        return {
          timeLabel: `${h.hour.toString().padStart(2, '0')}:00`,
          cpuUsage: parseFloat(avg(h.cpuUsage).toFixed(1)),
          ramUsage: parseFloat(avg(h.ramUsagePercent).toFixed(1)),
          loadAverage: parseFloat(avg(h.loadOneMin).toFixed(2))
        };
      });

      return res.json(formatted);
    }
  } catch (error) {
    console.error('Error fetching server history:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
