import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Server, Cpu, HardDrive, Database, Layers, Clock, Activity, 
  TrendingUp, RefreshCw, AlertTriangle,
  Laptop, Battery, BatteryCharging, Wifi, Monitor, Flame,
  Zap, Compass, CheckCircle,
  Bell, BellRing, Trash2, ShieldAlert, Check, Calendar
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, BarChart, Bar, AreaChart, Area 
} from 'recharts';

// API_HOST: Use VITE_API_URL env var if set, otherwise fall back to the /monitoring-apis
// nginx proxy path (works in both dev via Vite proxy and production via Nginx).
let API_HOST = import.meta.env.VITE_API_URL || `${window.location.origin}/monitoring-apis`;
const getApiBase = () => `${API_HOST}/api/metrics`;
const getLaptopApiBase = () => `${API_HOST}/api/laptop`;

// REMOVED: All MOCK_SERVERS constants were here (lines 19-116).
// The app now requires a live backend connection.


export default function App() {
  const [viewMode, setViewMode] = useState('servers'); // 'servers' | 'laptop'
  const [servers, setServers] = useState([]);
  const [ramHistory, setRamHistory] = useState([]);
  const [peakAnalysis, setPeakAnalysis] = useState([]);
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [monthlyHistory, setMonthlyHistory] = useState([]);
  const [weeklyMetricTab, setWeeklyMetricTab] = useState('ram'); // 'ram' | 'cpu' | 'load'
  const [activeTab, setActiveTab] = useState('ram'); // 'ram' | 'load-peaks' | 'weekly'
  const [combustionData, setCombustionData] = useState({
    serverSummaries: [],
    above80in24h: [],
    above80in7d: [],
    counts: {
      current80Count: 0,
      current90Count: 0,
      peak24h80Count: 0,
      peak24h90Count: 0,
      peak7d80Count: 0,
      peak7d90Count: 0
    }
  });
  
  // Alerting status
  const [alerts, setAlerts] = useState([]);
  const [showAlertsDropdown, setShowAlertsDropdown] = useState(false);
  const [browserNotificationsGranted, setBrowserNotificationsGranted] = useState(false);
  const notifiedAlertsRef = useRef(new Set());
  
  // Charting Detail Status
  const [chartViewMode, setChartViewMode] = useState('cluster'); // 'cluster' | 'single'
  const [selectedServerId, setSelectedServerId] = useState('');
  const [singleServerHistory, setSingleServerHistory] = useState([]);
  const [singleServerTimeframe, setSingleServerTimeframe] = useState('24h'); // '24h' | '7d'

  // Laptop specific state
  const [laptops, setLaptops] = useState([]);
  const [laptopHistory, setLaptopHistory] = useState([]);
  const [laptopTab, setLaptopTab] = useState('battery'); // 'battery' | 'thermals' | 'productivity'
  const [selectedLaptopId, setSelectedLaptopId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // isMockData removed — app uses real backend only
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const processRamHistory = (rawData) => {
    if (!rawData || rawData.length === 0) return [];
    const grouped = {};
    rawData.forEach(item => {
      const timeLabel = item.timeLabel || `${item.hour}:00`;
      if (!grouped[timeLabel]) {
        grouped[timeLabel] = { timeLabel, values: [] };
      }
      if (item.maxRamUsagePercent !== undefined) {
        grouped[timeLabel].values.push(item.maxRamUsagePercent);
      }
    });
    return Object.values(grouped).map(group => {
      const vals = group.values;
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const max = vals.length > 0 ? Math.max(...vals) : 0;
      return {
        timeLabel: group.timeLabel,
        avgRam: parseFloat(avg.toFixed(1)),
        maxRam: parseFloat(max.toFixed(1))
      };
    });
  };

  const processWeeklyHistory = (rawData) => {
    if (!rawData || rawData.length === 0) return [];
    const grouped = {};
    rawData.forEach(item => {
      const d = new Date(item.year, item.month - 1, item.day);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!grouped[dateLabel]) {
        grouped[dateLabel] = { dateLabel, rams: [], cpus: [], loads: [] };
      }
      if (item.maxRamUsagePercent !== undefined) {
        grouped[dateLabel].rams.push(item.maxRamUsagePercent);
      }
      if (item.avgCpuUsage !== undefined) {
        grouped[dateLabel].cpus.push(item.avgCpuUsage);
      }
      if (item.avgLoad !== undefined) {
        grouped[dateLabel].loads.push(item.avgLoad);
      }
    });
    return Object.values(grouped).map(group => {
      const rams = group.rams;
      const cpus = group.cpus;
      const loads = group.loads;
      const avgRam = rams.length > 0 ? rams.reduce((a, b) => a + b, 0) / rams.length : 0;
      const maxRam = rams.length > 0 ? Math.max(...rams) : 0;
      const avgCpu = cpus.length > 0 ? cpus.reduce((a, b) => a + b, 0) / cpus.length : 0;
      const maxCpu = cpus.length > 0 ? Math.max(...cpus) : 0;
      const avgLoad = loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
      const maxLoad = loads.length > 0 ? Math.max(...loads) : 0;
      return {
        dateLabel: group.dateLabel,
        avgRam: parseFloat(avgRam.toFixed(1)),
        maxRam: parseFloat(maxRam.toFixed(1)),
        avgCpu: parseFloat(avgCpu.toFixed(1)),
        maxCpu: parseFloat(maxCpu.toFixed(1)),
        avgLoad: parseFloat(avgLoad.toFixed(2)),
        maxLoad: parseFloat(maxLoad.toFixed(2))
      };
    });
  };

  // HTML5 Notification permission check
  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBrowserNotificationsGranted(true);
      }
    }
  }, []);

  const requestBrowserNotifications = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          setBrowserNotificationsGranted(true);
        }
      });
    }
  };

  // Dispatch Browser Notification
  const triggerBrowserNotification = (alert) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const key = `${alert.serverId}-${alert.metricType}-${new Date(alert.timestamp).getTime()}`;
      if (!notifiedAlertsRef.current.has(key)) {
        notifiedAlertsRef.current.add(key);
        new Notification(`🚨 Server Alert: ${alert.serverName}`, {
          body: `Critical resource usage: ${alert.metricType} is at ${alert.metricValue}%!`,
          icon: '/vite.svg'
        });
      }
    }
  };

  const clearAlerts = async () => {
    try {
      await fetch(`${getApiBase()}/alerts/clear`, { method: 'POST' });
      setAlerts([]);
    } catch (err) {
      console.error('Failed to clear alerts:', err);
      setAlerts([]);
    }
  };

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      // Test backend connection via health endpoint
      const healthRes = await fetch(`${API_HOST}/health`).catch(() => null);
      if (!healthRes || !healthRes.ok) {
        const data = healthRes ? await healthRes.json().catch(() => null) : null;
        if (!data || data.status !== 'healthy') {
          throw new Error('Backend not reachable. Make sure the backend is running and accessible.');
        }
      }

      // Fetch Server metrics & Alerts
      const [serversRes, ramRes, peakRes, alertsRes, weeklyRes, monthlyRes, combustionRes] = await Promise.all([
        fetch(`${getApiBase()}/current`),
        fetch(`${getApiBase()}/ram-history-24h`),
        fetch(`${getApiBase()}/peak-analysis`),
        fetch(`${getApiBase()}/alerts`).catch(() => null),
        fetch(`${getApiBase()}/history-weekly`).catch(() => null),
        fetch(`${getApiBase()}/history-monthly`).catch(() => null),
        fetch(`${getApiBase()}/combustion-summary`).catch(() => null)
      ]);

      // Fetch Laptop current list
      const laptopsRes = await fetch(`${getLaptopApiBase()}/current`).catch(() => null);

      if (!serversRes.ok || !ramRes.ok || !peakRes.ok) {
        throw new Error('API server returned error status');
      }

      const serversData = await serversRes.json();
      const ramData = await ramRes.json();
      const peakData = await peakRes.json();
      const alertsData = alertsRes && alertsRes.ok ? await alertsRes.json() : [];
      const weeklyData = weeklyRes && weeklyRes.ok ? await weeklyRes.json() : [];
      const monthlyData = monthlyRes && monthlyRes.ok ? await monthlyRes.json() : [];
      const combustionDataRes = combustionRes && combustionRes.ok ? await combustionRes.json() : null;

      let activeServerId = selectedServerId;
      if (serversData.length === 0) {
        setServers([]);
        setRamHistory([]);
        setPeakAnalysis([]);
        setWeeklyHistory([]);
        setAlerts([]);
        setCombustionData({
          serverSummaries: [],
          above80in24h: [],
          above80in7d: [],
          counts: {
            current80Count: 0,
            current90Count: 0,
            peak24h80Count: 0,
            peak24h90Count: 0,
            peak7d80Count: 0,
            peak7d90Count: 0
          }
        });
      } else {
        const sortedServers = [...serversData].sort((a, b) => 
          (a.serverName || '').localeCompare(b.serverName || '')
        );
        setServers(sortedServers);
        if (sortedServers.length > 0) {
          const exists = sortedServers.some(s => s.serverId === selectedServerId);
          if (!exists) {
            activeServerId = sortedServers[0].serverId;
            setSelectedServerId(activeServerId);
          }
        }
        setRamHistory(processRamHistory(ramData));
        setPeakAnalysis(peakData.map(d => ({
          ...d,
          timeLabel: `${d.hour.toString().padStart(2, '0')}:00`
        })));
        setAlerts(alertsData);
        alertsData.forEach(triggerBrowserNotification);

        if (weeklyData && weeklyData.length > 0) {
          setWeeklyHistory(processWeeklyHistory(weeklyData));
        } else {
          setWeeklyHistory([]);
        }
        if (monthlyData && monthlyData.length > 0) {
          setMonthlyHistory(processWeeklyHistory(monthlyData));
        } else {
          setMonthlyHistory([]);
        }
        if (combustionDataRes) {
          setCombustionData(combustionDataRes);
        }
      }

      // Handle single server history
      if (chartViewMode === 'single') {
        if (serversData.length === 0 || !activeServerId) {
          setSingleServerHistory([]);
        } else {
          const endpoint = singleServerTimeframe === '24h' ? 'server-history-24h' : 'server-history-weekly';
          const sHistoryRes = await fetch(`${getApiBase()}/${endpoint}?serverId=${activeServerId}`).catch(() => null);
          if (sHistoryRes && sHistoryRes.ok) {
            const data = await sHistoryRes.json();
            if (singleServerTimeframe === '7d') {
              const formatted = data.map(item => {
                const d = new Date(item.year, item.month - 1, item.day);
                const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                return {
                  ...item,
                  timeLabel: dateLabel,
                  cpuUsage: item.avgCpuUsage,
                  ramUsage: item.maxRamUsagePercent,
                  loadAverage: item.avgLoad
                };
              });
              setSingleServerHistory(formatted);
            } else {
              setSingleServerHistory(data);
            }
          } else {
            setSingleServerHistory([]);
          }
        }
      }

      // Handle laptop response and query its specific history
      let activeId = selectedLaptopId;
      if (laptopsRes && laptopsRes.ok) {
        const laptopsData = await laptopsRes.json();
        if (laptopsData.length === 0) {
          setLaptops([]);
          setSelectedLaptopId(null);
        } else {
          setLaptops(laptopsData);
          activeId = selectedLaptopId || laptopsData[0].laptopId;
          if (!selectedLaptopId) {
            setSelectedLaptopId(activeId);
          }
        }
      } else {
        setLaptops([]);
        setSelectedLaptopId(null);
      }

      if (activeId) {
        // Query history for the active laptop specifically
        const laptopHistRes = await fetch(`${getLaptopApiBase()}/history-24h?laptopId=${activeId}`).catch(() => null);

        if (laptopHistRes && laptopHistRes.ok) {
          const laptopHistData = await laptopHistRes.json();
          setLaptopHistory(laptopHistData.map(d => ({
            ...d,
            timeLabel: `${d.hour.toString().padStart(2, '0')}:00`
          })));
        } else {
          setLaptopHistory([]);
        }
      } else {
        setLaptopHistory([]);
      }
      
      setLastUpdated(new Date());
    } catch (err) {
      console.warn('API error:', err.message);
      setError(err.message);
      setServers([]);
      setRamHistory([]);
      setPeakAnalysis([]);
      setWeeklyHistory([]);
      setAlerts([]);
      setLaptops([]);
      setLaptopHistory([]);
      setCombustionData({
        serverSummaries: [],
        above80in24h: [],
        above80in7d: [],
        counts: {
          current80Count: 0,
          current90Count: 0,
          peak24h80Count: 0,
          peak24h90Count: 0,
          peak7d80Count: 0,
          peak7d90Count: 0
        }
      });
    } finally {
      setLoading(false);
    }
  }, [selectedLaptopId, chartViewMode, selectedServerId, singleServerTimeframe]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const getWeeklySummary = () => {
    if (!weeklyHistory || weeklyHistory.length === 0) {
      return { avgCpu: '0.0', avgRam: '0.0', avgLoad: '0.00', maxCpu: '0.0', maxRam: '0.0', maxLoad: '0.00' };
    }
    const cpus = weeklyHistory.map(h => h.avgCpu || 0);
    const rams = weeklyHistory.map(h => h.avgRam || 0);
    const loads = weeklyHistory.map(h => h.avgLoad || 0);
    const maxCpus = weeklyHistory.map(h => h.maxCpu || 0);
    const maxRams = weeklyHistory.map(h => h.maxRam || 0);
    const maxLoads = weeklyHistory.map(h => h.maxLoad || 0);

    const avgCpu = cpus.reduce((a, b) => a + b, 0) / cpus.length;
    const avgRam = rams.reduce((a, b) => a + b, 0) / rams.length;
    const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;

    return {
      avgCpu: avgCpu.toFixed(1),
      avgRam: avgRam.toFixed(1),
      avgLoad: avgLoad.toFixed(2),
      maxCpu: Math.max(...maxCpus).toFixed(1),
      maxRam: Math.max(...maxRams).toFixed(1),
      maxLoad: Math.max(...maxLoads).toFixed(2)
    };
  };

  const weeklySummary = getWeeklySummary();

  // Default Laptop
  const activeLaptop = laptops.find(l => l.laptopId === selectedLaptopId) || laptops[0] || null;

  // Active Critical Alerts Filter
  const activeCriticalAlerts = alerts.filter(a => !a.resolved);

  return (
    <>
      {/* Header */}
      <header className="app-header glass-panel">
        <div className="app-title-container">
          <Activity className="app-logo" size={24} />
          <div>
            <h1>Server Analysis <span>Analytics</span></h1>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', marginTop: '4px', opacity: 0.85 }}>
              Real-time multi-server cluster metrics & alert response panel
            </p>
          </div>
        </div>

        <div className="header-meta">
          {/* Notification Bell with Dropdown */}
          <div className="notification-bell-container" style={{ position: 'relative' }}>
            <button 
              className={`refresh-btn ${activeCriticalAlerts.length > 0 ? 'alert-bell' : ''}`}
              onClick={() => setShowAlertsDropdown(!showAlertsDropdown)}
              title="Recent alerts log"
              style={{ padding: '0 8px', width: '38px', height: '32px', display: 'flex', gap: '4px', alignItems: 'center' }}
            >
              {activeCriticalAlerts.length > 0 ? (
                <BellRing size={15} style={{ color: 'var(--danger-color)', animation: 'pulse-indicator 1s infinite' }} />
              ) : (
                <Bell size={15} />
              )}
              {activeCriticalAlerts.length > 0 && (
                <span className="alert-count-badge" style={{
                  backgroundColor: 'var(--danger-color)',
                  color: '#ffffff',
                  fontSize: '9px',
                  borderRadius: '10px',
                  padding: '1px 5px',
                  fontWeight: 'bold',
                  marginLeft: '-2px'
                }}>
                  {activeCriticalAlerts.length}
                </span>
              )}
            </button>

            {showAlertsDropdown && (
              <div className="glass-panel alerts-dropdown" style={{
                position: 'absolute',
                right: 0,
                top: '38px',
                width: '320px',
                zIndex: 999,
                padding: '16px',
                maxHeight: '400px',
                overflowY: 'auto',
                boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                border: '1px solid var(--luxury-gold-muted)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '8px' }}>
                  <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ShieldAlert size={14} style={{ color: 'var(--danger-color)' }} /> Active Warnings
                  </h3>
                  {activeCriticalAlerts.length > 0 && (
                    <button 
                      onClick={clearAlerts}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      className="clear-alerts-btn"
                    >
                      <Trash2 size={12} /> Clear all
                    </button>
                  )}
                </div>

                <div className="alerts-feed-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activeCriticalAlerts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                      <CheckCircle size={20} style={{ color: 'var(--success-color)', margin: '0 auto 8px auto' }} />
                      No critical warnings reported.
                    </div>
                  ) : (
                    activeCriticalAlerts.map(alert => (
                      <div key={alert._id} style={{
                        padding: '10px',
                        borderLeft: '3px solid var(--danger-color)',
                        background: 'rgba(184, 113, 88, 0.04)',
                        borderRadius: '0 4px 4px 0',
                        fontSize: '11px',
                        textAlign: 'left'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                          <span>{alert.serverName}</span>
                          <span style={{ color: 'var(--danger-color)' }}>{alert.metricType} alert</span>
                        </div>
                        <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                          Resource usage is at <strong style={{ color: 'var(--danger-color)' }}>{alert.metricValue}%</strong> (Limit 90%)
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>


          <div className="status-badge">
            <div className="status-indicator pulsing"></div>
            <span style={{ marginLeft: '4px' }}>System Online</span>
          </div>
          <div className="last-updated">
            Updated: {lastUpdated.toLocaleTimeString()}
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
            <Server size={14} /> Server Fleet ({servers.length})
          </button>
          <button 
            className={`nav-tab-btn ${viewMode === 'laptop' ? 'active' : ''}`}
            onClick={() => setViewMode('laptop')}
          >
            <Laptop size={14} /> Laptop tracking
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(184, 113, 88, 0.08)',
          border: '1px solid rgba(184, 113, 88, 0.25)',
          color: 'var(--danger-color)',
          padding: '12px 24px',
          margin: '24px 32px 0 32px',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          textAlign: 'left'
        }}>
          <AlertTriangle size={16} />
          <span><strong>API Connection Issue:</strong> {error}</span>
        </div>
      )}

      {viewMode === 'servers' ? (
        /* --- SERVERS DASHBOARD --- */
        <main style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Warning Banner for critical servers */}
          {activeCriticalAlerts.length > 0 && (
            <div className="glass-panel alert-warning-banner" style={{
              background: 'linear-gradient(90deg, rgba(184,113,88,0.08) 0%, rgba(255,255,255,0) 100%)',
              border: '1px solid rgba(184, 113, 88, 0.25)',
              borderRadius: '6px',
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', textAlign: 'left' }}>
                <div style={{
                  backgroundColor: 'var(--danger-color)',
                  color: '#ffffff',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 10px rgba(184,113,88,0.2)'
                }}>
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    Overload Warning: {activeCriticalAlerts.length} servers exceeding safe thresholds
                  </h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Email, Slack, and browser notifications have been triggered for: {Array.from(new Set(activeCriticalAlerts.map(a => a.serverName))).join(', ')}
                  </p>
                </div>
              </div>
              <button 
                onClick={clearAlerts}
                className="refresh-btn"
                style={{ fontSize: '11px', textTransform: 'uppercase', padding: '6px 12px', height: 'auto', width: 'auto' }}
              >
                Acknowledge All
              </button>
            </div>
          )}

          {/* Grid of Servers */}
          <section>
            <h2 className="cluster-section-title">
              <Server size={14} /> Cluster Servers Node Summary
            </h2>
            {servers.length === 0 ? (
              <div className="glass-panel empty-state">
                <Server size={32} style={{ color: 'var(--luxury-gold)', opacity: 0.8 }} />
                <h3>No Active Servers Detected</h3>
                <p style={{ maxWidth: '480px', margin: '0 auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  There are currently no active servers reporting metrics to the system. To begin monitoring, deploy the collector agent on your target servers.
                </p>
                <div style={{ width: '100%', maxWidth: '500px', marginTop: '16px' }}>
                  <span className="insight-lbl" style={{ display: 'block', marginBottom: '8px', textAlign: 'left' }}>Collector Startup Commands:</span>
                  <div className="code-block" style={{ textAlign: 'left', margin: 0 }}>
                    # Download & run the collector agent<br />
                    METRICS_API_URL={getApiBase()} \<br />
                    SERVER_ID=prod-web-01 SERVER_NAME="Web Server 01" \<br />
                    node collector.js
                  </div>
                </div>
              </div>
            ) : (
              <div className="servers-grid">
                {servers.map((server) => {
                  const isStale = new Date() - new Date(server.timestamp) > 300000;
                  const isOverloaded = server.cpuUsage >= 90 || server.ramUsage.usagePercent >= 90;
                  
                  const lastActiveSecs = Math.max(0, Math.floor((new Date() - new Date(server.timestamp)) / 1000));
                  const lastActiveText = lastActiveSecs < 60 ? `${lastActiveSecs}s ago` : `${Math.floor(lastActiveSecs / 60)}m ago`;

                  return (
                    <div 
                      key={server.serverId} 
                      className={`glass-panel server-card ${isOverloaded ? 'danger-alert' : ''}`}
                      style={isOverloaded ? {
                        borderColor: 'rgba(184, 113, 88, 0.35)',
                        boxShadow: '0 10px 24px rgba(184, 113, 88, 0.06)'
                      } : {}}
                    >
                      <div className="server-card-header">
                        <div className="server-name-info" style={{ textAlign: 'left' }}>
                          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {server.serverName}
                            {isOverloaded && (
                              <span style={{
                                color: 'var(--danger-color)',
                                fontSize: '9px',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                backgroundColor: 'rgba(184, 113, 88, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                letterSpacing: '0.05em',
                                animation: 'pulse-indicator 1.5s infinite'
                              }}>
                                Overload
                              </span>
                            )}
                          </h2>
                          {server.serverName !== server.serverId && (
                            <span className="server-id-sub">{server.serverId}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <span className={`server-status-dot ${isStale ? 'stale' : 'active'}`}>
                            {isStale ? 'Stale' : 'Online'}
                          </span>
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {lastActiveText}
                          </span>
                        </div>
                      </div>

                      <div className="server-metrics-container">
                        {/* CPU Progress Bar */}
                        <div className="metric-row">
                          <div className="metric-label-val">
                            <span className="metric-label">
                              <Cpu size={12} /> CPU Usage {server.cpuCores ? `(${server.cpuCores} Cores)` : ''}
                            </span>
                            <span className="metric-value cpu" style={server.cpuUsage >= 90 ? { color: 'var(--danger-color)' } : {}}>{server.cpuUsage}%</span>
                          </div>
                          <div className="progress-track">
                            <div 
                              className="progress-bar cpu" 
                              style={{ 
                                width: `${server.cpuUsage}%`,
                                backgroundColor: server.cpuUsage >= 90 ? 'var(--danger-color)' : 'var(--cpu-color)'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* RAM Progress Bar */}
                        <div className="metric-row">
                          <div className="metric-label-val">
                            <span className="metric-label">
                              <HardDrive size={12} /> Memory (RAM)
                            </span>
                            <span className="metric-value ram" style={server.ramUsage.usagePercent >= 90 ? { color: 'var(--danger-color)' } : {}}>{server.ramUsage.usagePercent}%</span>
                          </div>
                          <div className="progress-track">
                            <div 
                              className="progress-bar ram" 
                              style={{ 
                                width: `${server.ramUsage.usagePercent}%`,
                                backgroundColor: server.ramUsage.usagePercent >= 90 ? 'var(--danger-color)' : 'var(--ram-color)'
                              }}
                            ></div>
                          </div>
                          <div className="ram-details-text">
                            {(server.ramUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB / 
                            {(server.ramUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB
                          </div>
                        </div>

                        {/* Storage (Disk) Progress Bar */}
                        {server.diskUsage && server.diskUsage.totalBytes > 0 && (
                          <div className="metric-row">
                            <div className="metric-label-val">
                              <span className="metric-label">
                                <Database size={12} /> Storage (Disk)
                              </span>
                              <span className="metric-value disk" style={server.diskUsage.usagePercent >= 90 ? { color: 'var(--danger-color)' } : {}}>
                                {server.diskUsage.usagePercent}%
                              </span>
                            </div>
                            <div className="progress-track">
                              <div 
                                className="progress-bar disk" 
                                style={{ 
                                  width: `${server.diskUsage.usagePercent}%`,
                                  backgroundColor: server.diskUsage.usagePercent >= 90 ? 'var(--danger-color)' : 'var(--disk-color)'
                                }}
                              ></div>
                            </div>
                            <div className="ram-details-text">
                              {`${(server.diskUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB / ${(server.diskUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB`}
                            </div>
                          </div>
                        )}

                        {/* Load Displays */}
                        <div className="metric-row">
                          <div className="metric-label-val">
                            <span className="metric-label">
                              <Layers size={12} /> Unix Load Average
                            </span>
                            <span className="metric-value load">{server.loadAverage.oneMin}</span>
                          </div>
                          <div className="load-values-minimal">
                            <span className="load-val-item"><strong>{server.loadAverage.oneMin}</strong> <span className="load-lbl-sub">1m</span></span>
                            <span className="load-val-divider">/</span>
                            <span className="load-val-item"><strong>{server.loadAverage.fiveMin}</strong> <span className="load-lbl-sub">5m</span></span>
                            <span className="load-val-divider">/</span>
                            <span className="load-val-item"><strong>{server.loadAverage.fifteenMin}</strong> <span className="load-lbl-sub">15m</span></span>
                          </div>
                        </div>

                        {/* Monitored Services Section */}
                        {server.services && server.services.length > 0 && (
                          <div className="server-services-section">
                            <div className="services-title">
                              <Activity size={12} className="services-title-icon" />
                              <span>Monitored Services</span>
                            </div>
                            <div className="services-list-container">
                              {server.services.map((service, idx) => {
                                let statusClass = 'unknown';
                                const sLower = (service.status || '').toLowerCase();
                                if (sLower === 'ok') statusClass = 'ok';
                                else if (sLower === 'warning') statusClass = 'warning';
                                else if (sLower === 'critical') statusClass = 'critical';

                                return (
                                  <div 
                                    key={idx} 
                                    className="service-item-row" 
                                    title={service.output || 'No output details'}
                                  >
                                    <span className="service-name">{service.name}</span>
                                    <span className={`service-status-badge ${statusClass}`}>
                                      <span className="service-status-dot"></span>
                                      {service.status}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Charts and Analytics Section */}
          <section className="analytics-section">
            
            {/* Main Visual Chart */}
            <div className="glass-panel chart-panel">
              <div className="chart-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                  <h2 className="chart-title" style={{ borderBottom: 'none' }}>
                    <TrendingUp size={14} /> Analytics & Performance History
                  </h2>
                  <div className="chart-toggles" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button 
                      className={`chart-tab-btn ${chartViewMode === 'cluster' ? 'active' : ''}`}
                      onClick={() => setChartViewMode('cluster')}
                      style={{ fontSize: '10px', padding: '4px 10px' }}
                    >
                      Cluster View
                    </button>
                    <button 
                      className={`chart-tab-btn ${chartViewMode === 'single' ? 'active' : ''}`}
                      onClick={() => setChartViewMode('single')}
                      style={{ fontSize: '10px', padding: '4px 10px' }}
                    >
                      Single Server View
                    </button>
                  </div>
                </div>

                {chartViewMode === 'cluster' ? (
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
                    <button 
                      className={`chart-tab-btn ${activeTab === 'monthly' ? 'active' : ''}`}
                      onClick={() => setActiveTab('monthly')}
                    >
                      Monthly Trends (30d)
                    </button>
                  </div>
                ) : (
                  <div className="chart-tabs" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 8px' }}>
                    <label style={{ 
                      fontSize: '10px', 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.05em', 
                      color: 'var(--text-muted)',
                      fontWeight: '500'
                    }}>
                      Server:
                    </label>
                    <select 
                      value={selectedServerId} 
                      onChange={(e) => setSelectedServerId(e.target.value)}
                      style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        fontSize: '11px',
                        fontWeight: '500',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--luxury-gold)',
                        fontFamily: 'var(--font-sans)',
                        cursor: 'pointer',
                        outline: 'none',
                        padding: '4px 6px',
                        minWidth: '160px'
                      }}
                    >
                      {servers.map(s => (
                        <option 
                          key={s.serverId} 
                          value={s.serverId}
                          style={{ backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)' }}
                        >
                          {s.serverName}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
                      <button 
                        className={`chart-tab-btn ${singleServerTimeframe === '24h' ? 'active' : ''}`}
                        onClick={() => setSingleServerTimeframe('24h')}
                        style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px' }}
                      >
                        24 Hours
                      </button>
                      <button 
                        className={`chart-tab-btn ${singleServerTimeframe === '7d' ? 'active' : ''}`}
                        onClick={() => setSingleServerTimeframe('7d')}
                        style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px' }}
                      >
                        1 Week
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {(activeTab === 'weekly' || activeTab === 'monthly') && chartViewMode === 'cluster' && (
                <div className="weekly-sub-tabs" style={{ display: 'flex', gap: '8px', padding: '0 24px', justifyContent: 'flex-start' }}>
                  <button 
                    className={`chart-tab-btn ${weeklyMetricTab === 'ram' ? 'active' : ''}`}
                    onClick={() => setWeeklyMetricTab('ram')}
                    style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '4px' }}
                  >
                    Memory (RAM)
                  </button>
                  <button 
                    className={`chart-tab-btn ${weeklyMetricTab === 'cpu' ? 'active' : ''}`}
                    onClick={() => setWeeklyMetricTab('cpu')}
                    style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '4px' }}
                  >
                    Processor (CPU)
                  </button>
                  <button 
                    className={`chart-tab-btn ${weeklyMetricTab === 'load' ? 'active' : ''}`}
                    onClick={() => setWeeklyMetricTab('load')}
                    style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '4px' }}
                  >
                    System Load
                  </button>
                </div>
              )}

              <div className="chart-container" style={{ marginTop: '16px' }}>
                {chartViewMode === 'cluster' ? (
                  // CLUSTER CHARTS
                  activeTab === 'ram' ? (
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
                        <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'var(--font-sans)', paddingTop: '10px' }} iconType="circle" />
                        <Line 
                          type="monotone" 
                          name="Average Cluster RAM"
                          dataKey="avgRam" 
                          stroke="var(--luxury-gold)" 
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--luxury-gold)' }}
                        />
                        <Line 
                          type="monotone" 
                          name="Peak Cluster RAM"
                          dataKey="maxRam" 
                          stroke="var(--danger-color)" 
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--danger-color)' }}
                        />
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
                      <LineChart data={activeTab === 'monthly' ? monthlyHistory : weeklyHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                        <XAxis dataKey="dateLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} />
                        <YAxis 
                          stroke="var(--text-secondary)" 
                          unit={weeklyMetricTab === 'load' ? '' : '%'} 
                          tickLine={false} 
                          axisLine={false} 
                          tick={{ fontSize: 10, fontFamily: 'var(--font-sans)' }} 
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                          labelStyle={{ color: 'var(--text-secondary)', fontWeight: 'normal', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                          itemStyle={{ color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-sans)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'var(--font-sans)', paddingTop: '10px' }} iconType="circle" />
                        <Line 
                          type="monotone" 
                          name={
                            weeklyMetricTab === 'ram' ? "Average Cluster RAM" : 
                            weeklyMetricTab === 'cpu' ? "Average Cluster CPU" : "Average Cluster Load"
                          }
                          dataKey={
                            weeklyMetricTab === 'ram' ? "avgRam" : 
                            weeklyMetricTab === 'cpu' ? "avgCpu" : "avgLoad"
                          } 
                          stroke="var(--luxury-gold)" 
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--luxury-gold)' }}
                        />
                        <Line 
                          type="monotone" 
                          name={
                            weeklyMetricTab === 'ram' ? "Peak Cluster RAM" : 
                            weeklyMetricTab === 'cpu' ? "Peak Cluster CPU" : "Peak Cluster Load"
                          }
                          dataKey={
                            weeklyMetricTab === 'ram' ? "maxRam" : 
                            weeklyMetricTab === 'cpu' ? "maxCpu" : "maxLoad"
                          } 
                          stroke="var(--danger-color)" 
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          dot={{ r: 2 }}
                          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--danger-color)' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  // SINGLE SERVER DETAIL CHARTS
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={singleServerHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.02)" />
                      <XAxis dataKey="timeLabel" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" stroke="var(--text-secondary)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                      <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" />
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        name="CPU Usage"
                        dataKey="cpuUsage" 
                        stroke="var(--cpu-color)" 
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        name="RAM Usage"
                        dataKey="ramUsage" 
                        stroke="var(--ram-color)" 
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        name="Load Average (1m)"
                        dataKey="loadAverage" 
                        stroke="var(--danger-color)" 
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
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

              <div className="weekly-summary-card" style={{
                background: 'linear-gradient(135deg, rgba(168, 132, 72, 0.08) 0%, rgba(255,255,255,0) 100%)',
                border: '1px solid rgba(168, 132, 72, 0.15)',
                borderRadius: '6px',
                padding: '16px',
                marginBottom: '16px',
                textAlign: 'left'
              }}>
                <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--luxury-gold)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                  <TrendingUp size={12} /> 7-Week Fleet Summary
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>CPU Avg</div>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', marginTop: '2px' }}>{weeklySummary.avgCpu}%</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Peak: {weeklySummary.maxCpu}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>RAM Avg</div>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', marginTop: '2px' }}>{weeklySummary.avgRam}%</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Peak: {weeklySummary.maxRam}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Load Avg</div>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', marginTop: '2px' }}>{weeklySummary.avgLoad}</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Peak: {weeklySummary.maxLoad}</div>
                  </div>
                </div>
                <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', lineHeight: '1.4', borderTop: '1px solid rgba(168, 132, 72, 0.08)', paddingTop: '8px', margin: 0 }}>
                  Cluster average metrics are stable. Database and high-load nodes account for the peak resources.
                </p>
              </div>

              <div className="stat-item-list">
                <div className="stat-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="stat-item-info">
                      <div className="stat-item-icon">
                        <Cpu size={14} />
                      </div>
                      <span className="stat-item-name">Fleet Peak RAM Alert</span>
                    </div>
                    <span className="stat-item-val" style={{ color: 'var(--ram-color)' }}>
                      {highestRamInfo.name}: {highestRamInfo.val}%
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4', paddingLeft: '26px' }}>
                    Displays the absolute highest RAM utilization active across the fleet (currently highlighting {highestRamInfo.name}).
                  </div>
                  
                  {/* Active Alerts Sub-list */}
                  {servers.filter(s => s.cpuUsage >= 80 || s.ramUsage.usagePercent >= 80).length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(168, 132, 72, 0.08)', paddingTop: '8px', marginTop: '4px', paddingLeft: '26px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--danger-color)', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={10} /> Active Alerts (&gt;80%)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {servers
                          .filter(s => s.cpuUsage >= 80 || s.ramUsage.usagePercent >= 80)
                          .map(s => {
                            const isCpu80 = s.cpuUsage >= 80;
                            const isRam80 = s.ramUsage.usagePercent >= 80;
                            const parts = [];
                            if (isCpu80) parts.push(`CPU: ${s.cpuUsage}%`);
                            if (isRam80) parts.push(`RAM: ${s.ramUsage.usagePercent}%`);
                            return (
                              <div key={s.serverId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{s.serverName}</span>
                                <span style={{ color: Math.max(s.cpuUsage, s.ramUsage.usagePercent) >= 90 ? 'var(--danger-color)' : 'var(--luxury-gold)', fontWeight: '500' }}>
                                  {parts.join(' / ')}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="stat-item">
                  <div className="stat-item-info">
                    <div className="stat-item-icon">
                      <Bell size={14} />
                    </div>
                    <span className="stat-item-name">Browser Notifications</span>
                  </div>
                  <span className="stat-item-val">
                    {browserNotificationsGranted ? (
                      <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Check size={12} /> Active
                      </span>
                    ) : (
                      <button 
                        onClick={requestBrowserNotifications}
                        style={{
                          backgroundColor: 'var(--luxury-gold-glow)',
                          border: '1px solid var(--luxury-gold-muted)',
                          borderRadius: '4px',
                          color: 'var(--luxury-gold)',
                          padding: '3px 8px',
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        Enable
                      </button>
                    )}
                  </span>
                </div>

                <div className="stat-item">
                  <div className="stat-item-info">
                    <div className="stat-item-icon">
                      <Layers size={14} />
                    </div>
                    <span className="stat-item-name">Data Storage Mode</span>
                  </div>
                  <span className="stat-item-val">Active MongoDB logs</span>
                </div>
              </div>

              <details className="collector-guide">
                <summary>Collector Deployment Guide</summary>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: '12px', marginBottom: '8px' }}>
                  Deploy the agent on your production servers to report health statistics:
                </p>
                <div className="code-block" style={{ textAlign: 'left' }}>
                  METRICS_API_URL=http://[IP]:3971/api/metrics \<br />
                  SERVER_ID=prod-web-01 SERVER_NAME="Web Server 01" \<br />
                  node collector.js
                </div>
              </details>
            </div>
          </section>

          {/* Fleet Resource Combustion & High Usage Tracker */}
          <section className="combustion-tracker-section" style={{ marginTop: '24px' }}>
            <div className="glass-panel" style={{ padding: '24px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(168, 132, 72, 0.12)', paddingBottom: '16px', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Zap size={18} style={{ color: 'var(--luxury-gold)' }} />
                  <div>
                    <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: '400', color: 'var(--text-primary)', margin: 0 }}>
                      Fleet Resource Combustion & High Usage Tracker
                    </h2>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', margin: 0 }}>
                      Monitors CPU and RAM peaks across all servers to track heavy-load periods.
                    </p>
                  </div>
                </div>
                
                {/* Threshold Summary Cards */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ border: '1px solid rgba(168, 132, 72, 0.15)', background: 'rgba(168, 132, 72, 0.03)', borderRadius: '6px', padding: '10px 16px', minWidth: '150px' }}>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--luxury-gold)', letterSpacing: '0.05em', fontWeight: 'bold' }}>Above 80% Utilization</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Live: <strong>{combustionData.counts.current80Count}</strong></span>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>24h: <strong>{combustionData.counts.peak24h80Count}</strong></span>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>7w: <strong>{combustionData.counts.peak7d80Count}</strong></span>
                    </div>
                  </div>
                  
                  <div style={{ border: '1px solid rgba(184, 113, 88, 0.2)', background: 'rgba(184, 113, 88, 0.03)', borderRadius: '6px', padding: '10px 16px', minWidth: '150px' }}>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--danger-color)', letterSpacing: '0.05em', fontWeight: 'bold' }}>Above 90% Utilization</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Live: <strong>{combustionData.counts.current90Count}</strong></span>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>24h: <strong>{combustionData.counts.peak24h90Count}</strong></span>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>7w: <strong>{combustionData.counts.peak7d90Count}</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parallel Peaks Lists */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                {/* 24 Hour Peaks */}
                <div>
                  <h3 style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid rgba(0,0,0,0.04)', paddingBottom: '8px', marginBottom: '12px' }}>
                    <Clock size={13} style={{ color: 'var(--luxury-gold)' }} /> Exceeded 80% in Last 24 Hours
                  </h3>
                  {combustionData.above80in24h.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '16px 0' }}>No servers exceeded 80% in the last 24 hours.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {combustionData.above80in24h.map(item => (
                        <div key={item.serverId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(0,0,0,0.005)', border: '1px solid rgba(0,0,0,0.015)', borderRadius: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }}>{item.serverName}</span>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                            <span style={{ color: item.maxCpu >= 80 ? 'var(--luxury-gold)' : 'var(--text-muted)' }}>
                              CPU Peak: <strong>{item.maxCpu}%</strong>
                            </span>
                            <span style={{ color: item.maxRam >= 80 ? 'var(--ram-color)' : 'var(--text-muted)' }}>
                              RAM Peak: <strong>{item.maxRam}%</strong>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 7 Day Peaks */}
                <div>
                  <h3 style={{ fontSize: '12px', fontWeight: '500', textTransform: 'uppercase', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid rgba(0,0,0,0.04)', paddingBottom: '8px', marginBottom: '12px' }}>
                    <Calendar size={13} style={{ color: 'var(--luxury-gold)' }} /> Exceeded 80% in Past 7 Weeks
                  </h3>
                  {combustionData.above80in7d.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '16px 0' }}>No servers exceeded 80% in the past 7 weeks.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {combustionData.above80in7d.map(item => (
                        <div key={item.serverId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(0,0,0,0.005)', border: '1px solid rgba(0,0,0,0.015)', borderRadius: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }}>{item.serverName}</span>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                            <span style={{ color: item.maxCpu >= 80 ? 'var(--luxury-gold)' : 'var(--text-muted)' }}>
                              CPU Peak: <strong>{item.maxCpu}%</strong>
                            </span>
                            <span style={{ color: item.maxRam >= 80 ? 'var(--ram-color)' : 'var(--text-muted)' }}>
                              RAM Peak: <strong>{item.maxRam}%</strong>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      ) : (
        /* --- LAPTOP WORKFLOW TRACKER DASHBOARD --- */
        <main style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {laptops.length === 0 ? (
            <div className="glass-panel empty-state">
              <Laptop size={32} style={{ color: 'var(--luxury-gold)', opacity: 0.8 }} />
              <h3>No Active Laptops Detected</h3>
              <p style={{ maxWidth: '480px', margin: '0 auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
                There are currently no active laptops reporting metrics to the system. To start monitoring, run the laptop collector agent on your laptop.
              </p>
              <div style={{ width: '100%', maxWidth: '500px', marginTop: '16px' }}>
                <span className="insight-lbl" style={{ display: 'block', marginBottom: '8px', textAlign: 'left' }}>Laptop Agent Startup Command:</span>
                <div className="code-block" style={{ textAlign: 'left', margin: 0 }}>
                  # Run the laptop telemetry client<br />
                  METRICS_API_URL=http://localhost:3971/api/laptop \<br />
                  LAPTOP_ID=my-laptop LAPTOP_NAME="Personal Laptop" \<br />
                  node laptop-collector.js
                </div>
              </div>
            </div>
          ) : (
            <>
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
                  outline: 'none',
                  minWidth: '220px'
                }}
              >
                {laptops.map(l => (
                  <option key={l.laptopId} value={l.laptopId}>
                    {l.laptopName}
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
                  <div style={{ textAlign: 'left' }}>
                    System health is <strong>Optimal</strong>. Core CPU cooling is performing efficiently.
                  </div>
                </div>

                <div className="diag-status-item">
                  <div className="diag-icon info"><Zap size={14} /></div>
                  <div style={{ textAlign: 'left' }}>
                    High focus detected in <strong>VS Code ({activeLaptop.appUsage.find(a => a.name === 'VS Code')?.durationPercent}%)</strong>.
                  </div>
                </div>
              </div>

              <details className="collector-guide">
                <summary>Laptop Collector Guide</summary>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: '12px', marginBottom: '8px' }}>
                  Run the telemetry client locally on your laptop to link live device metrics:
                </p>
                <div className="code-block" style={{ textAlign: 'left' }}>
                  METRICS_API_URL=http://[IP]:3971/api/laptop \<br />
                  LAPTOP_ID=my-zenbook LAPTOP_NAME="Personal Zenbook" \<br />
                  node laptop-collector.js
                </div>
              </details>
            </div>
          </section>
          </>
          )}
        </main>
      )}
    </>
  );
}
