import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import metricRoutes from './routes/metricRoutes.js';
import laptopRoutes from './routes/laptopRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3971;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/server_analysis';

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/metrics', metricRoutes);
app.use('/api/laptop', laptopRoutes);

// Health Check
app.use('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Database Connection & Server Startup
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

mongoose
  .connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('Successfully connected to MongoDB');
  })
  .catch((error) => {
    console.warn('WARNING: MongoDB is not reachable. Using In-Memory fallback database.');
  });

