import React, { useState, useEffect, useCallback } from 'react';
import { fetchDashboardSummary, fetchDashboardByType, fetchDashboardByUF, fetchDashboardByStore, fetchOccupancy, fetchAnomalies, fetchRecentVideos, fetchFilters } from '../api';

// Mutable color map - populated from DB via fetchFilters, with hardcoded fallback
const TYPE_COLORS = {
  ARARA: '#E11D48', GONDOLA: '#2563EB', CESTAO: '#F59E0B', PRATELEIRA: '#10B981',
  BALCAO: '#8B5CF6', DISPLAY: '#EC4899', CHECKOUT: '#6366F1', MANEQUIM: '#14B8A6',
  MESA: '#F97316', CABIDEIRO_PAREDE: '#84CC16',
};

function updateTypeColors(fixtureTypes) {
  if (!fixtureTypes) return;
  fixtureTypes.forEach(ft => {
    if (ft.name && ft.color) TYPE_COLORS[ft.name] = ft.color;
  });
}

function Dashboard({ navigate }) {
  const [summary, setSummary] = useState(null);
  const [byType, setByType] = useState([]);
  const [byUF, setByUF] = useState([]);
  const [byStore, setByStore] = useState([]);
  const [occupancy, setOccupancy] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [recent, setRecent] = useState([]);
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState('');
  const [selStore, setSelStore] = useState('');

  const load = useCallback(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    fetchDashboardSummary(f).then(setSummary).catch(() => {});
    fetchDashboardByType(f).then(setByType).catch(() => {});
    fetchDashboardByUF().then(setByUF).catch(() => {});
    fetchDashboardByStore(f).then(setByStore).catch(() => {});
    fetchOccupancy(f).then(setOccupancy).catch(() => {});
    fetchAnomalies(f).then(setAnomalies).catch(() => {});
    fetchRecentVideos(f).then(setRecent).catch(() => {});
  }, [selUF, selStore]);

  useEffect(() => { fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const maxByType = Math.max(...byType.map(r => r.total), 1);
  const maxByUF = Math.max(...byUF.map(r => r.total), 1);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <select className="filter-select" value={selUF} onChange={e => { setSelUF(e.target.value); setSelStore(''); }}>
            <option value="">Todas UFs</option>
            {filters.ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="filter-select" value={selStore} onChange={e => setSelStore(e.target.value)}>
            <option value="">Todas Lojas</option>
            {filters.stores.filter(s => !selUF || s.uf === selUF).map(s => (
              <option key={s.store_id} value={s.store_id}>{s.store_id} - {s.name || s.uf}</option>
            ))}
          </select>
        </div>
      </div>

      {summary && (
        <div className="kpi-grid">
          <KPI label="Videos" value={summary.total_videos} sub={`${summary.completed_videos} concluidos`} color="#2563EB" />
          <KPI label="Deteccoes" value={summary.total_fixtures} sub={`${summary.total_stores} lojas`} color="#E11D48" />
          <KPI label="UFs" value={summary.total_ufs} color="#10B981" />
          <KPI label="Ocupacao Media" value={`${summary.avg_occupancy}%`} color="#F59E0B" />
          <KPI label="Anomalias" value={summary.active_anomalies} color={summary.active_anomalies > 0 ? '#EF4444' : '#10B981'} />
          {summary.processing_videos > 0 && (
            <KPI label="Processando" value={summary.processing_videos} color="#8B5CF6" />
          )}
        </div>
      )}

      <div className="dashboard-grid">
        {/* By Fixture Type */}
        <div className="card">
          <h3>Deteccoes por Tipo</h3>
          <div className="bar-chart">
            {byType.map(r => (
              <div key={r.fixture_type} className="bar-row">
                <span className="bar-label">{r.fixture_type}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{
                    width: `${(r.total / maxByType) * 100}%`,
                    background: TYPE_COLORS[r.fixture_type] || '#666',
                  }} />
                </div>
                <span className="bar-value">{r.total}</span>
              </div>
            ))}
            {byType.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
          </div>
        </div>

        {/* By UF */}
        <div className="card">
          <h3>Deteccoes por UF</h3>
          <div className="bar-chart">
            {byUF.map(r => (
              <div key={r.uf} className="bar-row">
                <span className="bar-label">{r.uf}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(r.total / maxByUF) * 100}%`, background: '#2563EB' }} />
                </div>
                <span className="bar-value">{r.total} ({r.store_count} lojas)</span>
              </div>
            ))}
            {byUF.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
          </div>
        </div>

        {/* Occupancy Heatmap */}
        <div className="card">
          <h3>Mapa de Ocupacao por Tipo</h3>
          <OccupancyHeatmap data={occupancy} />
        </div>

        {/* Anomalies */}
        <div className="card">
          <h3>Anomalias Ativas ({anomalies.length})</h3>
          <div className="anomaly-list">
            {anomalies.slice(0, 8).map((a, i) => (
              <div key={i} className={`anomaly-item severity-${a.severity.toLowerCase()}`}>
                <span className="anomaly-badge">{a.severity}</span>
                <span className="anomaly-store">{a.store_id} ({a.uf})</span>
                <span className="anomaly-msg">{a.message}</span>
              </div>
            ))}
            {anomalies.length === 0 && <div className="empty-state">Nenhuma anomalia</div>}
          </div>
        </div>

        {/* Top Stores */}
        <div className="card">
          <h3>Top Locais</h3>
          <table className="data-table">
            <thead>
              <tr><th>Loja</th><th>UF</th><th>Total</th><th>Ocupacao</th></tr>
            </thead>
            <tbody>
              {byStore.slice(0, 10).map(r => (
                <tr key={r.store_id} className="clickable" onClick={() => navigate('fixtures', { store_id: r.store_id })}>
                  <td>{r.store_id}{r.store_name ? ` - ${r.store_name}` : ''}</td>
                  <td><span className="uf-badge">{r.uf}</span></td>
                  <td>{r.total_fixtures}</td>
                  <td><OccupancyBar pct={r.avg_occupancy} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent Videos */}
        <div className="card">
          <h3>Videos Recentes</h3>
          <table className="data-table">
            <thead>
              <tr><th>Arquivo</th><th>Loja</th><th>Status</th><th>Deteccoes</th></tr>
            </thead>
            <tbody>
              {recent.slice(0, 8).map(v => (
                <tr key={v.video_id} className="clickable" onClick={() => navigate('videos', { video_id: v.video_id })}>
                  <td className="filename">{v.filename}</td>
                  <td>{v.store_id} <span className="uf-badge">{v.uf}</span></td>
                  <td><StatusBadge status={v.status} pct={v.progress_pct} /></td>
                  <td>{v.fixture_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color }) {
  return (
    <div className="kpi-card" style={{ borderLeftColor: color }}>
      <div className="kpi-value" style={{ color }}>{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status, pct }) {
  const colors = { COMPLETED: '#10B981', PROCESSING: '#F59E0B', PENDING: '#6B7280', FAILED: '#EF4444' };
  const labels = { COMPLETED: 'Concluido', PROCESSING: `Processando ${Math.round(pct || 0)}%`, PENDING: 'Pendente', FAILED: 'Erro' };
  return <span className="status-badge" style={{ background: colors[status] || '#666' }}>{labels[status] || status}</span>;
}

function OccupancyBar({ pct }) {
  const color = pct < 30 ? '#EF4444' : pct < 70 ? '#F59E0B' : '#10B981';
  return (
    <div className="occ-bar-container">
      <div className="occ-bar" style={{ width: `${pct}%`, background: color }} />
      <span className="occ-label">{pct}%</span>
    </div>
  );
}

function OccupancyHeatmap({ data }) {
  const types = [...new Set(data.map(d => d.fixture_type))];
  const levels = ['VAZIO', 'PARCIAL', 'CHEIO'];
  const levelColors = { VAZIO: '#FEE2E2', PARCIAL: '#FEF3C7', CHEIO: '#D1FAE5' };
  const counts = {};
  data.forEach(d => { counts[`${d.fixture_type}-${d.occupancy_level}`] = d.cnt; });

  if (types.length === 0) return <div className="empty-state">Nenhum dado</div>;

  return (
    <table className="heatmap-table">
      <thead><tr><th></th>{levels.map(l => <th key={l}>{l}</th>)}</tr></thead>
      <tbody>
        {types.map(t => (
          <tr key={t}>
            <td className="heatmap-label">{t}</td>
            {levels.map(l => {
              const val = counts[`${t}-${l}`] || 0;
              return <td key={l} className="heatmap-cell" style={{ background: val > 0 ? levelColors[l] : '#f9fafb' }}>{val}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export { StatusBadge, OccupancyBar, TYPE_COLORS, updateTypeColors };
export default Dashboard;
