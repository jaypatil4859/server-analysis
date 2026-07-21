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
    type: Number, // percentage 0-100
    required: true,
  },
  ramUsage: {
    totalBytes:   { type: Number, default: null },
    usedBytes:    { type: Number, default: null },
    usagePercent: { type: Number, required: true },
  },
  diskUsage: {
    totalBytes:   { type: Number, default: null },
    usedBytes:    { type: Number, default: null },
    usagePercent: { type: Number, default: null }
  },
  loadAverage: {
    oneMin:     { type: Number, required: true },
    fiveMin:    { type: Number, required: true },
    fifteenMin: { type: Number, required: true },
  },
  // null = unknown (plugin didn't report), number = actual core count
  cpuCores: {
    type: Number,
    default: null
  },
  // Uptime in seconds — parsed from Nagios Uptime service output
  uptimeSeconds: {
    type: Number,
    default: null
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
      name:   { type: String, required: true },
      status: { type: String, required: true },
      output: { type: String }
    }
  ]
});

// Compound index to speed up time-range queries per server
ServerMetricSchema.index({ serverId: 1, timestamp: -1 });

// ─── TTL index: auto-delete documents older than 30 days ─────────────────────
// Prevents unbounded DB growth (15 servers × 3 polls/min = 64,800 docs/day)
ServerMetricSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model('ServerMetric', ServerMetricSchema);
