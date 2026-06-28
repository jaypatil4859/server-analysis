const path = require('path');
const fs = require('fs');
const os = require('os');

const isWindows = os.platform() === 'win32';

// ── Read env files to extract secrets ─────────────────────────────────────────
function readEnvFile(filePath) {
  const vars = {};
  try {
    if (fs.existsSync(filePath)) {
      fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
          }
        }
      });
    }
  } catch (e) { /* ignore */ }
  return vars;
}

const rootEnv   = readEnvFile(path.join(__dirname, '.env'));
const backendEnv = readEnvFile(path.join(__dirname, 'backend', '.env'));

const nagiosPass = rootEnv.NAGIOS_PASS   || '4z1lO3lXxNa$';
const mongoUri   = backendEnv.MONGODB_URI || rootEnv.MONGODB_URI ||
  'mongodb://admin:dMY8Rp0(K9S7Hy@217.145.69.228:27017/server_analysis?authSource=admin';

// Paths
const ROOT      = __dirname;
const BACKEND   = path.join(ROOT, 'backend');
const FRONTEND  = path.join(ROOT, 'frontend');
const VITE_BIN  = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');

const apps = [
  // ─── Backend REST API ──────────────────────────────────────────────────────
  {
    name: 'server-analysis-backend',
    interpreter: 'node',
    script: path.join(BACKEND, 'server.js'),
    cwd: BACKEND,
    instances: isWindows ? 1 : 'max', // Use cluster mode on Linux/Mac, fork on Windows
    exec_mode: isWindows ? 'fork' : 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3971,
      MONGODB_URI: mongoUri
    }
  },

  // ─── Nagios Bridge ────────────────────────────────────────────────────────
  // PRIMARY data source. Polls Nagios every 30s → pushes to backend REST API.
  {
    name: 'server-analysis-nagios-bridge',
    interpreter: 'node',
    script: path.join(ROOT, 'nagios-bridge.js'),
    cwd: ROOT,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      METRICS_API_URL: 'http://localhost:3971/api/metrics',
      POLL_INTERVAL_MS: 30000,
      NAGIOS_URL: rootEnv.NAGIOS_URL || 'http://217.145.69.228/nagios',
      NAGIOS_USER: rootEnv.NAGIOS_USER || 'nagiosadmin',
      NAGIOS_PASS: nagiosPass,
      MONGODB_URI: mongoUri
    }
  }
];

// ─── Frontend — Vite Preview Server ─────────────────────────────────────────
// Only started under PM2 if Vite is installed in node_modules.
// On production Linux servers using Nginx reverse proxy, Nginx serves frontend/dist/
// directly, so Vite preview in PM2 is not needed.
if (fs.existsSync(VITE_BIN)) {
  apps.push({
    name: 'server-analysis-frontend',
    interpreter: 'node',
    script: VITE_BIN,
    args: 'preview',
    cwd: FRONTEND,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  });
} else {
  console.log('[PM2 Config] Vite is not installed in frontend/node_modules.');
  console.log('[PM2 Config] Skipping server-analysis-frontend PM2 app.');
  console.log('[PM2 Config] Nginx/Apache should serve the built "frontend/dist" directory directly.');
}

module.exports = { apps };
