import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import metricRoutes from './routes/metricRoutes.js';
import laptopRoutes from './routes/laptopRoutes.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3971;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

app.use(cors());
app.use(express.json());

app.use('/api/metrics', metricRoutes);
app.use('/api/laptop',  laptopRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date(), db: mongoose.connection.readyState === 1 ? 'connected' : 'fallback' });
});

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});

// ─── MongoDB connection with automatic reconnect ──────────────────────────────
const MONGO_RETRY_DELAYS = [3000, 5000, 10000, 20000, 30000]; // backoff steps
let retryCount = 0;

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    // Verify auth by listing collections
    await mongoose.connection.db.listCollections().toArray();
    console.log('[MongoDB] Connected and authenticated successfully.');
    retryCount = 0; // reset on success
  } catch (error) {
    const delay = MONGO_RETRY_DELAYS[Math.min(retryCount, MONGO_RETRY_DELAYS.length - 1)];
    retryCount++;
    console.warn(`[MongoDB] Connection failed: ${error.message}`);
    console.warn(`[MongoDB] Retrying in ${delay / 1000}s... (attempt ${retryCount})`);
    setTimeout(connectMongo, delay);
  }
}

// Handle disconnection events and auto-reconnect
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected. Scheduling reconnect...');
  setTimeout(connectMongo, MONGO_RETRY_DELAYS[0]);
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err.message);
});

connectMongo();
