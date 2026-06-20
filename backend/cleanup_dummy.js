import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ServerMetric from './models/ServerMetric.js';
import Alert from './models/Alert.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

async function cleanup() {
  try {
    console.log(`Connecting to MongoDB at: ${MONGODB_URI}`);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected successfully. Cleaning up dummy data...');

    // Regex to match dummy servers starting with: web-server-, db-server-, cache-server-
    const dummyRegex = /^(web-server-|db-server-|cache-server-)/;

    // Delete metrics
    const metricsResult = await ServerMetric.deleteMany({ serverId: dummyRegex });
    console.log(`Deleted ${metricsResult.deletedCount} ServerMetric documents belonging to dummy servers.`);

    // Delete alerts
    const alertsResult = await Alert.deleteMany({ serverId: dummyRegex });
    console.log(`Deleted ${alertsResult.deletedCount} Alert documents belonging to dummy servers.`);

    console.log('Cleanup completed successfully!');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
}

cleanup();
