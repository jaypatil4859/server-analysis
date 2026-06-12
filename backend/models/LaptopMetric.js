import mongoose from 'mongoose';

const LaptopMetricSchema = new mongoose.Schema({
  laptopId: {
    type: String,
    required: true,
    index: true,
  },
  laptopName: {
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
  battery: {
    percent: { type: Number, required: true },
    status: { type: String, required: true }, // e.g. Charging, Discharging, Full
    isCharging: { type: Boolean, required: true }
  },
  thermals: {
    cpuTemp: { type: Number, required: true } // in degrees Celsius
  },
  wifi: {
    ssid: { type: String, default: 'Disconnected' },
    signalStrength: { type: Number, default: 0 } // percentage or dBm
  },
  screenTimeToday: {
    type: Number, // total minutes active today
    default: 0
  },
  appUsage: [{
    name: { type: String, required: true },
    durationPercent: { type: Number, required: true } // percentage of active time
  }],
  activityIndex: {
    type: Number, // 0-100 index representing keyboard/mouse active level
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  }
});

// Index for query optimization
LaptopMetricSchema.index({ laptopId: 1, timestamp: -1 });

export default mongoose.model('LaptopMetric', LaptopMetricSchema);
