const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);

// Load dotenv from backend if available, or current folder
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed in root, look in backend
  const envPath = path.join(__dirname, 'backend', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
}

// Load configs from environment
const SSH_USER = process.env.SSH_USER || 'root';
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '';

// Target hosts to detect specifications for
const SERVERS = [
  { id: 'in31', host: '180.187.54.31' },
  { id: 'in44', host: '180.187.54.44' },
  { id: 'newmongo', host: '161.248.37.104' },
  { id: 'newprod', host: '161.248.37.102' },
  { id: 'newprodp1', host: '161.248.37.181' },
  { id: 'newprodp2', host: '161.248.37.103' },
  { id: 'newprodp3', host: '43.113.189.106' },
  { id: 'punctualiti-co', host: '43.242.212.71' },
  { id: 'rahehamysql', host: '161.248.37.87' },
  { id: 'raheja-app', host: '161.248.37.85' },
  { id: 'rahejamongo', host: '161.248.37.86' },
  { id: 'sgdb', host: '154.210.160.250' },
  { id: 'sify-app', host: '100.85.117.165' }
];

async function detectSpecs(server) {
  const host = server.host;
  
  // SSH command to retrieve CPU cores, Total RAM (bytes), Total Disk (bytes) of /
  const remoteCmd = "nproc && grep MemTotal /proc/meminfo && df -B1 / | tail -n 1";
  
  let sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5`;
  if (SSH_KEY_PATH) {
    sshCmd += ` -i ${SSH_KEY_PATH}`;
  }
  sshCmd += ` ${SSH_USER}@${host} "${remoteCmd}"`;

  try {
    const { stdout } = await execPromise(sshCmd);
    const lines = stdout.trim().split('\n');
    if (lines.length < 3) {
      throw new Error('Incomplete command output returned from remote host.');
    }

    // 1. CPU Cores
    const cores = parseInt(lines[0].trim(), 10);

    // 2. RAM Size
    const memParts = lines[1].trim().split(/\s+/);
    const ramKB = parseInt(memParts[1], 10);
    const ramGB = Math.round(ramKB / 1024 / 1024);

    // 3. Disk Size
    const diskParts = lines[2].trim().split(/\s+/);
    const diskBytes = parseInt(diskParts[1], 10);
    const diskGB = Math.round(diskBytes / 1024 / 1024 / 1024);

    return { cores, ramGB, diskGB };
  } catch (err) {
    throw new Error(err.message);
  }
}

async function run() {
  console.log(`Starting dynamic specifications discovery...`);
  console.log(`Using SSH user: ${SSH_USER}`);
  console.log(`Using SSH key: ${SSH_KEY_PATH || 'default system key'}`);
  console.log(`Probing ${SERVERS.length} servers...\n`);

  const results = {};

  const probes = SERVERS.map(async (server) => {
    try {
      const specs = await detectSpecs(server);
      results[server.id] = specs;
      console.log(`[Success] ${server.id} (${server.host}) detected: ${specs.cores} CPU Cores, ${specs.ramGB} GB RAM, ${specs.diskGB} GB Disk`);
    } catch (err) {
      console.error(`[Failed]  ${server.id} (${server.host}): ${err.message}`);
    }
  });

  await Promise.all(probes);

  console.log('\n================== DETECTED SPECIFICATIONS CONFIG ==================');
  console.log(JSON.stringify(results, null, 2));
  console.log('====================================================================\n');
  
  // Also write to a local config file for ease of use
  const configPath = path.join(__dirname, 'detected-specs.json');
  fs.writeFileSync(configPath, JSON.stringify(results, null, 2));
  console.log(`Specs written successfully to: ${configPath}`);
}

run();
