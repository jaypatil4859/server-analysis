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
        PORT: 5000,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/server_analysis'
      }
    }
  ]
};
