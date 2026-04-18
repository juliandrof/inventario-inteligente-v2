import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo, reprocessVideo, fetchVideoFixtures, fetchFilters } from '../api';
import { StatusBadge, TYPE_COLORS, updateTypeColors } from './Dashboard';

function PhotoList({ navigate }) {
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState('');
  const [selStore, setSelStore] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [fixtures, setFixtures] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => { fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {}); }, []);

  function loadPhotos() {
    const f = { media_type: 'PHOTO' };
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    fetchVideos(f).then(d => {
      setPhotos(d.videos || []);
      setTotal(d.total || 0);
    }).catch(() => {});
  }

  useEffect(() => { loadPhotos(); }, [selUF, selStore]);

  useEffect(() => {
    const hasProcessing = photos.some(p => p.status === 'PROCESSING' || p.status === 'PENDING');
    if (!hasProcessing) return;
    const t = setInterval(loadPhotos, 3000);
    return () => clearInterval(t);
  }, [photos, selUF, selStore]);

  useEffect(() => {
    if (!expanded) { setFixtures(null); return; }
    fetchVideoFixtures(expanded).then(setFixtures).catch(() => {});
  }, [expanded]);

  async function handleDelete(id) {
    if (!confirm('Excluir esta foto e todos os dados?')) return;
    await deleteVideo(id);
    setPhotos(p => p.filter(x => x.video_id !== id));
  }

  async function handleReprocess(id) {
    await reprocessVideo(id);
    setPhotos(p => p.map(x => x.video_id === id ? { ...x, status: 'PROCESSING', progress_pct: 0 } : x));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Fotos ({total})</h1>
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
        </div>
      </div>

      <div className="photo-grid">
        {photos.map(p => (
          <div key={p.video_id} className="photo-card">
            <div className="photo-thumb-area" onClick={() => p.status === 'COMPLETED' && setLightbox(p)}>
              {p.status === 'COMPLETED' ? (
                <img src={`/api/videos/${p.video_id}/stream`} alt={p.filename} className="photo-thumb" loading="lazy" />
              ) : (
                <div className="photo-thumb-placeholder">
                  {p.status === 'PROCESSING' ? (
                    <div className="video-processing-overlay">
                      <div className="video-progress-bar">
                        <div className="video-progress-fill" style={{ width: `${p.progress_pct || 0}%` }} />
                      </div>
                      <span>{Math.round(p.progress_pct || 0)}%</span>
                    </div>
                  ) : (
                    <StatusBadge status={p.status} pct={p.progress_pct} />
                  )}
                </div>
              )}
            </div>

            <div className="photo-card-body">
              <div className="video-card-title">{p.filename}</div>
              <div className="video-card-meta">
                <span className="uf-badge">{p.uf}</span>
                <span>Loja {p.store_id}</span>
                <span>{p.video_date}</span>
              </div>

              <div className="video-type-tags" style={{ marginTop: 8 }}>
                {p.type_counts && Object.entries(p.type_counts).map(([type, count]) => (
                  <span key={type} className="det-tag" style={{ background: TYPE_COLORS[type] || '#666' }}>
                    {count}x {type}
                  </span>
                ))}
              </div>

              {p.status === 'COMPLETED' && (
                <button className="btn btn-sm" style={{ marginTop: 8, width: '100%' }}
                  onClick={() => setExpanded(expanded === p.video_id ? null : p.video_id)}>
                  {expanded === p.video_id ? 'Recolher' : 'Ver detalhes'}
                </button>
              )}

              {expanded === p.video_id && fixtures && fixtures.summary?.length > 0 && (
                <div className="expanded-fixtures" style={{ marginTop: 10 }}>
                  <div className="fixture-summary-grid">
                    {fixtures.summary.map(s => (
                      <div key={s.fixture_type} className="fixture-summary-card">
                        <div className="fixture-type-dot" style={{ background: TYPE_COLORS[s.fixture_type] || '#666' }} />
                        <div>
                          <strong>{s.fixture_type}</strong>
                          <div>{s.total_count} unidades</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="video-card-actions">
                {p.status === 'COMPLETED' && (
                  <button className="btn btn-sm" onClick={() => handleReprocess(p.video_id)}>Reprocessar</button>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.video_id)}>Excluir</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {photos.length === 0 && <div className="card"><div className="empty-state">Nenhuma foto encontrada</div></div>}

      {lightbox && (
        <div className="modal-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <img src={`/api/videos/${lightbox.video_id}/stream`} alt={lightbox.filename} className="lightbox-img" />
            <div className="lightbox-info">
              <span>{lightbox.filename}</span>
              <span className="uf-badge">{lightbox.uf}</span>
              <span>Loja {lightbox.store_id}</span>
              <button className="btn btn-sm" onClick={() => setLightbox(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PhotoList;
