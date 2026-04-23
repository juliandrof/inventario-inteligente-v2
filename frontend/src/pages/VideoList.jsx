import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo, reprocessVideo, fetchVideoFixtures, fetchFilters } from '../api';
import { StatusBadge, TYPE_COLORS, updateTypeColors } from './Dashboard';

function VideoList({ navigate, pageParams }) {
  const [videos, setVideos] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState(pageParams?.uf || '');
  const [selStore, setSelStore] = useState(pageParams?.store_id || '');
  const [selStatus, setSelStatus] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [fixtures, setFixtures] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null);

  useEffect(() => { fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {}); }, []);

  function loadVideos() {
    const f = { media_type: 'VIDEO' };
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    if (selStatus) f.status = selStatus;
    fetchVideos(f).then(d => { setVideos(d.videos || []); setTotal(d.total || 0); }).catch(() => {});
  }

  useEffect(() => { loadVideos(); }, [selUF, selStore, selStatus]);

  // Auto-refresh while any video is processing
  useEffect(() => {
    const hasProcessing = videos.some(v => v.status === 'PROCESSING' || v.status === 'PENDING');
    if (!hasProcessing) return;
    const t = setInterval(loadVideos, 3000);
    return () => clearInterval(t);
  }, [videos, selUF, selStore, selStatus]);

  useEffect(() => {
    if (!expanded) { setFixtures(null); return; }
    fetchVideoFixtures(expanded).then(setFixtures).catch(() => {});
  }, [expanded]);

  async function handleDelete(id) {
    if (!confirm('Excluir este video e todos os dados associados?')) return;
    await deleteVideo(id);
    setVideos(v => v.filter(x => x.video_id !== id));
  }

  async function handleReprocess(id) {
    await reprocessVideo(id);
    setVideos(v => v.map(x => x.video_id === id ? { ...x, status: 'PROCESSING', progress_pct: 0 } : x));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Videos ({total})</h1>
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
          <select className="filter-select" value={selStatus} onChange={e => setSelStatus(e.target.value)}>
            <option value="">Todos Status</option>
            <option value="COMPLETED">Concluido</option>
            <option value="PROCESSING">Processando</option>
            <option value="PENDING">Pendente</option>
            <option value="FAILED">Erro</option>
          </select>
        </div>
      </div>

      <div className="video-card-grid">
        {videos.map(v => (
          <div key={v.video_id} className="video-card">
            {/* Thumbnail / Player */}
            <div className="video-thumb-area">
              {playingVideo === v.video_id ? (
                <video
                  className="video-player"
                  src={`/api/videos/${v.video_id}/stream`}
                  controls autoPlay
                  onEnded={() => setPlayingVideo(null)}
                />
              ) : (
                <div className="video-thumb-placeholder" onClick={() => v.status === 'COMPLETED' && setPlayingVideo(v.video_id)}>
                  <div className="video-thumb-bg">
                    <span className="video-thumb-icon">{v.uf}</span>
                    <span className="video-thumb-store">Loja {v.store_id}</span>
                  </div>
                  {v.status === 'COMPLETED' && (
                    <div className="video-play-btn">
                      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                        <circle cx="20" cy="20" r="20" fill="rgba(0,0,0,0.5)"/>
                        <path d="M16 12l12 8-12 8V12z" fill="white"/>
                      </svg>
                    </div>
                  )}
                  {v.status === 'PROCESSING' && (
                    <div className="video-processing-overlay">
                      <div className="video-progress-bar">
                        <div className="video-progress-fill" style={{ width: `${v.progress_pct || 0}%` }} />
                      </div>
                      <span>{Math.round(v.progress_pct || 0)}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="video-card-body">
              <div className="video-card-title">{v.filename}</div>
              <div className="video-card-meta">
                <span className="uf-badge">{v.uf}</span>
                <span>{v.video_date}</span>
                <span>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : ''}</span>
                <StatusBadge status={v.status} pct={v.progress_pct} />
              </div>

              {/* Fixture Tags */}
              <div className="video-type-tags" style={{ marginTop: 8 }}>
                {v.type_counts && Object.entries(v.type_counts).map(([type, count]) => (
                  <span key={type} className="det-tag" style={{ background: TYPE_COLORS[type] || '#666' }}>
                    {count}x {type}
                  </span>
                ))}
                {(!v.type_counts || Object.keys(v.type_counts).length === 0) && v.fixture_count > 0 && (
                  <span className="det-tag" style={{ background: '#666' }}>{v.fixture_count} deteccoes</span>
                )}
              </div>

              {/* Expand details */}
              {v.status === 'COMPLETED' && (
                <button className="btn btn-sm" style={{ marginTop: 8, width: '100%' }}
                  onClick={() => setExpanded(expanded === v.video_id ? null : v.video_id)}>
                  {expanded === v.video_id ? 'Recolher' : 'Ver detalhes'}
                </button>
              )}

              {expanded === v.video_id && fixtures && (
                <div className="expanded-fixtures" style={{ marginTop: 10 }}>
                  {fixtures.summary?.length > 0 ? (
                    <div className="fixture-summary-grid">
                      {fixtures.summary.map(s => (
                        <div key={s.fixture_type} className="fixture-summary-card">
                          <div className="fixture-type-dot" style={{ background: TYPE_COLORS[s.fixture_type] || '#666' }} />
                          <div>
                            <strong>{s.fixture_type}</strong>
                            <div>{s.total_count} unidades</div>
                            <div className="fixture-occ">
                              Occ: {Math.round(s.avg_occupancy_pct || 0)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">Nenhum objeto detectado</div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="video-card-actions">
                {v.status === 'COMPLETED' && (
                  <button className="btn btn-sm" onClick={() => handleReprocess(v.video_id)}>Reprocessar</button>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(v.video_id)}>Excluir</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {videos.length === 0 && <div className="card"><div className="empty-state">Nenhum video encontrado</div></div>}
    </div>
  );
}

export default VideoList;
