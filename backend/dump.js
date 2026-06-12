import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import ServerMetric from './models/ServerMetric.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';
const defaultDumpPath = path.resolve('dump.json');

async function dump() {
  try {
    const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultDumpPath;
    console.log(`Connecting to MongoDB to export dump...`);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    console.log('Fetching all server metrics from database...');
    const metrics = await ServerMetric.find({}).sort({ timestamp: 1 }).lean();
    console.log(`Retrieved ${metrics.length} documents.`);

    if (metrics.length === 0) {
      console.warn('WARNING: No metrics found in the database. Creating an empty dump file.');
    }

    // Write formatted JSON to file
    fs.writeFileSync(targetPath, JSON.stringify(metrics, null, 2), 'utf8');
    const stats = fs.statSync(targetPath);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`\x1b[32mSUCCESS: Successfully dumped ${metrics.length} metrics to ${targetPath} (${fileSizeInMB} MB)\x1b[0m`);
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  } catch (error) {
    console.error('Error during database dump:', error);
    process.exit(1);
  }
}

dump();
