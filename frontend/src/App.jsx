import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, Cpu, HardDrive, Database, Layers, Clock, Activity,
  TrendingUp, RefreshCw, AlertTriangle,
  Laptop, Battery, BatteryCharging, Wifi, Monitor, Flame,
  Zap, CheckCircle,
  Bell, BellRing, Trash2, ShieldAlert, Check, Calendar,
  Lock, Globe, BarChart2
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar, AreaChart, Area
} from 'recharts';

// ─── API config ────────────────────────────────────────────────────────────────
let API_HOST = import.meta.env.VITE_API_URL || `${window.location.origin}/monitoring-apis`;
const getApiBase    = () => `${API_HOST}/api/metrics`;
const getLaptopBase = () => `${API_HOST}/api/laptop`;

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [viewMode, setViewMode] = useState('servers');

  // Server data
  const [servers,       setServers]       = useState([]);
  const [ramHistory,    setRamHistory]    = useState([]);
  const [peakAnalysis,  setPeakAnalysis]  = useState([]);
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [monthlyHistory,setMonthlyHistory]= useState([]);
  const [combustionData,setCombustionData]= useState({
    serverSummaries: [], above80in24h: [], above80in7d: [],
    counts: { current80Count:0, current90Count:0, peak24h80Count:0, peak24h90Count:0, peak7d80Count:0, peak7d90Count:0 }
  });

  // Alerts
  const [alerts,             setAlerts]             = useState([]);
  const [showAlerts,         setShowAlerts]         = useState(false);
  const [browserNotifGranted,setBrowserNotifGranted]= useState(false);
  const notifiedRef = useRef(new Set());

  // Chart controls
  const [activeTab,            setActiveTab]           = useState('ram');
  const [weeklyMetricTab,      setWeeklyMetricTab]     = useState('ram');
  const [chartViewMode,        setChartViewMode]       = useState('cluster');
  const [selectedServerId,     setSelectedServerId]    = useState('');
  const [singleServerHistory,  setSingleServerHistory] = useState([]);
  const [singleServerTimeframe,setSingleServerTimeframe]=useState('24h');
  const [serviceFilter,        setServiceFilter]       = useState('all');

  // SSL
  const [sslData,    setSslData]    = useState([]);
  const [sslLoading, setSslLoading] = useState(false);

  // Laptop
  const [laptops,          setLaptops]         = useState([]);
  const [laptopHistory,    setLaptopHistory]   = useState([]);
  const [laptopTab,        setLaptopTab]       = useState('battery');
  const [selectedLaptopId, setSelectedLaptopId]= useState(null);

  // Nagios live status (direct Nagios query — source of truth for up/down)
  const [nagiosLiveMap,  setNagiosLiveMap]  = useState({}); // { hostName -> 'UP'|'DOWN'|... }
  const [nagiosLiveOk,   setNagiosLiveOk]   = useState(null); // null=loading, true=ok, false=error
  const [bridgeHealth,   setBridgeHealth]   = useState(null); // bridge heartbeat info

  // Global state
  const [loading,     setLoading]    = useState(true);
  const [error,       setError]      = useState(null);
  const [lastUpdated, setLastUpdated]= useState(new Date());

  // ─── Notification helpers ────────────────────────────────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setBrowserNotifGranted(true);
    }
  }, []);

  const requestBrowserNotifications = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => {
        if (p === 'granted') setBrowserNotifGranted(true);
      });
    }
  };

  const triggerBrowserNotification = useCallback((alert) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const key = `${alert.serverId}-${alert.metricType}-${new Date(alert.timestamp).getTime()}`;
      if (!notifiedRef.current.has(key)) {
        notifiedRef.current.add(key);
        new Notification(`🚨 ${alert.serverName}`, {
          body: `${alert.metricType} at ${alert.metricValue}% (threshold 90%)`
        });
      }
    }
  }, []);

  const clearAlerts = async () => {
    try {
      await fetch(`${getApiBase()}/alerts/clear`, { method: 'POST' });
      setAlerts([]);
    } catch { setAlerts([]); }
  };

  // ─── Nagios Live fetch (direct Nagios status query — bypasses bridge/MongoDB) ──
  // This is the permanent fix for the "Stale" bug: even if the bridge is lagging,
  // we can query Nagios directly and know if a host is actually UP or DOWN.
  const fetchNagiosLive = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/nagios-live`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!res?.ok) { setNagiosLiveOk(false); return; }
      const data = await res.json();
      if (!data.ok) { setNagiosLiveOk(false); return; }
      const map = {};
      (data.hosts || []).forEach(h => { map[h.hostName] = h.nagiosStatus; });
      setNagiosLiveMap(map);
      setNagiosLiveOk(true);
    } catch {
      setNagiosLiveOk(false);
    }
  }, []);

  // ─── Bridge health check ──────────────────────────────────────────────────────
  const fetchBridgeHealth = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/nagios-health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (res?.ok) setBridgeHealth(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  // ─── Data processing helpers ─────────────────────────────────────────────────
  const processRamHistory = (raw) => {
    if (!raw?.length) return [];
    const grouped = {};
    raw.forEach(item => {
      const label = item.timeLabel || `${item.hour}:00`;
      if (!grouped[label]) grouped[label] = { label, vals: [] };
      if (item.maxRamUsagePercent != null) grouped[label].vals.push(item.maxRamUsagePercent);
    });
    return Object.values(grouped).map(g => ({
      timeLabel: g.label,
      avgRam: g.vals.length ? parseFloat((g.vals.reduce((a,b)=>a+b,0)/g.vals.length).toFixed(1)) : 0,
      maxRam: g.vals.length ? parseFloat(Math.max(...g.vals).toFixed(1)) : 0
    }));
  };

  const processWeeklyHistory = (raw) => {
    if (!raw?.length) return [];
    const grouped = {};
    raw.forEach(item => {
      const d = new Date(item.year, item.month-1, item.day);
      const label = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
      if (!grouped[label]) grouped[label] = { label, rams:[], cpus:[], loads:[] };
      if (item.maxRamUsagePercent != null) grouped[label].rams.push(item.maxRamUsagePercent);
      if (item.avgCpuUsage != null)        grouped[label].cpus.push(item.avgCpuUsage);
      if (item.avgLoad != null)            grouped[label].loads.push(item.avgLoad);
    });
    return Object.values(grouped).map(g => {
      const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
      return {
        dateLabel: g.label,
        avgRam: parseFloat(avg(g.rams).toFixed(1)),
        maxRam: parseFloat((g.rams.length ? Math.max(...g.rams) : 0).toFixed(1)),
        avgCpu: parseFloat(avg(g.cpus).toFixed(1)),
        maxCpu: parseFloat((g.cpus.length ? Math.max(...g.cpus) : 0).toFixed(1)),
        avgLoad: parseFloat(avg(g.loads).toFixed(2)),
        maxLoad: parseFloat((g.loads.length ? Math.max(...g.loads) : 0).toFixed(2))
      };
    });
  };

  // ─── Fetch live data (current + alerts) every 10s ───────────────────────────
  const fetchLiveData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const health = await fetch(`${API_HOST}/health`).catch(() => null);
      if (!health?.ok) throw new Error('Backend not reachable. Make sure the server is running.');

      const [serversRes, alertsRes] = await Promise.all([
        fetch(`${getApiBase()}/current`),
        fetch(`${getApiBase()}/alerts`).catch(() => null)
      ]);

      if (!serversRes.ok) throw new Error('Failed to fetch server metrics.');

      const serversData = await serversRes.json();
      const alertsData  = alertsRes?.ok ? await alertsRes.json() : [];

      const sorted = [...serversData].sort((a,b) => (a.serverName||'').localeCompare(b.serverName||''));
      setServers(sorted);
      if (sorted.length > 0 && !selectedServerId) {
        setSelectedServerId(sorted[0].serverId);
      }
      setAlerts(alertsData);
      alertsData.forEach(triggerBrowserNotification);
      setLastUpdated(new Date());

      // Laptop current
      const laptopsRes = await fetch(`${getLaptopBase()}/current`).catch(() => null);
      if (laptopsRes?.ok) {
        const ld = await laptopsRes.json();
        setLaptops(ld);
        if (ld.length > 0 && !selectedLaptopId) setSelectedLaptopId(ld[0].laptopId);
      } else {
        setLaptops([]);
      }
    } catch (err) {
      setError(err.message);
      setServers([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, selectedLaptopId, triggerBrowserNotification]);

  // ─── Fetch historical data (charts) every 60s ────────────────────────────────
  const fetchHistoricalData = useCallback(async () => {
    if (!servers.length) return; // only fetch if we have live servers
    try {
      const [ramRes, peakRes, weeklyRes, monthlyRes, combustionRes] = await Promise.all([
        fetch(`${getApiBase()}/ram-history-24h`).catch(() => null),
        fetch(`${getApiBase()}/peak-analysis`).catch(() => null),
        fetch(`${getApiBase()}/history-weekly`).catch(() => null),
        fetch(`${getApiBase()}/history-monthly`).catch(() => null),
        fetch(`${getApiBase()}/combustion-summary`).catch(() => null)
      ]);

      if (ramRes?.ok)       setRamHistory(processRamHistory(await ramRes.json()));
      if (peakRes?.ok)      setPeakAnalysis((await peakRes.json()).map(d => ({ ...d, timeLabel: `${String(d.hour).padStart(2,'0')}:00` })));
      if (weeklyRes?.ok)    setWeeklyHistory(processWeeklyHistory(await weeklyRes.json()));
      if (monthlyRes?.ok)   setMonthlyHistory(processWeeklyHistory(await monthlyRes.json()));
      if (combustionRes?.ok)setCombustionData(await combustionRes.json());
    } catch (err) {
      console.warn('Historical data fetch error:', err.message);
    }
  }, [servers.length]);

  // ─── Single server history (on demand) ──────────────────────────────────────
  const fetchSingleServerHistory = useCallback(async () => {
    if (chartViewMode !== 'single' || !selectedServerId) return;
    try {
      const endpoint = singleServerTimeframe === '24h' ? 'server-history-24h' : 'server-history-weekly';
      const res = await fetch(`${getApiBase()}/${endpoint}?serverId=${selectedServerId}`).catch(() => null);
      if (!res?.ok) { setSingleServerHistory([]); return; }
      const data = await res.json();
      if (singleServerTimeframe === '7d') {
        setSingleServerHistory(data.map(item => ({
          ...item,
          timeLabel:   new Date(item.year, item.month-1, item.day).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }),
          cpuUsage:    item.avgCpuUsage,
          ramUsage:    item.maxRamUsagePercent,
          loadAverage: item.avgLoad
        })));
      } else {
        setSingleServerHistory(data);
      }
    } catch { setSingleServerHistory([]); }
  }, [chartViewMode, selectedServerId, singleServerTimeframe]);

  // ─── Laptop history ───────────────────────────────────────────────────────────
  const fetchLaptopHistory = useCallback(async () => {
    if (!selectedLaptopId) return;
    try {
      const res = await fetch(`${getLaptopBase()}/history-24h?laptopId=${selectedLaptopId}`).catch(() => null);
      if (res?.ok) {
        const d = await res.json();
        setLaptopHistory(d.map(h => ({ ...h, timeLabel: `${String(h.hour).padStart(2,'0')}:00` })));
      } else {
        setLaptopHistory([]);
      }
    } catch { setLaptopHistory([]); }
  }, [selectedLaptopId]);

  // ─── SSL data ─────────────────────────────────────────────────────────────────
  const fetchSslData = useCallback(async (silent = false) => {
    if (!silent) setSslLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/ssl-expiry`);
      if (res.ok) setSslData(await res.json());
    } catch { /* ignore */ }
    finally { setSslLoading(false); }
  }, []);

  // ─── Polling setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchLiveData();
    const liveInterval = setInterval(() => fetchLiveData(true), 10_000);
    return () => clearInterval(liveInterval);
  }, [fetchLiveData]);

  useEffect(() => {
    fetchHistoricalData();
    const histInterval = setInterval(fetchHistoricalData, 60_000);
    return () => clearInterval(histInterval);
  }, [fetchHistoricalData]);

  useEffect(() => { fetchSingleServerHistory(); }, [fetchSingleServerHistory]);
  useEffect(() => { fetchLaptopHistory(); }, [fetchLaptopHistory]);

  useEffect(() => {
    if (viewMode === 'ssl' && sslData.length === 0) fetchSslData();
  }, [viewMode, sslData.length, fetchSslData]);

  // ─── Nagios Live polling (every 15s — independent of bridge) ─────────────────
  useEffect(() => {
    fetchNagiosLive();
    const nagiosInterval = setInterval(fetchNagiosLive, 15_000);
    return () => clearInterval(nagiosInterval);
  }, [fetchNagiosLive]);

  // ─── Bridge health polling (every 30s) ────────────────────────────────────────
  useEffect(() => {
    fetchBridgeHealth();
    const healthInterval = setInterval(fetchBridgeHealth, 30_000);
    return () => clearInterval(healthInterval);
  }, [fetchBridgeHealth]);

  // ─── Tab focus auto-refresh — instantly refresh when user returns to tab ──────
  // Fixes the issue where users see stale data after coming back to the dashboard.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchLiveData(true);
        fetchNagiosLive();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchLiveData, fetchNagiosLive]);

  // ─── Derived values ───────────────────────────────────────────────────────────
  const activeCriticalAlerts = alerts.filter(a => !a.resolved);
  const activeLaptop = laptops.find(l => l.laptopId === selectedLaptopId) || laptops[0] || null;

  const getBusiestHour = () => {
    if (!peakAnalysis.length) return { hour: '—', load: 0 };
    const sorted = [...peakAnalysis].sort((a,b) => b.avgLoad - a.avgLoad);
    return { hour: sorted[0]?.timeLabel || '—', load: sorted[0]?.avgLoad || 0 };
  };

  const getHighestRamServer = () => {
    if (!servers.length) return { name: '—', val: 0 };
    const sorted = [...servers].sort((a,b) => b.ramUsage.usagePercent - a.ramUsage.usagePercent);
    return { name: sorted[0]?.serverName, val: sorted[0]?.ramUsage.usagePercent };
  };

  const getWeeklySummary = () => {
    if (!weeklyHistory.length) return { avgCpu:'—', avgRam:'—', avgLoad:'—', maxCpu:'—', maxRam:'—', maxLoad:'—' };
    const avg = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
    return {
      avgCpu:  avg(weeklyHistory.map(h=>h.avgCpu||0)).toFixed(1)+'%',
      avgRam:  avg(weeklyHistory.map(h=>h.avgRam||0)).toFixed(1)+'%',
      avgLoad: avg(weeklyHistory.map(h=>h.avgLoad||0)).toFixed(2),
      maxCpu:  Math.max(...weeklyHistory.map(h=>h.maxCpu||0)).toFixed(1)+'%',
      maxRam:  Math.max(...weeklyHistory.map(h=>h.maxRam||0)).toFixed(1)+'%',
      maxLoad: Math.max(...weeklyHistory.map(h=>h.maxLoad||0)).toFixed(2)
    };
  };

  const busiestHour  = getBusiestHour();
  const highestRam   = getHighestRamServer();
  const weeklySummary= getWeeklySummary();

  // ─── Tooltip style shared ────────────────────────────────────────────────────
  const chartTooltipStyle = {
    contentStyle: { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontFamily: 'var(--font-sans)' },
    labelStyle:   { color: 'var(--text-2)', fontWeight: 600, fontSize: 11 },
    itemStyle:    { color: 'var(--text-1)' }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const fmtBytes = (bytes) => {
    if (!bytes) return '—';
    const gb = bytes / (1024**3);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes/(1024**2)).toFixed(0)} MB`;
  };

  const serviceClass = (status) => {
    const s = (status||'').toLowerCase();
    if (s === 'ok') return 'ok';
    if (s === 'warning') return 'warning';
    if (s === 'critical') return 'critical';
    return 'unknown';
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-brand-icon"><Activity size={18} /></div>
          <div>
            <div className="header-title">Server Analysis</div>
            <div className="header-subtitle">Real-time cluster metrics · Nagios-backed</div>
          </div>
        </div>

        <div className="header-actions">
          {/* Alert bell */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn icon-only"
              onClick={() => setShowAlerts(!showAlerts)}
              title="Recent alerts"
              style={activeCriticalAlerts.length > 0 ? { borderColor: 'rgba(220,38,38,0.35)', color: 'var(--danger)' } : {}}
            >
              {activeCriticalAlerts.length > 0
                ? <BellRing size={14} className="bell-active" />
                : <Bell size={14} />
              }
              {activeCriticalAlerts.length > 0 && (
                <span className="alert-count">{activeCriticalAlerts.length}</span>
              )}
            </button>

            {showAlerts && (
              <div className="alerts-dropdown">
                <div className="alerts-dropdown-header">
                  <span className="alerts-dropdown-title">
                    <ShieldAlert size={13} style={{ color:'var(--danger)' }} /> Active Warnings
                  </span>
                  {activeCriticalAlerts.length > 0 && (
                    <button className="btn" onClick={clearAlerts} style={{ padding:'3px 8px', fontSize:11 }}>
                      <Trash2 size={11} /> Clear all
                    </button>
                  )}
                </div>
                <div className="alerts-list">
                  {activeCriticalAlerts.length === 0 ? (
                    <div className="alerts-empty">
                      <CheckCircle size={18} style={{ color:'var(--success)' }} />
                      No active warnings
                    </div>
                  ) : activeCriticalAlerts.map(alert => (
                    <div key={alert._id || `${alert.serverId}-${alert.timestamp}`} className="alert-item">
                      <div className="alert-item-header">
                        <span>{alert.serverName}</span>
                        <span className="alert-type">{alert.metricType} alert</span>
                      </div>
                      <div className="alert-item-body">
                        Usage at <strong style={{ color:'var(--danger)' }}>{alert.metricValue}%</strong> (threshold 90%)
                      </div>
                      <div className="alert-item-time">{new Date(alert.timestamp).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Nagios Live indicator */}
          {nagiosLiveOk === true && (
            <div title="Nagios direct connection active — status is real-time" style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
              color: 'var(--success)', background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: '4px 8px'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', animation: 'pulse-anim 2s infinite' }} />
              Nagios Live ✓
            </div>
          )}
          {nagiosLiveOk === false && (
            <div title="Cannot reach Nagios directly — using DB data only" style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
              color: 'var(--warning)', background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '4px 8px'
            }}>
              ⚠ Nagios Unreachable
            </div>
          )}
          {/* Bridge health indicator */}
          {bridgeHealth && bridgeHealth.bridge.isStale && (
            <div title={`Bridge last polled ${bridgeHealth.bridge.secondsSinceLastPoll}s ago — may be restarting`} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
              color: 'var(--warning)', background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '4px 8px'
            }}>
              ⚠ Bridge Stale ({Math.floor((bridgeHealth.bridge.secondsSinceLastPoll || 0) / 60)}m)
            </div>
          )}
          <div className="status-pill">
            <span className="status-dot pulse" />
            Live
          </div>
          <span style={{ fontSize:12, color:'var(--text-3)' }}>
            {lastUpdated.toLocaleTimeString()}
          </span>
          <button className="btn icon-only" onClick={() => { fetchLiveData(); fetchNagiosLive(); }} title="Refresh">
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="nav-bar">
        {[
          { id:'servers',   icon:<Server size={13}/>,    label:'Servers',   count: servers.length },
          { id:'services',  icon:<Database size={13}/>,  label:'Services' },
          { id:'ssl',       icon:<Lock size={13}/>,      label:'SSL & Domains' },
          { id:'analytics', icon:<BarChart2 size={13}/>, label:'Analytics' },
          { id:'laptop',    icon:<Laptop size={13}/>,    label:'Laptop',    count: laptops.length }
        ].map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${viewMode === tab.id ? 'active' : ''}`}
            onClick={() => setViewMode(tab.id)}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && (
              <span className="nav-tab-count">{tab.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner">
          <AlertTriangle size={15} />
          <div><strong>Connection Error:</strong> {error}</div>
        </div>
      )}

      {/* ── Critical Alert Banner ────────────────────────────────────────────── */}
      {activeCriticalAlerts.length > 0 && (
        <div className="alert-banner">
          <div className="alert-banner-content">
            <AlertTriangle size={15} className="alert-banner-icon" />
            <div>
              <div className="alert-banner-title">
                {activeCriticalAlerts.length} server{activeCriticalAlerts.length > 1 ? 's' : ''} exceeding safe thresholds
              </div>
              <div className="alert-banner-desc">
                {Array.from(new Set(activeCriticalAlerts.map(a => a.serverName))).join(', ')}
              </div>
            </div>
          </div>
          <button className="btn" onClick={clearAlerts}>Acknowledge all</button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SERVERS VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'servers' && (
        <main style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {servers.length === 0 ? (
            <div className="empty-state">
              <Server size={28} className="empty-state-icon" />
              <h3>No Active Servers</h3>
              <p>No servers are currently reporting metrics. Start the Nagios bridge to begin.</p>
              <div className="code-block" style={{ marginTop:8, maxWidth:500 }}>
{`node nagios-bridge.js`}
              </div>
            </div>
          ) : (
            <>
              <div className="section-title">
                <Server size={12} /> Cluster — {servers.filter(s => {
                  // Use Nagios live as override: if Nagios says UP, count as online
                  const nagiosUp = nagiosLiveMap[s.serverName] === 'UP';
                  const sStale = !nagiosUp && (Date.now() - new Date(s.timestamp) > 5 * 60 * 1000);
                  return !sStale && s.status !== 'down' && nagiosLiveMap[s.serverName] !== 'DOWN';
                }).length} / {servers.length} online
              </div>
              <div className="servers-grid">
                {servers.map(server => {
                  // ── Stale detection with Nagios-live override ──────────────────────
                  // Core fix: if Nagios says UP, NEVER mark as Stale — even if MongoDB
                  // timestamp is old. MongoDB/bridge data lags; Nagios is the truth.
                  const nagiosStatus  = nagiosLiveMap[server.serverName]; // 'UP'|'DOWN'|undefined
                  const nagiosConfirmsUp = nagiosStatus === 'UP';
                  const nagiosConfirmsDown = nagiosStatus === 'DOWN' || nagiosStatus === 'UNREACHABLE';
                  // Only mark stale if: Nagios doesn't say UP AND MongoDB data > 5 min old
                  const dbAge = Date.now() - new Date(server.timestamp);
                  const isStale = !nagiosConfirmsUp && dbAge > 5 * 60 * 1000; // 5 min (was 3 min)
                  const isDown  = nagiosConfirmsDown || server.status === 'down';
                  const isOverloaded = server.cpuUsage >= 90 || server.ramUsage.usagePercent >= 90;
                  const secAgo  = Math.max(0, Math.floor(dbAge / 1000));
                  const timeAgo = secAgo < 60 ? `${secAgo}s ago` : `${Math.floor(secAgo/60)}m ago`;

                  const cpuColor  = server.cpuUsage >= 90 ? 'danger' : 'cpu';
                  const ramColor  = server.ramUsage.usagePercent >= 90 ? 'danger' : 'ram';
                  const diskColor = server.diskUsage?.usagePercent >= 90 ? 'danger' : 'disk';

                  return (
                    <div key={server.serverId} className={`server-card ${isOverloaded ? 'overloaded' : ''}`}>
                      {/* Header */}
                      <div className="server-card-header">
                        <div>
                          <div className="server-name">
                            {server.serverName}
                            {isOverloaded && <span className="overload-badge">overload</span>}
                          </div>
                          {server.serverName !== server.serverId && (
                            <div className="server-id">{server.serverId}</div>
                          )}
                        </div>
                        <div className="server-status">
                          <span className={`status-label ${isStale ? 'stale' : (isDown ? 'down' : 'online')}`}>
                            {isStale ? 'Stale' : (isDown ? 'Down' : 'Online')}
                          </span>
                          {nagiosStatus && (
                            <span title={`Nagios live: ${nagiosStatus}`} style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                              color: nagiosStatus === 'UP' ? 'var(--success)' : 'var(--danger)',
                              background: nagiosStatus === 'UP' ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.12)',
                              border: `1px solid ${nagiosStatus === 'UP' ? 'rgba(34,197,94,0.25)' : 'rgba(220,38,38,0.25)'}`,
                              borderRadius: 4, padding: '1px 5px', marginLeft: 2
                            }}>
                              ⬡ {nagiosStatus}
                            </span>
                          )}
                          <span className="status-time">{timeAgo}</span>
                        </div>
                      </div>

                      {/* Metrics */}
                      <div className="metrics-stack">
                        {/* CPU */}
                        <div className="metric-row">
                          <div className="metric-label-row">
                            <span className="metric-label">
                              <Cpu size={12} /> CPU{server.cpuCores ? ` (${server.cpuCores} cores)` : ''}
                            </span>
                            <span className={`metric-val ${cpuColor}`}>{server.cpuUsage}%</span>
                          </div>
                          <div className="progress-track">
                            <div className={`progress-bar ${cpuColor}`} style={{ width:`${Math.min(100,server.cpuUsage)}%` }} />
                          </div>
                        </div>

                        {/* RAM */}
                        <div className="metric-row">
                          <div className="metric-label-row">
                            <span className="metric-label">
                              <HardDrive size={12} /> Memory
                            </span>
                            <span className={`metric-val ${ramColor}`}>{server.ramUsage.usagePercent}%</span>
                          </div>
                          <div className="progress-track">
                            <div className={`progress-bar ${ramColor}`} style={{ width:`${Math.min(100,server.ramUsage.usagePercent)}%` }} />
                          </div>
                          <div className="metric-sub">
                            {fmtBytes(server.ramUsage.usedBytes)} / {fmtBytes(server.ramUsage.totalBytes)}
                          </div>
                        </div>

                        {/* Disk */}
                        {server.diskUsage?.totalBytes > 0 && (
                          <div className="metric-row">
                            <div className="metric-label-row">
                              <span className="metric-label">
                                <Database size={12} /> Storage
                              </span>
                              <span className={`metric-val ${diskColor}`}>{server.diskUsage.usagePercent}%</span>
                            </div>
                            <div className="progress-track">
                              <div className={`progress-bar ${diskColor}`} style={{ width:`${Math.min(100,server.diskUsage.usagePercent)}%` }} />
                            </div>
                            <div className="metric-sub">
                              {fmtBytes(server.diskUsage.usedBytes)} / {fmtBytes(server.diskUsage.totalBytes)}
                            </div>
                          </div>
                        )}

                        {/* Load average */}
                        <div className="metric-row">
                          <span className="metric-label" style={{ marginBottom:4 }}>
                            <Layers size={12} /> Load Average
                          </span>
                          <div className="load-row">
                            {[['1m', server.loadAverage.oneMin], ['5m', server.loadAverage.fiveMin], ['15m', server.loadAverage.fifteenMin]].map(([lbl, val]) => (
                              <div key={lbl} className="load-item">
                                <span className="load-item-val">{val}</span>
                                <span className="load-item-label">{lbl}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Services */}
                        {server.services?.length > 0 && (
                          <div className="services-section">
                            <div className="services-section-title">
                              <Activity size={11} /> Services
                            </div>
                            <div className="service-list">
                              {server.services.map((svc, i) => (
                                <div key={i} className="service-row" title={svc.output || ''}>
                                  <span className="service-name">{svc.name}</span>
                                  <span className={`service-badge ${serviceClass(svc.status)}`}>
                                    {svc.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Combustion tracker */}
              <div className="card" style={{ padding:20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, paddingBottom:14, borderBottom:'1px solid var(--border-light)', marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text-1)', display:'flex', alignItems:'center', gap:6 }}>
                      <Zap size={14} style={{ color:'var(--warning)' }} /> Resource Combustion Tracker
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-3)', marginTop:2 }}>CPU & RAM peaks across all servers</div>
                  </div>
                  <div className="combustion-counts">
                    <div className="combustion-count-card">
                      <div className="combustion-count-label accent">Above 80%</div>
                      <div className="combustion-count-row">
                        <span>Live: <strong>{combustionData.counts.current80Count}</strong></span>
                        <span>24h: <strong>{combustionData.counts.peak24h80Count}</strong></span>
                        <span>7w: <strong>{combustionData.counts.peak7d80Count}</strong></span>
                      </div>
                    </div>
                    <div className="combustion-count-card">
                      <div className="combustion-count-label danger">Above 90%</div>
                      <div className="combustion-count-row">
                        <span>Live: <strong>{combustionData.counts.current90Count}</strong></span>
                        <span>24h: <strong>{combustionData.counts.peak24h90Count}</strong></span>
                        <span>7w: <strong>{combustionData.counts.peak7d90Count}</strong></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
                  {/* 24h peaks */}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text-2)', display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
                      <Clock size={12} style={{ color:'var(--accent)' }} /> Exceeded 80% · Last 24h
                    </div>
                    {combustionData.above80in24h.length === 0
                      ? <p style={{ fontSize:12, color:'var(--text-3)' }}>No servers exceeded 80%</p>
                      : <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          {combustionData.above80in24h.map(item => (
                            <div key={item.serverId} className="combustion-list-item">
                              <span className="combustion-server-name">{item.serverName}</span>
                              <div className="combustion-metrics">
                                <span style={{ color: item.maxCpu >= 80 ? 'var(--cpu-color)' : 'var(--text-3)' }}>CPU {item.maxCpu}%</span>
                                <span style={{ color: item.maxRam >= 80 ? 'var(--ram-color)' : 'var(--text-3)' }}>RAM {item.maxRam}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                  {/* 7w peaks */}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text-2)', display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
                      <Calendar size={12} style={{ color:'var(--accent)' }} /> Exceeded 80% · Past 7 Weeks
                    </div>
                    {combustionData.above80in7d.length === 0
                      ? <p style={{ fontSize:12, color:'var(--text-3)' }}>No servers exceeded 80%</p>
                      : <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          {combustionData.above80in7d.map(item => (
                            <div key={item.serverId} className="combustion-list-item">
                              <span className="combustion-server-name">{item.serverName}</span>
                              <div className="combustion-metrics">
                                <span style={{ color: item.maxCpu >= 80 ? 'var(--cpu-color)' : 'var(--text-3)' }}>CPU {item.maxCpu}%</span>
                                <span style={{ color: item.maxRam >= 80 ? 'var(--ram-color)' : 'var(--text-3)' }}>RAM {item.maxRam}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SERVICES VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'services' && (
        <main style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Sify alert strip */}
          <div className="sify-alert-strip">
            <div>
              <div className="sify-alert-title"><Globe size={14} /> Sify Web Application Monitor</div>
              <div className="sify-alert-desc">
                Trigger: HTTP non-OK on <code style={{ fontFamily:'var(--font-mono)', fontSize:11 }}>https://anvaya.sify.net/sify/</code>
              </div>
            </div>
            {sslData.find(d => d.domain === 'anvaya.sify.net')?.http.ok
              ? <span className="service-badge ok" style={{ fontSize:11, padding:'4px 10px' }}>ONLINE · 302 Found</span>
              : <span className="service-badge critical" style={{ fontSize:11, padding:'4px 10px' }}>OFFLINE · Non-OK</span>
            }
          </div>

          <div className="card" style={{ padding:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--border-light)' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text-1)', display:'flex', alignItems:'center', gap:6 }}>
                <Database size={14} /> Service Checks
              </div>
              <div className="filter-tabs">
                {['all','mysql','mongodb','apache'].map(f => (
                  <button key={f} className={`tab-btn ${serviceFilter===f?'active':''}`} onClick={() => setServiceFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {servers.length === 0
              ? <div className="empty-state" style={{ padding:40 }}>
                  <Database size={24} className="empty-state-icon" />
                  <p>No server data yet — waiting for Nagios data.</p>
                </div>
              : <div className="services-grid">
                  {servers.map(server => {
                    let filtered = server.services || [];
                    if (serviceFilter === 'mysql')   filtered = filtered.filter(s => /mysql|mariadb|sql/i.test(s.name));
                    if (serviceFilter === 'mongodb')  filtered = filtered.filter(s => /mongo/i.test(s.name));
                    if (serviceFilter === 'apache')   filtered = filtered.filter(s => /apache|http|nginx|sify/i.test(s.name));
                    if (filtered.length === 0 && serviceFilter !== 'all') return null;

                    return (
                      <div key={server.serverId} className="service-card">
                        <div className="service-card-header">
                          <span className="service-card-title">{server.serverName}</span>
                          <span className="service-card-time">{new Date(server.timestamp).toLocaleTimeString()}</span>
                        </div>
                        {filtered.length === 0
                          ? <div style={{ fontSize:12, color:'var(--text-3)', textAlign:'center', padding:'12px 0' }}>No services</div>
                          : filtered.map((svc, i) => {
                              let icon = <Activity size={12} />;
                              if (/mysql|sql|mariadb/i.test(svc.name)) icon = <Database size={12} />;
                              else if (/mongo/i.test(svc.name)) icon = <Database size={12} style={{ color:'#4DB33D' }} />;
                              else if (/apache|http|nginx|sify/i.test(svc.name)) icon = <Globe size={12} />;

                              return (
                                <div key={i} style={{ borderBottom: i < filtered.length-1 ? '1px solid var(--border-light)' : 'none', paddingBottom: i < filtered.length-1 ? 8 : 0 }}>
                                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                    <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--text-1)', fontWeight:500 }}>
                                      {icon} {svc.name}
                                    </span>
                                    <span className={`service-badge ${serviceClass(svc.status)}`}>{svc.status}</span>
                                  </div>
                                  {svc.output && (
                                    <div style={{ fontSize:11, color:'var(--text-3)', marginTop:3, fontFamily:'var(--font-mono)', wordBreak:'break-all' }}>
                                      {svc.output.slice(0, 120)}{svc.output.length > 120 ? '…' : ''}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                        }
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SSL VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'ssl' && (
        <main>
          <div className="card" style={{ padding:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, marginBottom:16, paddingBottom:14, borderBottom:'1px solid var(--border-light)' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text-1)', display:'flex', alignItems:'center', gap:6 }}>
                  <Lock size={14} /> SSL Certificates & Domain Expiry
                </div>
                <div style={{ fontSize:12, color:'var(--text-3)', marginTop:2 }}>
                  Real-time TLS certificate and WHOIS domain expiry tracking
                </div>
              </div>
              <button className="btn" onClick={() => fetchSslData()} disabled={sslLoading}>
                <RefreshCw size={12} className={sslLoading ? 'spin' : ''} /> Live Recheck
              </button>
            </div>

            {sslLoading && sslData.length === 0
              ? <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'48px 0', color:'var(--text-3)', fontSize:13 }}>
                  <RefreshCw size={16} className="spin" /> Checking TLS handshakes & domain registries…
                </div>
              : <div style={{ overflowX:'auto' }}>
                  <table className="ssl-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Domain</th>
                        <th>HTTP</th>
                        <th>SSL Expiry</th>
                        <th>Issuer</th>
                        <th>Domain Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sslData.map((item, i) => {
                        const sslDays = item.ssl.daysRemaining;
                        const regDays = item.registrar.daysRemaining;

                        const sslClass = item.ssl.error ? 'danger' : sslDays < 15 ? 'danger' : sslDays < 30 ? 'warning' : 'ok';
                        const regClass = item.registrar.error ? '' : regDays < 30 ? 'danger' : regDays < 60 ? 'warning' : 'ok';

                        return (
                          <tr key={i}>
                            <td style={{ fontWeight:600, color:'var(--text-1)' }}>{item.name}</td>
                            <td>
                              <a className="domain-link" href={item.url} target="_blank" rel="noopener noreferrer">
                                {item.domain}
                              </a>
                            </td>
                            <td>
                              <span className={`service-badge ${item.http.ok ? 'ok' : 'critical'}`}>
                                {item.http.status} {item.http.statusText}
                              </span>
                            </td>
                            <td>
                              {item.ssl.error
                                ? <span style={{ color:'var(--danger)', fontSize:12 }}>{item.ssl.error}</span>
                                : <div>
                                    <div className={`days-badge ${sslClass}`}>{sslDays} days</div>
                                    <div style={{ fontSize:11, color:'var(--text-3)' }}>
                                      Exp: {new Date(item.ssl.expiryDate).toLocaleDateString()}
                                    </div>
                                  </div>
                              }
                            </td>
                            <td style={{ fontSize:12, color:'var(--text-2)' }}>{item.ssl.issuer || '—'}</td>
                            <td>
                              {item.registrar.error
                                ? <span style={{ fontSize:11, color:'var(--text-3)' }}>{item.registrar.error}</span>
                                : <div>
                                    <div className={`days-badge ${regClass}`}>{regDays} days</div>
                                    <div style={{ fontSize:11, color:'var(--text-3)' }}>
                                      Exp: {new Date(item.registrar.expiryDate).toLocaleDateString()}
                                    </div>
                                  </div>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          ANALYTICS VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'analytics' && (
        <main style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div className="analytics-grid">
            {/* Main chart */}
            <div className="chart-panel">
              <div className="chart-header">
                <div>
                  <div className="chart-title">
                    <TrendingUp size={14} /> Performance History
                  </div>
                  {/* View mode toggle */}
                  <div style={{ display:'flex', gap:6, marginTop:8 }}>
                    <div className="tab-group">
                      <button className={`tab-btn ${chartViewMode==='cluster'?'active':''}`} onClick={() => setChartViewMode('cluster')}>Cluster</button>
                      <button className={`tab-btn ${chartViewMode==='single'?'active':''}`} onClick={() => setChartViewMode('single')}>Single Server</button>
                    </div>
                  </div>
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end' }}>
                  {chartViewMode === 'cluster' ? (
                    <div className="tab-group">
                      {[['ram','RAM 24h'],['load-peaks','Load Peaks'],['weekly','Weekly'],['monthly','Monthly']].map(([id,lbl]) => (
                        <button key={id} className={`tab-btn ${activeTab===id?'active':''}`} onClick={() => setActiveTab(id)}>{lbl}</button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <select
                        value={selectedServerId}
                        onChange={e => setSelectedServerId(e.target.value)}
                        style={{ fontSize:12, color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'4px 8px', background:'var(--surface)', fontFamily:'var(--font-sans)', outline:'none' }}
                      >
                        {servers.map(s => <option key={s.serverId} value={s.serverId}>{s.serverName}</option>)}
                      </select>
                      <div className="tab-group">
                        <button className={`tab-btn ${singleServerTimeframe==='24h'?'active':''}`} onClick={() => setSingleServerTimeframe('24h')}>24h</button>
                        <button className={`tab-btn ${singleServerTimeframe==='7d'?'active':''}`}  onClick={() => setSingleServerTimeframe('7d')}>7d</button>
                      </div>
                    </div>
                  )}

                  {(activeTab === 'weekly' || activeTab === 'monthly') && chartViewMode === 'cluster' && (
                    <div className="tab-group">
                      {[['ram','RAM'],['cpu','CPU'],['load','Load']].map(([id,lbl]) => (
                        <button key={id} className={`tab-btn ${weeklyMetricTab===id?'active':''}`} onClick={() => setWeeklyMetricTab(id)}>{lbl}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="chart-container">
                {chartViewMode === 'cluster' ? (
                  activeTab === 'ram' ? (
                    servers.length === 0
                      ? <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-3)', fontSize:12 }}>Waiting for server data…</div>
                      : <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={ramHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                            <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                            <YAxis stroke="var(--text-3)" unit="%" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                            <Tooltip {...chartTooltipStyle} />
                            <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} iconType="circle" />
                            <Line type="monotone" name="Avg Cluster RAM" dataKey="avgRam" stroke="var(--ram-color)" strokeWidth={2} dot={false} activeDot={{ r:4, strokeWidth:0 }} />
                            <Line type="monotone" name="Peak Cluster RAM" dataKey="maxRam" stroke="var(--danger)"   strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r:4, strokeWidth:0 }} />
                          </LineChart>
                        </ResponsiveContainer>
                  ) : activeTab === 'load-peaks' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={peakAnalysis} margin={{ top:8, right:16, left:0, bottom:0 }}>
                        <defs>
                          <linearGradient id="gradLoad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                        <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                        <YAxis stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                        <Tooltip {...chartTooltipStyle} />
                        <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} iconType="circle" />
                        <Area type="monotone" name="Avg Load" dataKey="avgLoad" stroke="var(--accent)" fill="url(#gradLoad)" strokeWidth={1.5} />
                        <Area type="monotone" name="Max Load" dataKey="maxLoad" stroke="var(--danger)" fill="none"              strokeWidth={1} strokeDasharray="4 4" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activeTab==='monthly' ? monthlyHistory : weeklyHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                        <XAxis dataKey="dateLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                        <YAxis stroke="var(--text-3)" unit={weeklyMetricTab==='load'?'':'%'} tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                        <Tooltip {...chartTooltipStyle} />
                        <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} iconType="circle" />
                        <Line type="monotone"
                          name={weeklyMetricTab==='ram'?'Avg RAM':weeklyMetricTab==='cpu'?'Avg CPU':'Avg Load'}
                          dataKey={weeklyMetricTab==='ram'?'avgRam':weeklyMetricTab==='cpu'?'avgCpu':'avgLoad'}
                          stroke="var(--accent)" strokeWidth={2} dot={{ r:2 }} activeDot={{ r:4, strokeWidth:0 }}
                        />
                        <Line type="monotone"
                          name={weeklyMetricTab==='ram'?'Peak RAM':weeklyMetricTab==='cpu'?'Peak CPU':'Peak Load'}
                          dataKey={weeklyMetricTab==='ram'?'maxRam':weeklyMetricTab==='cpu'?'maxCpu':'maxLoad'}
                          stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r:2 }} activeDot={{ r:4, strokeWidth:0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  // Single server
                  singleServerHistory.length === 0
                    ? <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-3)', fontSize:12 }}>
                        No history data yet for this server.
                      </div>
                    : <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={singleServerHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                          <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                          <YAxis yAxisId="left"  stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} unit="%" domain={[0,100]} />
                          <YAxis yAxisId="right" orientation="right" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                          <Tooltip {...chartTooltipStyle} />
                          <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} iconType="circle" />
                          <Line yAxisId="left"  type="monotone" name="CPU %"   dataKey="cpuUsage"    stroke="var(--cpu-color)" strokeWidth={2} dot={false} activeDot={{ r:4 }} />
                          <Line yAxisId="left"  type="monotone" name="RAM %"   dataKey="ramUsage"    stroke="var(--ram-color)" strokeWidth={2} dot={false} activeDot={{ r:4 }} />
                          <Line yAxisId="right" type="monotone" name="Load 1m" dataKey="loadAverage" stroke="var(--load-color)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} activeDot={{ r:4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Stats panel */}
            <div className="stats-panel">
              <div className="stats-panel-title">
                <Clock size={14} /> Workload Analytics
              </div>

              <div className="insight-block">
                <div className="insight-label">Busiest Hour</div>
                <div className="insight-value">{busiestHour.hour}</div>
                <div className="insight-desc">Peak load of <strong>{busiestHour.load}</strong> across all servers historically.</div>
              </div>

              <div>
                <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', color:'var(--text-3)', marginBottom:8 }}>7-Week Fleet Summary</div>
                <div className="summary-grid">
                  {[
                    { lbl:'CPU Avg', val:weeklySummary.avgCpu, peak:weeklySummary.maxCpu },
                    { lbl:'RAM Avg', val:weeklySummary.avgRam, peak:weeklySummary.maxRam },
                    { lbl:'Load Avg',val:weeklySummary.avgLoad,peak:weeklySummary.maxLoad }
                  ].map(c => (
                    <div key={c.lbl} className="summary-cell">
                      <span className="summary-cell-label">{c.lbl}</span>
                      <span className="summary-cell-val">{c.val}</span>
                      <span className="summary-cell-peak">Peak: {c.peak}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <div className="stat-row">
                  <span className="stat-row-label"><HardDrive size={13} /> Peak RAM Server</span>
                  <span className="stat-row-val" style={{ color:'var(--ram-color)' }}>{highestRam.name}: {highestRam.val}%</span>
                </div>
                <div className="stat-row">
                  <span className="stat-row-label"><Bell size={13} /> Browser Alerts</span>
                  <span className="stat-row-val">
                    {browserNotifGranted
                      ? <span style={{ color:'var(--success)', display:'flex', alignItems:'center', gap:4 }}><Check size={12} /> Active</span>
                      : <button className="btn" onClick={requestBrowserNotifications} style={{ padding:'2px 8px', fontSize:11 }}>Enable</button>
                    }
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-row-label"><Layers size={13} /> Storage Mode</span>
                  <span className="stat-row-val">MongoDB</span>
                </div>
              </div>

              <details className="guide">
                <summary>Collector Deployment</summary>
                <div className="guide-content">
                  <div className="code-block">{`METRICS_API_URL=http://[IP]:3971/api/metrics \\
SERVER_ID=prod-web-01 \\
SERVER_NAME="Web Server 01" \\
node collector.js`}</div>
                </div>
              </details>
            </div>
          </div>
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          LAPTOP VIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'laptop' && (
        <main style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {laptops.length === 0 ? (
            <div className="empty-state">
              <Laptop size={28} className="empty-state-icon" />
              <h3>No Active Laptops</h3>
              <p>Run the laptop collector agent to start monitoring.</p>
              <div className="code-block" style={{ marginTop:8, maxWidth:500 }}>
{`METRICS_API_URL=http://localhost:3971/api/laptop \\
LAPTOP_ID=my-laptop \\
LAPTOP_NAME="Dev Laptop" \\
node laptop-collector.js`}
              </div>
            </div>
          ) : (
            <>
              {/* Laptop selector */}
              <div className="card" style={{ padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Laptop size={16} style={{ color:'var(--accent)' }} />
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--text-1)' }}>Workspace Device</span>
                </div>
                <select
                  value={selectedLaptopId || ''}
                  onChange={e => setSelectedLaptopId(e.target.value)}
                  style={{ fontSize:12, color:'var(--text-1)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'5px 10px', background:'var(--surface)', fontFamily:'var(--font-sans)', outline:'none' }}
                >
                  {laptops.map(l => <option key={l.laptopId} value={l.laptopId}>{l.laptopName}</option>)}
                </select>
              </div>

              {activeLaptop && (
                <>
                  <div className="hud-grid">
                    {/* Battery */}
                    <div className="hud-card">
                      <div className="hud-card-header">
                        <span className="hud-card-label"><Battery size={12} style={{ color:'var(--success)' }} /> Battery</span>
                        <span className="status-pill" style={{ fontSize:10 }}>
                          {activeLaptop.battery.isCharging
                            ? <><BatteryCharging size={10} style={{ color:'var(--success)' }} /> Charging</>
                            : 'Discharging'
                          }
                        </span>
                      </div>
                      <div className="hud-val">{activeLaptop.battery.percent}<span>%</span></div>
                      <div className="hud-sub">{activeLaptop.battery.status}</div>
                    </div>

                    {/* Thermals */}
                    <div className="hud-card">
                      <div className="hud-card-header">
                        <span className="hud-card-label"><Flame size={12} style={{ color:'var(--danger)' }} /> CPU Temp</span>
                        <span className="status-pill" style={{ fontSize:10, color: activeLaptop.thermals.cpuTemp > 75 ? 'var(--danger)' : 'var(--success)' }}>
                          {activeLaptop.thermals.cpuTemp > 75 ? 'Hot' : 'Normal'}
                        </span>
                      </div>
                      <div className="hud-val">{activeLaptop.thermals.cpuTemp}<span>°C</span></div>
                      <div className="hud-sub">{activeLaptop.thermals.cpuTemp > 75 ? 'Throttling risk' : 'Operating normally'}</div>
                    </div>

                    {/* WiFi */}
                    <div className="hud-card">
                      <div className="hud-card-header">
                        <span className="hud-card-label"><Wifi size={12} /> Wi-Fi</span>
                        <span className="status-pill" style={{ fontSize:10 }}>{activeLaptop.wifi.signalStrength}% signal</span>
                      </div>
                      <div className="hud-val" style={{ fontSize:20, letterSpacing:'-0.01em' }}>{activeLaptop.wifi.ssid}</div>
                      <div className="hud-sub">IP: {activeLaptop.laptopId}</div>
                    </div>

                    {/* Screen time */}
                    <div className="hud-card">
                      <div className="hud-card-header">
                        <span className="hud-card-label"><Monitor size={12} style={{ color:'var(--accent)' }} /> Screen Time</span>
                        <span className="status-pill" style={{ fontSize:10, color:'var(--accent)' }}>Today</span>
                      </div>
                      <div className="hud-val">{Math.floor(activeLaptop.screenTimeToday/60)}<span>h</span> {activeLaptop.screenTimeToday%60}<span>m</span></div>
                      <div className="hud-sub">Activity index: {activeLaptop.activityIndex}/100</div>
                    </div>
                  </div>

                  <div className="analytics-grid">
                    {/* Chart */}
                    <div className="chart-panel">
                      <div className="chart-header">
                        <div className="chart-title"><TrendingUp size={14} /> Laptop Performance (24h)</div>
                        <div className="tab-group">
                          {[['battery','Battery'],['thermals','Thermals'],['productivity','Activity']].map(([id,lbl]) => (
                            <button key={id} className={`tab-btn ${laptopTab===id?'active':''}`} onClick={() => setLaptopTab(id)}>{lbl}</button>
                          ))}
                        </div>
                      </div>
                      <div className="chart-container">
                        {laptopTab === 'battery' ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={laptopHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                              <defs>
                                <linearGradient id="gradBattery" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                              <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                              <YAxis stroke="var(--text-3)" domain={[0,100]} unit="%" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                              <Tooltip {...chartTooltipStyle} />
                              <Area type="monotone" name="Battery %" dataKey="avgBatteryPercent" stroke="var(--success)" fill="url(#gradBattery)" strokeWidth={1.5} />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : laptopTab === 'thermals' ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={laptopHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                              <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                              <YAxis yAxisId="left"  stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} unit="°C" />
                              <YAxis yAxisId="right" orientation="right" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} unit="%" />
                              <Tooltip {...chartTooltipStyle} />
                              <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} iconType="circle" />
                              <Line yAxisId="left"  type="monotone" name="CPU Temp"  dataKey="avgCpuTemp"   stroke="var(--danger)"   strokeWidth={1.5} dot={false} activeDot={{ r:3 }} />
                              <Line yAxisId="right" type="monotone" name="CPU Usage" dataKey="avgCpuUsage"  stroke="var(--cpu-color)" strokeWidth={1.5} dot={false} activeDot={{ r:3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={laptopHistory} margin={{ top:8, right:16, left:0, bottom:0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                              <XAxis dataKey="timeLabel" stroke="var(--text-3)" tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                              <YAxis stroke="var(--text-3)" domain={[0,100]} tickLine={false} axisLine={false} tick={{ fontSize:10 }} />
                              <Tooltip {...chartTooltipStyle} />
                              <Bar name="Keyboard/Mouse Activity" dataKey="avgActivityIndex" fill="var(--accent)" radius={[3,3,0,0]} maxBarSize={20} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>

                    {/* App usage */}
                    <div className="stats-panel">
                      <div className="stats-panel-title"><Monitor size={14} /> App Usage</div>
                      <div className="app-usage-list">
                        {activeLaptop.appUsage.map(app => (
                          <div key={app.name} className="app-usage-item">
                            <div className="app-usage-header">
                              <span className="app-usage-name">{app.name}</span>
                              <span className="app-usage-pct">{app.durationPercent}%</span>
                            </div>
                            <div className="app-progress-track">
                              <div className="app-progress-bar" style={{ width:`${app.durationPercent}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <details className="guide">
                        <summary>Laptop Agent Guide</summary>
                        <div className="guide-content">
                          <div className="code-block">{`node laptop-collector.js`}</div>
                        </div>
                      </details>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      )}
    </>
  );
}
