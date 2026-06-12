import mongoose from 'mongoose';

const ServerMetricSchema = new mongoose.Schema({
  serverId: {
    type: String,
    required: true,
    index: true,
  },
  serverName: {
    type: String,
    required: true,
  },
  cpuUsage: {
    type: Number, // percentage
    required: true,
  },
  ramUsage: {
    totalBytes: { type: Number, required: true },
    usedBytes: { type: Number, required: true },
    usagePercent: { type: Number, required: true },
  },
  loadAverage: {
    oneMin: { type: Number, required: true },
    fiveMin: { type: Number, required: true },
    fifteenMin: { type: Number, required: true },
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  }
});

// Compound index to speed up time-range queries per server
ServerMetricSchema.index({ serverId: 1, timestamp: -1 });

export default mongoose.model('ServerMetric', ServerMetricSchema);
