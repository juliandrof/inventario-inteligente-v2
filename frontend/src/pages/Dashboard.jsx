import React, { useState, useEffect } from 'react';
import { fetchDashboardSummary, fetchDashboardByType, fetchRecentVideos, fetchContexts } from '../api';

export const TYPE_COLORS = {};
export function updateTypeColors(types) {
  const palette = ['#E11D48','#2563EB','#16A34A','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#D97706','#059669','#DC2626','#7C3AED','#0891B2'];
  (types || []).forEach((ft, i) => {
    if (ft.color) TYPE_COLORS[ft.name] = ft.color;
    else if (!TYPE_COLORS[ft.name]) TYPE_COLORS[ft.name] = palette[i % palette.length];
  });
}

function Dashboard({ navigate }) {
  const [summary, setSummary] = useState({});
  const [byType, setByType] = useState([]);
  const [recent, setRecent] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [selContext, setSelContext] = useState('');

  useEffect(() => {
    fetchContexts().then(c => setContexts(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  useEffect(() => {
    const f = selContext ? { context_id: selContext } : {};
    fetchDashboardSummary(f).then(setSummary).catch(() => {});
    fetchDashboardByType(f).then(setByType).catch(() => {});
    fetchRecentVideos(f).then(setRecent).catch(() => {});
  }, [selContext]);

  const totalDetections = byType.reduce((s, r) => s + (r.total || 0), 0);
  const maxTypeCount = Math.max(...byType.map(r => r.total || 0), 1);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        {contexts.length > 1 && (
          <select className="inline-input" style={{ padding: '6px 12px', fontSize: 13 }}
            value={selContext} onChange={e => setSelContext(e.target.value)}>
            <option value="">Todos os contextos</option>
            {contexts.map(c => <option key={c.context_id || c.id} value={c.context_id || c.id}>{c.display_name || c.name}</option>)}
          </select>
        )}
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard label="Videos/Fotos" value={summary.total_videos || 0} />
        <KpiCard label="Processados" value={summary.completed_videos || 0} accent />
        <KpiCard label="Total Deteccoes" value={totalDetections} />
        <KpiCard label="Tipos Detectados" value={byType.length} />
        {(summary.processing_videos || 0) > 0 && (
          <KpiCard label="Em Processamento" value={summary.processing_videos} warning />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Detections by Type - horizontal bar chart */}
        <div className="card">
          <h3>Deteccoes por Tipo</h3>
          {byType.length === 0 ? (
            <div className="empty-state">Sem dados</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byType.map(r => (
                <div key={r.fixture_type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 100, fontSize: 12, fontWeight: 500, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fixture_type}</span>
                  <div style={{ flex: 1, height: 24, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(r.total / maxTypeCount) * 100}%`, height: '100%',
                      background: TYPE_COLORS[r.fixture_type] || '#2563EB', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
                      color: '#fff', fontSize: 11, fontWeight: 600, minWidth: 30,
                    }}>{r.total}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Type Distribution - donut visual */}
        <div className="card">
          <h3>Distribuicao por Tipo</h3>
          {byType.length === 0 ? (
            <div className="empty-state">Sem dados</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {byType.map(r => {
                const pct = totalDetections ? Math.round((r.total / totalDetections) * 100) : 0;
                return (
                  <div key={r.fixture_type} style={{ textAlign: 'center', minWidth: 80 }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '50%', margin: '0 auto 6px',
                      background: `conic-gradient(${TYPE_COLORS[r.fixture_type] || '#2563EB'} ${pct}%, #F3F4F6 0)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                        {pct}%
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 500 }}>{r.fixture_type}</div>
                    <div style={{ fontSize: 11, color: '#6B7280' }}>{r.total}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <h3>Atividade Recente</h3>
        {recent.length === 0 ? (
          <div className="empty-state">Nenhum processamento recente</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Arquivo</th><th>Status</th><th>Deteccoes</th><th>Data</th></tr>
            </thead>
            <tbody>
              {recent.slice(0, 15).map(v => (
                <tr key={v.video_id} style={{ cursor: 'pointer' }} onClick={() => navigate && navigate('processing')}>
                  <td className="filename">{v.filename}</td>
                  <td><StatusBadge status={v.status} /></td>
                  <td><strong>{v.fixture_count || 0}</strong></td>
                  <td>{v.upload_timestamp ? new Date(v.upload_timestamp).toLocaleDateString('pt-BR') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent, warning }) {
  const bg = warning ? '#FEF3C7' : accent ? '#F0FDF4' : '#F9FAFB';
  const color = warning ? '#92400E' : accent ? '#166534' : 'var(--app-dark)';
  return (
    <div style={{ background: bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const colors = { COMPLETED: '#10B981', PROCESSING: '#F59E0B', PENDING: '#6B7280', FAILED: '#EF4444' };
  const labels = { COMPLETED: 'Concluido', PROCESSING: 'Processando', PENDING: 'Pendente', FAILED: 'Falhou' };
  return <span className="status-badge" style={{ background: colors[status] || '#6B7280' }}>{labels[status] || status}</span>;
}

export function OccupancyBar({ pct }) {
  const color = pct < 30 ? '#EF4444' : pct < 70 ? '#F59E0B' : '#10B981';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: '#E5E7EB', borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, color: '#6B7280' }}>{pct}%</span>
    </div>
  );
}

export default Dashboard;
