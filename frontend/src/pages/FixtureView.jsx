import React, { useState, useEffect } from 'react';
import { fetchFixtures, fetchFixtureTypes, fetchFilters, fetchTemporal } from '../api';
import { OccupancyBar, TYPE_COLORS, updateTypeColors } from './Dashboard';

function FixtureView({ pageParams }) {
  const [fixtures, setFixtures] = useState([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState(pageParams?.uf || '');
  const [selStore, setSelStore] = useState(pageParams?.store_id || '');
  const [selType, setSelType] = useState('');
  const [temporal, setTemporal] = useState(null);
  const [temporalStore, setTemporalStore] = useState('');

  useEffect(() => {
    fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {});
    fetchFixtureTypes().then(setTypes).catch(() => {});
  }, []);

  useEffect(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    if (selType) f.fixture_type = selType;
    fetchFixtures(f).then(d => { setFixtures(d.fixtures || []); setTotal(d.total || 0); }).catch(() => {});
  }, [selUF, selStore, selType]);

  function loadTemporal(storeId) {
    setTemporalStore(storeId);
    fetchTemporal(storeId).then(setTemporal).catch(() => setTemporal([]));
  }

  // Group temporal data by date
  const temporalByDate = {};
  if (temporal) {
    temporal.forEach(r => {
      const d = String(r.video_date);
      if (!temporalByDate[d]) temporalByDate[d] = {};
      temporalByDate[d][r.fixture_type] = r.total_count;
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Expositores ({total})</h1>
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
          <select className="filter-select" value={selType} onChange={e => setSelType(e.target.value)}>
            <option value="">Todos Tipos</option>
            {types.map(t => <option key={t.name} value={t.name}>{t.display_name}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tipo</th><th>Loja</th><th>UF</th><th>Data</th>
              <th>Ocupacao</th><th>Confianca</th><th>Zona</th><th>Descricao</th><th>Temporal</th>
            </tr>
          </thead>
          <tbody>
            {fixtures.map((f, i) => (
              <tr key={i}>
                <td>
                  <span className="fixture-type-badge" style={{ background: TYPE_COLORS[f.fixture_type] || '#666' }}>
                    {f.display_name || f.fixture_type}
                  </span>
                </td>
                <td>{f.store_id}{f.store_name ? ` - ${f.store_name}` : ''}</td>
                <td><span className="uf-badge">{f.uf}</span></td>
                <td>{f.video_date}</td>
                <td><OccupancyBar pct={Math.round(f.occupancy_pct || 0)} /></td>
                <td>{Math.round((f.avg_confidence || 0) * 100)}%</td>
                <td>{f.position_zone || '-'}</td>
                <td className="desc-cell">{f.ai_description || '-'}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => loadTemporal(f.store_id)}>
                    Comparar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {fixtures.length === 0 && <div className="empty-state">Nenhum expositor encontrado</div>}
      </div>

      {/* Temporal Comparison Panel */}
      {temporal && temporalStore && (
        <div className="card">
          <h3>Evolucao Temporal - Loja {temporalStore}</h3>
          {Object.keys(temporalByDate).length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  {[...new Set(temporal.map(r => r.fixture_type))].map(t => (
                    <th key={t} style={{ color: TYPE_COLORS[t] || '#333' }}>{t}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(temporalByDate).sort().map(([date, types]) => {
                  const allTypes = [...new Set(temporal.map(r => r.fixture_type))];
                  const total = Object.values(types).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={date}>
                      <td>{date}</td>
                      {allTypes.map(t => (
                        <td key={t}>{types[t] || 0}</td>
                      ))}
                      <td><strong>{total}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">Apenas 1 registro para esta loja</div>
          )}
          <button className="btn btn-secondary" onClick={() => { setTemporal(null); setTemporalStore(''); }} style={{ marginTop: 12 }}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

export default FixtureView;
