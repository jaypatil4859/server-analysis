module.exports = {
  apps: [
    // ─── Backend API Server ────────────────────────────────────────────────────
    {
      name:          'server-analysis-backend',
      script:        './backend/server.js',
      max_restarts:  50,
      min_uptime:    '5s',
      restart_delay: 2000,
      kill_timeout:  5000,
      watch:         false,
      env: {
        NODE_ENV:    'production',
        PORT:        3971,
        MONGODB_URI: 'mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin',
        SEED_DUMMY_HISTORY: 'false',
      }
    },

    // ─── Nagios Bridge (Data Collector) ───────────────────────────────────────
    // Runs 24/7 on the SERVER — NOT on the DevOps laptop.
    // This is what pushes metrics from Nagios → MongoDB every 20 seconds.
    // Self-healing: exits on crash so PM2 auto-restarts it.
    {
      name:          'server-analysis-nagios-bridge',
      script:        './nagios-bridge.js',
      max_restarts:  500,    // allow many restarts — bridge intentionally exits on watchdog
      min_uptime:    '10s',  // if it dies before 10s, count as a crash
      restart_delay: 3000,   // 3s between restarts to avoid hammering Nagios
      kill_timeout:  8000,
      watch:         false,
      env: {
        NODE_ENV:            'production',
        NAGIOS_URL:          'http://217.145.69.228/nagios',
        NAGIOS_USER:         'nagiosadmin',
        NAGIOS_PASS:         '4z1lO3lXxNa$',
        METRICS_API_URL:     'http://localhost:3971/api/metrics',
        MONGODB_URI:         'mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin',
        POLL_INTERVAL_MS:    '20000',
        WATCHDOG_TIMEOUT_MS: '90000',
      }
    }
  ]
};
