import React, { useState, useEffect } from 'react';
import { fetchReportSummary, fetchComparison, fetchFilters } from '../api';
import { TYPE_COLORS, OccupancyBar, updateTypeColors } from './Dashboard';

function Reports() {
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState('');
  const [selStore, setSelStore] = useState('');
  const [summary, setSummary] = useState([]);
  const [comparison, setComparison] = useState([]);
  const [tab, setTab] = useState('summary');

  useEffect(() => { fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {}); }, []);

  useEffect(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    fetchReportSummary(f).then(setSummary).catch(() => {});
    fetchComparison(f).then(setComparison).catch(() => {});
  }, [selUF, selStore]);

  function downloadCSV() {
    const params = new URLSearchParams();
    if (selUF) params.set('uf', selUF);
    if (selStore) params.set('store_id', selStore);
    window.open(`/api/reports/export/csv?${params}`, '_blank');
  }

  function downloadJSON() {
    const params = new URLSearchParams();
    if (selUF) params.set('uf', selUF);
    if (selStore) params.set('store_id', selStore);
    window.open(`/api/reports/export/json?${params}`, '_blank');
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Relatorios</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <select className="filter-select" value={selUF} onChange={e => { setSelUF(e.target.value); setSelStore(''); }}>
            <option value="">Todas UFs</option>
            {filters.ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="filter-select" value={selStore} onChange={e => setSelStore(e.target.value)}>
            <option value="">Todas Lojas</option>
            {filters.stores.filter(s => !selUF || s.uf === selUF).map(s => (
              <option key={s.store_id} value={s.store_id}>{s.store_id}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={downloadCSV}>Exportar CSV</button>
          <button className="btn btn-secondary" onClick={downloadJSON}>Exportar JSON</button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Resumo por Loja</button>
        <button className={`tab ${tab === 'comparison' ? 'active' : ''}`} onClick={() => setTab('comparison')}>Comparativo</button>
      </div>

      {tab === 'summary' && (
        <div className="card">
          <h3>Resumo de Expositores por Loja</h3>
          <table className="data-table">
            <thead>
              <tr><th>UF</th><th>Loja</th><th>Data</th><th>Tipo</th><th>Qtd</th><th>Ocupacao</th><th>Vazio</th><th>Parcial</th><th>Cheio</th></tr>
            </thead>
            <tbody>
              {summary.map((r, i) => (
                <tr key={i}>
                  <td><span className="uf-badge">{r.uf}</span></td>
                  <td>{r.store_id}{r.store_name ? ` - ${r.store_name}` : ''}</td>
                  <td>{r.video_date}</td>
                  <td><span className="fixture-type-badge" style={{ background: TYPE_COLORS[r.fixture_type] || '#666' }}>{r.fixture_type}</span></td>
                  <td><strong>{r.total_count}</strong></td>
                  <td><OccupancyBar pct={Math.round(r.avg_occupancy_pct || 0)} /></td>
                  <td>{r.empty_count}</td>
                  <td>{r.partial_count}</td>
                  <td>{r.full_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
        </div>
      )}

      {tab === 'comparison' && (
        <div className="card">
          <h3>Comparativo entre Lojas</h3>
          <table className="data-table">
            <thead>
              <tr><th>Loja</th><th>UF</th><th>Total Expositores</th><th>Ocupacao Media</th></tr>
            </thead>
            <tbody>
              {comparison.map((r, i) => (
                <tr key={i}>
                  <td>{r.store_id}{r.store_name ? ` - ${r.store_name}` : ''}</td>
                  <td><span className="uf-badge">{r.uf}</span></td>
                  <td><strong>{r.total_fixtures}</strong></td>
                  <td><OccupancyBar pct={Math.round(r.avg_occupancy || 0)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {comparison.length === 0 && <div className="empty-state">Nenhum dado disponivel</div>}
        </div>
      )}
    </div>
  );
}

export default Reports;
