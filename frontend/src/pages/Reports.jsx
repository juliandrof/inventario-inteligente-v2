import React, { useState, useEffect } from 'react';
import { fetchReportSummary } from '../api';
import { TYPE_COLORS } from './Dashboard';

function Reports() {
  const [summary, setSummary] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchReportSummary().then(setSummary).catch(() => {});
  }, []);

  function downloadCSV() { window.open('/api/reports/export/csv', '_blank'); }
  function downloadJSON() { window.open('/api/reports/export/json', '_blank'); }

  const q = search.toLowerCase().trim();
  const filtered = q
    ? summary.filter(r =>
        (r.fixture_type || '').toLowerCase().includes(q) ||
        (r.video_date || '').toLowerCase().includes(q) ||
        String(r.total_count || '').includes(q))
    : summary;

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
        <input type="text" className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
          placeholder="Buscar por tipo, data..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card">
        <h3>Resumo de Deteccoes</h3>
        <table className="data-table">
          <thead>
            <tr><th>Tipo</th><th>Data</th><th>Qtd</th></tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td><span className="fixture-type-badge" style={{ background: TYPE_COLORS[r.fixture_type] || '#666' }}>{r.fixture_type}</span></td>
                <td>{r.video_date || '-'}</td>
                <td><strong>{r.total_count}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
      </div>
    </div>
  );
}

export default Reports;
