import mongoose from 'mongoose';

const AlertSchema = new mongoose.Schema({
  serverId: {
    type: String,
    required: true,
    index: true,
  },
  serverName: {
    type: String,
    required: true,
  },
  metricType: {
    type: String, // 'CPU' | 'RAM'
    required: true,
  },
  metricValue: {
    type: Number, // Value that triggered the alert
    required: true,
  },
  threshold: {
    type: Number,
    default: 90,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  resolved: {
    type: Boolean,
    default: false,
  }
});

// Index to retrieve alerts chronologically per server
AlertSchema.index({ serverId: 1, timestamp: -1 });

export default mongoose.model('Alert', AlertSchema);
