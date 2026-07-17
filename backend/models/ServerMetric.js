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
  status: {
    type: String,
    default: 'up',
    enum: ['up', 'down', 'unreachable']
  },
  cpuUsage: {
    type: Number, // percentage
    required: true,
  },
  ramUsage: {
    totalBytes: { type: Number },
    usedBytes: { type: Number },
    usagePercent: { type: Number, required: true },
  },
  diskUsage: {
    totalBytes: { type: Number },
    usedBytes: { type: Number },
    usagePercent: { type: Number }
  },
  loadAverage: {
    oneMin: { type: Number, required: true },
    fiveMin: { type: Number, required: true },
    fifteenMin: { type: Number, required: true },
  },
  cpuCores: {
    type: Number,
    default: 1
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  // ─── Nagios ground-truth fields (set by nagios-bridge.js) ───────────────────
  // When the bridge last confirmed this host was visible in Nagios statusjson.cgi
  nagiosLastSeen: {
    type: Date,
    index: true,
  },
  // Raw Nagios host state: 'UP', 'DOWN', 'UNREACHABLE', or 'PENDING'
  nagiosStatus: {
    type: String,
    default: 'UP',
  },
  services: [
    {
      name: { type: String, required: true },
      status: { type: String, required: true },
      output: { type: String }
    }
  ]
});

// Compound index to speed up time-range queries per server
ServerMetricSchema.index({ serverId: 1, timestamp: -1 });

export default mongoose.model('ServerMetric', ServerMetricSchema);
