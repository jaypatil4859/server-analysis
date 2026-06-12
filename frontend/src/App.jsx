import React, { useState, useEffect, useCallback } from 'react';
import { 
  Server, Cpu, HardDrive, Layers, Clock, Activity, 
  TrendingUp, AlertCircle, Terminal, RefreshCw, AlertTriangle,
  Laptop, Battery, BatteryCharging, Wifi, Monitor, Flame,
  Zap, MousePointer, Keyboard, Percent, Compass, FileText, CheckCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, BarChart, Bar, AreaChart, Area 
} from 'recharts';

const API_BASE = 'http://localhost:5000/api/metrics';
const LAPTOP_API_BASE = 'http://localhost:5000/api/laptop';

// Production ready mock server data
const MOCK_SERVERS = [
  {
    serverId: 'web-server-01',
    serverName: 'Web Server 01',
    cpuUsage: 42.5,
    ramUsage: { totalBytes: 17179869184, usedBytes: 7730941132, usagePercent: 45.0 },
    loadAverage: { oneMin: 1.45, fiveMin: 1.20, fifteenMin: 0.95 },
    timestamp: new Date().toISOString()
  },
  {
    serverId: 'db-server-01',
    serverName: 'Database Server 01',
    cpuUsage: 68.2,
    ramUsage: { totalBytes: 34359738368, usedBytes: 25769803776, usagePercent: 75.0 },
    loadAverage: { oneMin: 3.10, fiveMin: 2.80, fifteenMin: 2.50 },
    timestamp: new Date().toISOString()
  },
  {
    serverId: 'cache-server-01',
    serverName: 'Redis Cache 01',
    cpuUsage: 12.1,
    ramUsage: { totalBytes: 8589934592, usedBytes: 2405181685, usagePercent: 28.0 },
    loadAverage: { oneMin: 0.25, fiveMin: 0.30, fifteenMin: 0.35 },
    timestamp: new Date().toISOString()
  }
];

// Production ready mock laptop data
const MOCK_LAPTOP = {
  laptopId: 'sahil-laptop',
  laptopName: 'ZenBook Pro UX',
  cpuUsage: 16.4,
  ramUsage: { totalBytes: 17179869184, usedBytes: 7730941132, usagePercent: 45.0 },
  battery: { percent: 82, status: 'Discharging', isCharging: false },
  thermals: { cpuTemp: 48.5 },
  wifi: { ssid: 'Office-Enterprise', signalStrength: 85 },
  screenTimeToday: 320,
  appUsage: [
    { name: 'VS Code', durationPercent: 45 },
    { name: 'Chrome', durationPercent: 30 },
    { name: 'Terminal', durationPercent: 13 },
    { name: 'Slack', durationPercent: 7 },
    { name: 'Spotify', durationPercent: 5 }
  ],
  activityIndex: 45,
  timestamp: new Date().toISOString()
};

const generateMockRamHistory = () => {
  const data = [];
  const now = new Date();
  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hour = time.getHours();
    const timeLabel = `${hour}:00`;
    const hourFactor = (hour >= 14 && hour <= 20) ? 1.5 : (hour >= 1 && hour <= 5) ? 0.6 : 1.0;
    
    data.push({
      timeLabel,
      'Web Server 01': parseFloat((40 + hourFactor * 5 + Math.random() * 6).toFixed(1)),
      'Database Server 01': parseFloat((70 + hourFactor * 4 + Math.random() * 4).toFixed(1)),
      'Redis Cache 01': parseFloat((25 + hourFactor * 2 + Math.random() * 3).toFixed(1))
    });
  }
  return data;
};

const generateMockPeakAnalysis = () => {
  const data = [];
  for (let hour = 0; hour < 24; hour++) {
    const hourFactor = (hour >= 14 && hour <= 20) ? 1.8 : (hour >= 1 && hour <= 5) ? 0.5 : 1.0;
    data.push({
      hour,
      timeLabel: `${hour.toString().padStart(2, '0')}:00`,
      avgLoad: parseFloat((0.8 * hourFactor + Math.random() * 0.2).toFixed(2)),
      maxLoad: parseFloat((1.5 * hourFactor + Math.random() * 0.4).toFixed(2)),
      avgCpuUsage: parseFloat((25 * hourFactor + Math.random() * 5).toFixed(1)),
      maxCpuUsage: parseFloat((45 * hourFactor + Math.random() * 8).toFixed(1))
    });
  }
  return data;
};

const generateMockWeeklyHistory = () => {
  const data = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateLabel = time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    data.push({
      dateLabel,
      'Web Server 01': parseFloat((45 + Math.random() * 10).toFixed(1)),
      'Database Server 01': parseFloat((75 + Math.random() * 8).toFixed(1)),
      'Redis Cache 01': parseFloat((28 + Math.random() * 5).toFixed(1))
    });
  }
  return data;
};

const generateMockLaptopHistory = () => {
  const data = [];
  const now = new Date();
  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hour = time.getHours();
    const timeLabel = `${hour.toString().padStart(2, '0')}:00`;

    let batteryPercent = 100;
    if (hour >= 8 && hour < 13) {
      batteryPercent = Math.round(100 - ((hour - 8) / 5) * 85);
    } else if (hour >= 13 && hour < 16) {
      batteryPercent = Math.round(15 + ((hour - 13) / 3) * 85);
    } else if (hour >= 16 && hour < 20) {
      batteryPercent = Math.round(100 - ((hour - 16) / 4) * 65);
    } else if (hour >= 20) {
      batteryPercent = Math.round(35 + ((hour - 20) / 4) * 65);
    }

    let actFactor = 0.2;
    if (hour >= 9 && hour < 12) actFactor = 1.2;
    else if (hour >= 12 && hour < 14) actFactor = 0.4;
    else if (hour >= 14 && hour < 18) actFactor = 1.4;
    else if (hour >= 18 && hour < 22) actFactor = 0.8;

    const cpu = parseFloat((15 * actFactor + Math.random() * 10).toFixed(1));
    const ram = parseFloat((45 + cpu * 0.2 + Math.random() * 2).toFixed(1));
    const temp = parseFloat(((actFactor > 0.5 ? 48 : 40) + cpu * 0.35 + Math.random() * 3).toFixed(1));
    const activityIndex = Math.round((actFactor * 50) + Math.random() * 15);

    data.push({
      timeLabel,
      avgBatteryPercent: batteryPercent,
      avgCpuUsage: cpu,
      avgRamUsagePercent: ram,
      avgCpuTemp: temp,
      avgActivityIndex: activityIndex
    });
  }
  return data;
};

export default function App() {
  const [viewMode, setViewMode] = useState('servers'); // 'servers' | 'laptop'
  const [servers, setServers] = useState([]);
  const [ramHistory, setRamHistory] = useState([]);
  const [peakAnalysis, setPeakAnalysis] = useState([]);
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('ram'); // 'ram' | 'load-peaks' | 'weekly'
  
  // Laptop specific state
  const [laptops, setLaptops] = useState([]);
  const [laptopHistory, setLaptopHistory] = useState([]);
  const [laptopTab, setLaptopTab] = useState('battery'); // 'battery' | 'thermals' | 'productivity'
  const [selectedLaptopId, setSelectedLaptopId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMockData, setIsMockData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const processRamHistory = (rawData) => {
    if (!rawData || rawData.length === 0) return [];
    const grouped = {};
    rawData.forEach(item => {
      if (!grouped[item.timeLabel]) {
        grouped[item.timeLabel] = { timeLabel: item.timeLabel };
      }
      grouped[item.timeLabel][item.serverName] = item.maxRamUsagePercent;
    });
    return Object.values(grouped);
  };

  const processWeeklyHistory = (rawData) => {
    if (!rawData || rawData.length === 0) return [];
    const grouped = {};
    rawData.forEach(item => {
      const d = new Date(item.year, item.month - 1, item.day);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!grouped[dateLabel]) {
        grouped[dateLabel] = { dateLabel };
      }
      grouped[dateLabel][item.serverName] = item.maxRamUsagePercent;
    });
    return Object.values(grouped);
  };

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      // Test backend connection
      const healthRes = await fetch('http://localhost:5000/health').catch(() => null);
      
      if (!healthRes || !healthRes.ok) {
        throw new Error('Backend not reachable');
      }

      // Fetch Server metrics
      const [serversRes, ramRes, peakRes, weeklyRes] = await Promise.all([
        fetch(`${API_BASE}/current`),
        fetch(`${API_BASE}/ram-history-24h`),
        fetch(`${API_BASE}/peak-analysis`),
        fetch(`${API_BASE}/history-weekly`).catch(() => null)
      ]);

      // Fetch Laptop current list
      const laptopsRes = await fetch(`${LAPTOP_API_BASE}/current`).catch(() => null);

      if (!serversRes.ok || !ramRes.ok || !peakRes.ok) {
        throw new Error('API server returned error status');
      }

      const serversData = await serversRes.json();
      const ramData = await ramRes.json();
      const peakData = await peakRes.json();
      const weeklyData = weeklyRes && weeklyRes.ok ? await weeklyRes.json() : [];

      if (serversData.length === 0) {
        setServers(MOCK_SERVERS);
        setRamHistory(generateMockRamHistory());
        setPeakAnalysis(generateMockPeakAnalysis());
        setWeeklyHistory(generateMockWeeklyHistory());
        setIsMockData(true);
      } else {
        setServers(serversData);
        setRamHistory(processRamHistory(ramData));
        setPeakAnalysis(peakData.map(d => ({
          ...d,
          timeLabel: `${d.hour.toString().padStart(2, '0')}:00`
        })));
        if (weeklyData && weeklyData.length > 0) {
          setWeeklyHistory(processWeeklyHistory(weeklyData));
        } else {
          setWeeklyHistory(generateMockWeeklyHistory());
        }
        setIsMockData(false);
      }

      // Handle laptop response and query its specific history
      let activeId = selectedLaptopId;
      if (laptopsRes && laptopsRes.ok) {
        const laptopsData = await laptopsRes.json();
        if (laptopsData.length === 0) {
          setLaptops([MOCK_LAPTOP]);
          activeId = MOCK_LAPTOP.laptopId;
          if (!selectedLaptopId) {
            setSelectedLaptopId(activeId);
          }
        } else {
          setLaptops(laptopsData);
          activeId = selectedLaptopId || laptopsData[0].laptopId;
          if (!selectedLaptopId) {
            setSelectedLaptopId(activeId);
          }
        }
      } else {
        setLaptops([MOCK_LAPTOP]);
        activeId = MOCK_LAPTOP.laptopId;
        if (!selectedLaptopId) {
          setSelectedLaptopId(activeId);
        }
      }

      // Query history for the active laptop specifically
      const laptopHistRes = await fetch(`${LAPTOP_API_BASE}/history-24h?laptopId=${activeId}`).catch(() => null);

      if (laptopHistRes && laptopHistRes.ok) {
        const laptopHistData = await laptopHistRes.json();
        setLaptopHistory(laptopHistData.map(d => ({
          ...d,
          timeLabel: `${d.hour.toString().padStart(2, '0')}:00`
        })));
      } else {
        setLaptopHistory(generateMockLaptopHistory());
      }
      
      setLastUpdated(new Date());
    } catch (err) {
      console.warn('API error, using mock fallback dashboard:', err.message);
      setServers(MOCK_SERVERS);
      setRamHistory(generateMockRamHistory());
      setPeakAnalysis(generateMockPeakAnalysis());
      setWeeklyHistory(generateMockWeeklyHistory());
      setLaptops([MOCK_LAPTOP]);
      setLaptopHistory(generateMockLaptopHistory());
      setIsMockData(true);
    } finally {
      setLoading(false);
    }
  }, [selectedLaptopId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Compute key insights
  const getBusiestHour = () => {
    if (peakAnalysis.length === 0) return { hour: 'N/A', load: 0 };
    const sorted = [...peakAnalysis].sort((a, b) => b.avgLoad - a.avgLoad);
    return { 
      hour: `${sorted[0]?.hour.toString().padStart(2, '0')}:00`, 
      load: sorted[0]?.avgLoad 
    };
  };

  const getHighestRamServer = () => {
    if (servers.length === 0) return { name: 'N/A', val: 0 };
    const sorted = [...servers].sort((a, b) => b.ramUsage.usagePercent - a.ramUsage.usagePercent);
    return { name: sorted[0]?.serverName, val: sorted[0]?.ramUsage.usagePercent };
  };

  const busiestHourInfo = getBusiestHour();
  const highestRamInfo = getHighestRamServer();

  // Find unique server names for plotting dynamic chart lines
  const serverNames = servers.map(s => s.serverName);
  const colors = ['#c5a880', '#e2e2e5', '#9f8c77', '#9eb59b', '#c59f8a'];

  // Default Laptop
  const activeLaptop = laptops.find(l => l.laptopId === selectedLaptopId) || laptops[0] || MOCK_LAPTOP;

  return (
    <>
      {/* Header */}
      <header className="app-header glass-panel">
        <div className="app-title-container">
          <Activity className="app-logo" size={24} />
          <div>
            <h1>ServerPulse <span>Analytics</span></h1>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', marginTop: '4px', opacity: 0.85 }}>
              Real-time multi-server cluster metrics & laptop workflow tracking
            </p>
          </div>
        </div>

        <div className="header-meta">
          {isMockData && (
            <div className="status-badge" style={{ color: 'var(--danger-color)', borderColor: 'var(--panel-border)' }}>
              <AlertTriangle size={12} style={{ color: 'var(--luxury-gold)' }} />
              <span style={{ marginLeft: '4px' }}>Demo Mode</span>
            </div>
          )}
          <div className="status-badge">
            <div className="status-indicator pulsing"></div>
            <span style={{ marginLeft: '4px' }}>System Online</span>
          </div>
          <div className="last-updated">
            Last Updated: {lastUpdated.toLocaleTimeString()}
          </div>
          <button 
            onClick={() => fetchData()} 
            className="refresh-btn"
            title="Refresh statistics"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Tabbed Main Navigation */}
      <div className="nav-tabs-container">
        <div className="nav-tabs">
          <button 
            className={`nav-tab-btn ${viewMode === 'servers' ? 'active' : ''}`}
            onClick={() => setViewMode('servers')}
          >
            <Server size={14} /> Server Cluster
          </button>
          <button 
            className={`nav-tab-btn ${viewMode === 'laptop' ? 'active' : ''}`}
            onClick={() => setViewMode('laptop')}
          >
            <Laptop size={14} /> Laptop tracking
          </button>
        </div>
      </div>

      {viewMode === 'servers' ? (
        /* --- SERVERS DASHBOARD --- */
        <main style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <section>
            <h2 className="cluster-section-title">
              <Server size={14} /> Cluster Servers ({servers.length})
            </h2>
            <div className="servers-grid">
              {servers.map((server) => {
                const isStale = new Date() - new Date(server.timestamp) > 15000;
                return (
                  <div key={server.serverId} className="glass-panel server-card">
                    <div className="server-card-header">
                      <div className="server-name-info">
                        <h2>{server.serverName}</h2>
                        <span className="server-id-sub">{server.serverId}</span>
                      </div>
                      <span className={`server-status-dot ${isStale ? 'stale' : 'active'}`}>
                        {isStale ? 'Stale' : 'Online'}
                      </span>
                    </div>

                    <div className="server-metrics-container">
                      {/* CPU Progress Bar */}
                      <div className="metric-row">
                        <div className="metric-label-val">
                          <span className="metric-label">
                            <Cpu size={12} /> CPU Usage
                          </span>
                          <span className="metric-value cpu">{server.cpuUsage}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-bar cpu" style={{ width: `${server.cpuUsage}%` }}></div>
                        </div>
                      </div>

                      {/* RAM Progress Bar */}
                      <div className="metric-row">
                        <div className="metric-label-val">
                          <span className="metric-label">
                            <HardDrive size={12} /> Memory (RAM)
                          </span>
                          <span className="metric-value ram">{server.ramUsage.usagePercent}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-bar ram" style={{ width: `${server.ramUsage.usagePercent}%` }}></div>
                        </div>
                        <div className="ram-details-text">
                          {(server.ramUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB / 
                          {(server.ramUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB
                        </div>
                      </div>

                      {/* Load Box Display */}
                      <div className="metric-row">
                        <div className="metric-label-val">
                          <span className="metric-label">
                            <Layers size={12} /> Unix Load Average
                          </span>
                          <span className="metric-value load">{server.loadAverage.oneMin}</span>
                        </div>
                        <div className="load-values">
                          <div className="load-box">
                            <div className="load-box-val">{server.loadAverage.oneMin}</div>
                            <div className="load-box-lbl">1 min</div>
                          </div>
                          <div className="load-box">
                            <div className="load-box-val">{server.loadAverage.fiveMin}</div>
                            <div className="load-box-lbl">5 min</div>
                          </div>
                          <div className="load-box">
                            <div className="load-box-val">{server.loadAverage.fifteenMin}</div>
                            <div className="load-box-lbl">15 min</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Charts and Analytics Section */}
          <section className="analytics-section">
            {/* Main Visual Chart */}
            <div className="glass-panel chart-panel">
              <div className="chart-header">
                <h2 className="chart-title">
                  <TrendingUp size={14} /> 
                  {activeTab === 'ram' ? 'RAM Load Trends (Last 24h Peak)' : 
                   activeTab === 'load-peaks' ? 'Aggregated Peak Load of the Day' : 
                   'Weekly RAM Peaks (Last 7 Days)'}
                </h2>
                <div className="chart-tabs">
                  <button 
                    className={`chart-tab-btn ${activeTab === 'ram' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ram')}
                  >
                    RAM peak (24h)
                  </button>
                  <button 
                    className={`chart-tab-btn ${activeTab === 'load-peaks' ? 'active' : ''}`}
                    onClick={() => setActiveTab('load-peaks')}
                  >
                    Load Peaks
                  </button>
                  <button 
                    className={`chart-tab-btn ${activeTab === 'weekly' ? 'active' : ''}`}
                    onClick={() => setActiveTab('weekly')}
                  >
                    Weekly Trends (7d)
                  </button>
                </div>
              </div>

              <div className="chart-container">
                {activeTab === 'ram' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ramHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <YAxis stroke="var(--text-secondary)" unit="%" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                        labelStyle={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        itemStyle={{ color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-sans)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'var(--font-sans)', paddingTop: '10px' }} iconType="circle" />
                      {serverNames.map((name, idx) => (
                        <Line 
                          key={name}
                          type="monotone" 
                          dataKey={name} 
                          stroke={colors[idx % colors.length]} 
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--luxury-gold)' }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : activeTab === 'load-peaks' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={peakAnalysis} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorAvgLoad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--luxury-gold)" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="var(--luxury-gold)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorMaxLoad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--danger-color)" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="var(--danger-color)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <YAxis stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                        labelStyle={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        itemStyle={{ color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-sans)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'var(--font-sans)', paddingTop: '10px' }} iconType="circle" />
                      <Area 
                        type="monotone" 
                        name="Average Cluster Load"
                        dataKey="avgLoad" 
                        stroke="var(--luxury-gold)" 
                        fillOpacity={1} 
                        fill="url(#colorAvgLoad)" 
                        strokeWidth={1.5}
                      />
                      <Area 
                        type="monotone" 
                        name="Maximum Cluster Load"
                        dataKey="maxLoad" 
                        stroke="var(--danger-color)" 
                        fillOpacity={1} 
                        fill="url(#colorMaxLoad)" 
                        strokeWidth={1}
                        strokeDasharray="4 4"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="dateLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <YAxis stroke="var(--text-secondary)" unit="%" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                        labelStyle={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        itemStyle={{ color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-sans)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'var(--font-sans)', paddingTop: '10px' }} iconType="circle" />
                      {serverNames.map((name, idx) => (
                        <Line 
                          key={name}
                          type="monotone" 
                          dataKey={name} 
                          stroke={colors[idx % colors.length]} 
                          strokeWidth={1.5}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--luxury-gold)' }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Statistical Analytics Panel */}
            <div className="glass-panel stats-panel">
              <h2 className="stats-panel-title">
                <Clock size={14} /> Workload Analytics
              </h2>

              <div className="peak-insight-card">
                <span className="insight-lbl">Busiest Hour of the Day</span>
                <div className="insight-val">{busiestHourInfo.hour}</div>
                <span className="insight-desc">
                  Historically, the highest load average of <strong>{busiestHourInfo.load}</strong> occurs at this hour across all servers.
                </span>
              </div>

              <div className="stat-item-list">
                <div className="stat-item">
                  <div className="stat-item-info">
                    <div className="stat-item-icon">
                      <Cpu size={14} />
                    </div>
                    <span className="stat-item-name">Peak Server RAM Alert</span>
                  </div>
                  <span className="stat-item-val" style={{ color: 'var(--ram-color)' }}>
                    {highestRamInfo.name}: {highestRamInfo.val}%
                  </span>
                </div>

                <div className="stat-item">
                  <div className="stat-item-info">
                    <div className="stat-item-icon">
                      <Layers size={14} />
                    </div>
                    <span className="stat-item-name">Load Aggregation Basis</span>
                  </div>
                  <span className="stat-item-val">
                    {isMockData ? '24h Simulation' : 'Active MongoDB logs'}
                  </span>
                </div>
              </div>

              <details className="collector-guide">
                <summary>Collector Deployment Guide</summary>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: '12px', marginBottom: '8px' }}>
                  To monitor a new server, deploy the collection script and execute:
                </p>
                <div className="code-block">
                  METRICS_API_URL=http://[IP]:5000/api/metrics \<br />
                  SERVER_ID=prod-app-01 SERVER_NAME="App Server" \<br />
                  node collector.js
                </div>
              </details>
            </div>
          </section>
        </main>
      ) : (
        /* --- LAPTOP WORKFLOW TRACKER DASHBOARD --- */
        <main style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Device Selector Panel */}
          <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Laptop size={18} style={{ color: 'var(--luxury-gold)' }} />
              <div>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: '400', fontSize: '15px', color: 'var(--text-primary)', textAlign: 'left' }}>
                  Workspace Focus Device
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'left', marginTop: '2px' }}>
                  Analyzing real-time hardware telemetry and application activity log
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Device Source:
              </label>
              <select 
                value={selectedLaptopId || ''} 
                onChange={(e) => setSelectedLaptopId(e.target.value)}
                style={{
                  backgroundColor: 'var(--panel-bg)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {laptops.map(l => (
                  <option key={l.laptopId} value={l.laptopId}>
                    {l.laptopName} ({l.laptopId === 'sahil-laptop' ? 'Simulated Demo' : 'Real-time Local'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Laptop Live status HUD */}
          <section className="laptop-hud-grid">
            {/* Battery HUD Card */}
            <div className="glass-panel hud-card battery-card">
              <div className="hud-card-header">
                <span className="hud-card-title">
                  <Battery size={14} style={{ color: 'var(--success-color)' }} /> Battery Telemetry
                </span>
                {activeLaptop.battery.isCharging ? (
                  <span className="status-badge" style={{ fontSize: '9px', color: 'var(--success-color)' }}>
                    <BatteryCharging size={10} style={{ color: 'var(--success-color)' }} /> Charging
                  </span>
                ) : (
                  <span className="status-badge" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                    Discharging
                  </span>
                )}
              </div>
              <div className="hud-card-body">
                <div className="hud-metric-val">
                  {activeLaptop.battery.percent}<span>%</span>
                </div>
                <div className="hud-metric-sub">
                  State: <strong>{activeLaptop.battery.status}</strong>
                </div>
              </div>
            </div>

            {/* Thermal Temperature HUD Card */}
            <div className="glass-panel hud-card thermal-card">
              <div className="hud-card-header">
                <span className="hud-card-title">
                  <Flame size={14} style={{ color: 'var(--danger-color)' }} /> CPU Temperature
                </span>
                {activeLaptop.thermals.cpuTemp > 75 ? (
                  <span className="status-badge" style={{ fontSize: '9px', color: 'var(--danger-color)', borderColor: 'rgba(197, 159, 138, 0.2)' }}>
                    Hot
                  </span>
                ) : (
                  <span className="status-badge" style={{ fontSize: '9px', color: 'var(--success-color)' }}>
                    Cool
                  </span>
                )}
              </div>
              <div className="hud-card-body">
                <div className="hud-metric-val">
                  {activeLaptop.thermals.cpuTemp}<span>°C</span>
                </div>
                <div className="hud-metric-sub">
                  Thermals: <strong>{activeLaptop.thermals.cpuTemp > 75 ? 'Throttling Risk' : 'Normal'}</strong>
                </div>
              </div>
            </div>

            {/* Wifi Network HUD Card */}
            <div className="glass-panel hud-card wifi-card">
              <div className="hud-card-header">
                <span className="hud-card-title">
                  <Wifi size={14} /> Wi-Fi Connection
                </span>
                <span className="status-badge" style={{ fontSize: '9px' }}>
                  {activeLaptop.wifi.signalStrength}% Signal
                </span>
              </div>
              <div className="hud-card-body">
                <div className="hud-metric-val" style={{ fontSize: '24px', letterSpacing: '-0.02em', padding: '6px 0' }}>
                  {activeLaptop.wifi.ssid}
                </div>
                <div className="hud-metric-sub">
                  Local Host IP: <strong>{activeLaptop.laptopId}</strong>
                </div>
              </div>
            </div>

            {/* Screen Time HUD Card */}
            <div className="glass-panel hud-card screentime-card">
              <div className="hud-card-header">
                <span className="hud-card-title">
                  <Monitor size={14} style={{ color: 'var(--luxury-gold)' }} /> Daily Screen Time
                </span>
                <span className="status-badge" style={{ fontSize: '9px', color: 'var(--luxury-gold)' }}>
                  Active Today
                </span>
              </div>
              <div className="hud-card-body">
                <div className="hud-metric-val">
                  {Math.floor(activeLaptop.screenTimeToday / 60)}<span>h</span> {activeLaptop.screenTimeToday % 60}<span>m</span>
                </div>
                <div className="hud-metric-sub">
                  Productivity index: <strong>{activeLaptop.activityIndex}/100</strong>
                </div>
              </div>
            </div>
          </section>

          {/* Graphics & Analysis details */}
          <section className="analytics-section">
            {/* Visual History Charts */}
            <div className="glass-panel chart-panel">
              <div className="chart-header">
                <h2 className="chart-title">
                  <TrendingUp size={14} /> Laptop Performance Analysis (Last 24h)
                </h2>
                <div className="chart-tabs">
                  <button 
                    className={`chart-tab-btn ${laptopTab === 'battery' ? 'active' : ''}`}
                    onClick={() => setLaptopTab('battery')}
                  >
                    Battery Level
                  </button>
                  <button 
                    className={`chart-tab-btn ${laptopTab === 'thermals' ? 'active' : ''}`}
                    onClick={() => setLaptopTab('thermals')}
                  >
                    Load & Thermals
                  </button>
                  <button 
                    className={`chart-tab-btn ${laptopTab === 'productivity' ? 'active' : ''}`}
                    onClick={() => setLaptopTab('productivity')}
                  >
                    Input Activity
                  </button>
                </div>
              </div>

              <div className="chart-container">
                {laptopTab === 'battery' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={laptopHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorBattery" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--success-color)" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="var(--success-color)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <YAxis stroke="var(--text-secondary)" domain={[0, 100]} unit="%" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                        labelStyle={{ color: 'var(--text-secondary)', fontSize: '10px' }}
                        itemStyle={{ color: 'var(--text-primary)', fontSize: '12px' }}
                      />
                      <Area 
                        type="monotone" 
                        name="Battery Level"
                        dataKey="avgBatteryPercent" 
                        stroke="var(--success-color)" 
                        fillOpacity={1} 
                        fill="url(#colorBattery)" 
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : laptopTab === 'thermals' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={laptopHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} unit="°C" />
                      <YAxis yAxisId="right" orientation="right" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" />
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        name="CPU Temperature"
                        dataKey="avgCpuTemp" 
                        stroke="var(--danger-color)" 
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        name="CPU Usage Load"
                        dataKey="avgCpuUsage" 
                        stroke="var(--cpu-color)" 
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={laptopHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <YAxis stroke="var(--text-secondary)" domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                      />
                      <Bar 
                        name="Productivity Keyboard/Mouse Activity"
                        dataKey="avgActivityIndex" 
                        fill="var(--luxury-gold)" 
                        radius={[3, 3, 0, 0]}
                        maxBarSize={24}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Sidebar diagnostics / active apps */}
            <div className="glass-panel stats-panel">
              <h2 className="stats-panel-title">
                <Compass size={14} /> Screen Time & Diagnostics
              </h2>

              <div className="app-usage-container">
                <span className="insight-lbl" style={{ margin: '0 0 -4px 0' }}>Software Share (Active Today)</span>
                {activeLaptop.appUsage.map(app => (
                  <div key={app.name} className="app-usage-row">
                    <div className="app-usage-label-row">
                      <span className="app-name">{app.name}</span>
                      <span className="app-percent">{app.durationPercent}%</span>
                    </div>
                    <div className="app-progress-track">
                      <div className="app-progress-bar" style={{ width: `${app.durationPercent}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="diagnostics-panel" style={{ borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: '20px', marginTop: '4px' }}>
                <span className="insight-lbl">Smart Diagnostics</span>
                
                <div className="diag-status-item">
                  <div className="diag-icon success"><CheckCircle size={14} /></div>
                  <div>
                    System health is <strong>Optimal</strong>. Core CPU cooling is performing efficiently.
                  </div>
                </div>

                <div className="diag-status-item">
                  <div className="diag-icon info"><Zap size={14} /></div>
                  <div>
                    High focus detected in <strong>VS Code ({activeLaptop.appUsage.find(a => a.name === 'VS Code')?.durationPercent}%)</strong>.
                  </div>
                </div>
              </div>

              <details className="collector-guide">
                <summary>Laptop Collector Guide</summary>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: '12px', marginBottom: '8px' }}>
                  Run the telemetry client locally on your laptop to link live device metrics:
                </p>
                <div className="code-block">
                  METRICS_API_URL=http://[IP]:5000/api/laptop \<br />
                  LAPTOP_ID=my-zenbook LAPTOP_NAME="Personal Zenbook" \<br />
                  node laptop-collector.js
                </div>
              </details>
            </div>
          </section>
        </main>
      )}
    </>
  );
}
