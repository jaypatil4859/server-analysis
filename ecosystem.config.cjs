module.exports = {
  apps: [
    {
      name:          'server-analysis-backend',
      script:        './backend/server.js',
      max_restarts:  50,
      min_uptime:    '5s',
      restart_delay: 2000,
      kill_timeout:  5000,
      watch:         false,
      env: {
        NODE_ENV: 'production',
        PORT:     3971
      }
    },
    {
      name:          'server-analysis-nagios-bridge',
      script:        './nagios-bridge.js',
      max_restarts:  100,   // bridge exits intentionally on hangs — allow many restarts
      min_uptime:    '10s', // if it dies before 10s, count as a crash
      restart_delay: 3000,  // wait 3s between restarts to avoid hammering Nagios
      kill_timeout:  8000,
      watch:         false,
      env: {
        NODE_ENV:          'production',
        POLL_INTERVAL_MS:  '20000',
        WATCHDOG_TIMEOUT_MS: '90000'
      }
    }
  ]
};
