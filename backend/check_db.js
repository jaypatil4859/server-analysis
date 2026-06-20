import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ServerMetric from './models/ServerMetric.js';

dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to DB');
    const servers = await ServerMetric.distinct('serverName');
    console.log('Distinct server names:', servers);
    const ids = await ServerMetric.distinct('serverId');
    console.log('Distinct server IDs:', ids);
    const count = await ServerMetric.countDocuments();
    console.log('Total metrics count:', count);
    
    // Print the most recent entry for each distinct serverId
    const current = await ServerMetric.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$serverId',
          serverId: { $first: '$serverId' },
          serverName: { $first: '$serverName' },
          timestamp: { $first: '$timestamp' }
        }
      }
    ]);
    console.log('Latest metrics per server:', current);

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}
run();
