import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import ServerMetric from './models/ServerMetric.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';
const defaultDumpPath = path.resolve('dump.json');

async function restore() {
  try {
    const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultDumpPath;
    
    if (!fs.existsSync(sourcePath)) {
      console.error(`\x1b[31mERROR: Dump file not found at ${sourcePath}\x1b[0m`);
      process.exit(1);
    }

    console.log(`Reading metrics from ${sourcePath}...`);
    const fileContent = fs.readFileSync(sourcePath, 'utf8');
    const metrics = JSON.parse(fileContent);

    if (!Array.isArray(metrics)) {
      throw new Error('Dump file content is not a valid JSON array.');
    }

    console.log(`Found ${metrics.length} metrics to restore.`);

    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Clear existing data
    console.log('Clearing existing ServerMetric collection...');
    const deleteResult = await ServerMetric.deleteMany({});
    console.log(`Cleared ${deleteResult.deletedCount} metrics.`);

    if (metrics.length > 0) {
      console.log('Inserting metrics from backup...');
      
      // Clean up any Mongo-specific properties like _id or __v if they exist
      // Mongoose insertMany can handle them, but sometimes it is safer to let MongoDB generate new _ids
      // or we can preserve them. Let's keep them if they are unique, but mongoose accepts _id just fine.
      // We will map timestamps back to Date objects since JSON stores them as strings.
      const cleanedMetrics = metrics.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));

      const insertResult = await ServerMetric.insertMany(cleanedMetrics);
      console.log(`\x1b[32mSUCCESS: Successfully restored ${insertResult.length} metrics into MongoDB!\x1b[0m`);
    } else {
      console.warn('Backup file was empty. No metrics inserted.');
    }

    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  } catch (error) {
    console.error('Error during database restore:', error);
    process.exit(1);
  }
}

restore();
