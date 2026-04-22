import React, { useState, useEffect } from 'react';
import { fetchReportSummary, fetchComparison } from '../api';
import { TYPE_COLORS, OccupancyBar } from './Dashboard';

function Reports() {
  const [summary, setSummary] = useState([]);
  const [comparison, setComparison] = useState([]);
  const [tab, setTab] = useState('summary');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchReportSummary().then(setSummary).catch(() => {});
    fetchComparison().then(setComparison).catch(() => {});
  }, []);

  function downloadCSV() { window.open('/api/reports/export/csv', '_blank'); }
  function downloadJSON() { window.open('/api/reports/export/json', '_blank'); }

  const q = search.toLowerCase().trim();

  const filteredSummary = q
    ? summary.filter(r =>
        (r.fixture_type || '').toLowerCase().includes(q) ||
        (r.video_date || '').toLowerCase().includes(q) ||
        (r.filename || '').toLowerCase().includes(q) ||
        (r.store_id || '').toLowerCase().includes(q) ||
        String(r.total_count || '').includes(q)
      )
    : summary;

  const filteredComparison = q
    ? comparison.filter(r =>
        (r.store_id || '').toLowerCase().includes(q) ||
        String(r.total_fixtures || '').includes(q)
      )
    : comparison;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Relatorios</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={downloadCSV}>Exportar CSV</button>
          <button className="btn btn-secondary" onClick={downloadJSON}>Exportar JSON</button>
        </div>
      </div>

      <div className="card" style={{ padding: '12px 16px' }}>
        <input
          type="text"
          className="inline-input"
          style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
          placeholder="Buscar por tipo, data, arquivo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Resumo</button>
        <button className={`tab ${tab === 'comparison' ? 'active' : ''}`} onClick={() => setTab('comparison')}>Comparativo</button>
      </div>

      {tab === 'summary' && (
        <div className="card">
          <h3>Resumo de Deteccoes</h3>
          <table className="data-table">
            <thead>
              <tr><th>Tipo</th><th>Data</th><th>Qtd</th><th>Ocupacao</th><th>Vazio</th><th>Parcial</th><th>Cheio</th></tr>
            </thead>
            <tbody>
              {filteredSummary.map((r, i) => (
                <tr key={i}>
                  <td><span className="fixture-type-badge" style={{ background: TYPE_COLORS[r.fixture_type] || '#666' }}>{r.fixture_type}</span></td>
                  <td>{r.video_date || '-'}</td>
                  <td><strong>{r.total_count}</strong></td>
                  <td><OccupancyBar pct={Math.round(r.avg_occupancy_pct || 0)} /></td>
                  <td>{r.empty_count}</td>
                  <td>{r.partial_count}</td>
                  <td>{r.full_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredSummary.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
        </div>
      )}

      {tab === 'comparison' && (
        <div className="card">
          <h3>Comparativo</h3>
          <table className="data-table">
            <thead>
              <tr><th>Identificador</th><th>Total Deteccoes</th><th>Ocupacao Media</th></tr>
            </thead>
            <tbody>
              {filteredComparison.map((r, i) => (
                <tr key={i}>
                  <td>{r.store_id || '-'}</td>
                  <td><strong>{r.total_fixtures}</strong></td>
                  <td><OccupancyBar pct={Math.round(r.avg_occupancy || 0)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredComparison.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
        </div>
      )}
    </div>
  );
}

export default Reports;
