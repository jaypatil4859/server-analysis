module.exports = {
  apps: [
    {
      name: 'server-analysis-backend',
      script: './backend/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3971
      }
    },
    {
      name: 'server-analysis-nagios-bridge',
      script: './nagios-bridge.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
