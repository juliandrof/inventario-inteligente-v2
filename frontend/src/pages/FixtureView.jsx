import React, { useState, useEffect } from 'react';
import { fetchFixtures } from '../api';
import { OccupancyBar, TYPE_COLORS } from './Dashboard';

function FixtureView() {
  const [fixtures, setFixtures] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchFixtures().then(d => { setFixtures(d.fixtures || []); setTotal(d.total || 0); }).catch(() => {});
  }, []);

  const filtered = search.trim()
    ? fixtures.filter(f => {
        const q = search.toLowerCase();
        return (
          (f.fixture_type || '').toLowerCase().includes(q) ||
          (f.display_name || '').toLowerCase().includes(q) ||
          (f.video_date || '').toLowerCase().includes(q) ||
          (f.filename || '').toLowerCase().includes(q) ||
          (f.ai_description || '').toLowerCase().includes(q) ||
          (f.position_zone || '').toLowerCase().includes(q) ||
          (f.store_id || '').toLowerCase().includes(q) ||
          (f.uf || '').toLowerCase().includes(q) ||
          String(f.occupancy_pct || '').includes(q)
        );
      })
    : fixtures;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Deteccoes ({filtered.length})</h1>
      </div>

      <div className="card" style={{ padding: '12px 16px' }}>
        <input
          type="text"
          className="inline-input"
          style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
          placeholder="Buscar por tipo, arquivo, data, descricao..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Arquivo</th>
              <th>Data</th>
              <th>Qtd</th>
              <th>Ocupacao</th>
              <th>Descricao</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f, i) => (
              <tr key={i}>
                <td>
                  <span className="fixture-type-badge" style={{ background: TYPE_COLORS[f.fixture_type] || '#666' }}>
                    {f.display_name || f.fixture_type}
                  </span>
                </td>
                <td className="filename">{f.filename || '-'}</td>
                <td>{f.video_date || '-'}</td>
                <td><strong>{f.frame_count || 1}</strong></td>
                <td><OccupancyBar pct={Math.round(f.occupancy_pct || 0)} /></td>
                <td className="desc-cell">{f.ai_description || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-state">Nenhum objeto detectado</div>}
      </div>
    </div>
  );
}

export default FixtureView;
