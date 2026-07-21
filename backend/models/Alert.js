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
  // 'CPU' | 'RAM' | 'DISK'
  metricType: {
    type: String,
    required: true,
    enum: ['CPU', 'RAM', 'DISK'],
  },
  metricValue: {
    type: Number, // Value that triggered the alert (percentage)
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

// ─── TTL index: auto-delete alerts older than 90 days ────────────────────────
AlertSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('Alert', AlertSchema);
