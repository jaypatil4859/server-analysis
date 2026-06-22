module.exports = {
  apps: [
    {
      name: 'serverpulse-backend',
      script: './server.js',
      cwd: './backend',
      instances: 'max', // Utilizes all available CPU cores
      exec_mode: 'cluster', // Enables load-balanced cluster mode
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3971,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/server_analysis'
      }
    },
    {
      name: 'serverpulse-ssh-collector',
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
