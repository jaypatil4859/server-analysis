module.exports = {
  apps: [
    {
      name: 'server-analysis-backend',
      script: './server.js',
      cwd: './backend',
      instances: 'max', // Utilizes all available CPU cores
      exec_mode: 'cluster', // Enables load-balanced cluster mode
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3971
        // MONGODB_URI is loaded from backend/.env so it is configurable and not overridden by PM2
      }
    },
    {
      name: 'server-analysis-frontend',
      script: './node_modules/vite/bin/vite.js',
      args: 'preview',
      cwd: './frontend',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'server-analysis-ssh-collector',
      script: './ssh-collector.js',
      cwd: './',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        METRICS_API_URL: 'http://localhost:3971/api/metrics',
        POLL_INTERVAL_MS: 10000, // Real-time poll interval (10 seconds)
        SSH_USER: 'root', // DevOps SSH connection user
        SSH_KEY_PATH: '/home/devops/.ssh/id_rsa' // DevOps SSH private key location
      }
    }
  ]
};
