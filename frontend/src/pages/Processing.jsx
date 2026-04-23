import React, { useState, useEffect, useCallback } from 'react';
import { fetchVideos, fetchVideoFixtures, deleteVideo, reprocessVideo } from '../api';
import { TYPE_COLORS, StatusBadge } from './Dashboard';

function Processing({ navigate }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [fixtures, setFixtures] = useState({});
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchVideos({ limit: 100 })
      .then(data => { setItems(data.videos || []); setTotal(data.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while processing
  useEffect(() => {
    const hasActive = items.some(v => v.status === 'PROCESSING' || v.status === 'PENDING');
    if (!hasActive) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [items, load]);

  const handleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!fixtures[id]) {
      try {
        const f = await fetchVideoFixtures(id);
        setFixtures(prev => ({ ...prev, [id]: f.summary || f.fixtures || f || [] }));
      } catch (_) {}
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este item?')) return;
    setDeleting(id);
    try {
      await deleteVideo(id);
      setItems(prev => prev.filter(v => v.video_id !== id));
    } catch (_) {}
    setDeleting(null);
  };

  const handleReprocess = async (id) => {
    try {
      await reprocessVideo(id);
      load();
    } catch (_) {}
  };

  const q = search.toLowerCase().trim();
  const filtered = q
    ? items.filter(v =>
        (v.filename || '').toLowerCase().includes(q) ||
        (v.status || '').toLowerCase().includes(q) ||
        (v.media_type || '').toLowerCase().includes(q) ||
        (v.detection_model || '').toLowerCase().includes(q))
    : items;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Processamento</h1>
        <span style={{ color: '#6B7280', fontSize: 14 }}>{total} itens</span>
      </div>

      <div className="card" style={{ padding: '12px 16px' }}>
        <input type="text" className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
          placeholder="Buscar por arquivo, status, modelo..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="empty-state">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Nenhum item encontrado.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(v => {
            const isPhoto = (v.media_type || '').toUpperCase() === 'PHOTO';
            const isExpanded = expanded === v.video_id;
            const flist = fixtures[v.video_id] || [];
            return (
              <div key={v.video_id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: deleting === v.video_id ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => handleExpand(v.video_id)}>
                  {/* Thumbnail */}
                  <div style={{ width: 60, height: 45, borderRadius: 6, overflow: 'hidden', background: '#F3F4F6', flexShrink: 0 }}>
                    {v.thumbnail_path
                      ? <img src={`/api/thumbnails/${v.video_id}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{isPhoto ? '🖼️' : '🎬'}</div>}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.filename}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      <span>{isPhoto ? 'Foto' : 'Video'}</span>
                      {v.video_date && <span>{new Date(v.video_date).toLocaleDateString('pt-BR')}</span>}
                      {v.detection_model && <span style={{ background: '#EEF2FF', color: '#4338CA', padding: '1px 6px', borderRadius: 8, fontSize: 11 }}>{v.detection_model}</span>}
                      {!isPhoto && v.duration_seconds > 0 && <span>{Math.round(v.duration_seconds)}s</span>}
                    </div>
                  </div>

                  {/* Type tags */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 200 }}>
                    {v.type_counts && Object.entries(v.type_counts).map(([type, count]) => (
                      <span key={type} className="fixture-type-badge" style={{ background: TYPE_COLORS[type] || '#888', fontSize: 11 }}>
                        {type}: {count}
                      </span>
                    ))}
                  </div>

                  {/* Status + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={v.status} />
                    {deleting === v.video_id ? (
                      <span style={{ fontSize: 12, color: '#6B7280' }}>Excluindo...</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        {v.status === 'COMPLETED' && <button className="btn btn-sm" onClick={() => handleReprocess(v.video_id)}>Reprocessar</button>}
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(v.video_id)}>Excluir</button>
                      </div>
                    )}
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Progress bar */}
                {(v.status === 'PROCESSING' || v.status === 'PENDING') && (
                  <div style={{ padding: '0 16px 8px' }}>
                    <div className="training-progress-bar-track">
                      <div className="training-progress-bar-fill" style={{ width: `${v.progress_pct || 5}%`, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                )}

                {/* Expanded: fixture details */}
                {isExpanded && (
                  <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #F3F4F6' }}>
                    {v.status === 'PROCESSING' || v.status === 'PENDING' ? (
                      <div style={{ padding: 8, color: '#6B7280', fontSize: 13 }}>Processando...</div>
                    ) : v.status === 'FAILED' ? (
                      <div style={{ padding: 8, color: '#EF4444', fontSize: 13 }}>{v.error_message || 'Falha no processamento'}</div>
                    ) : !flist || flist.length === 0 ? (
                      <div className="empty-state" style={{ padding: 12 }}>Nenhum objeto detectado</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {flist.map(s => (
                          <div key={s.fixture_type} style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[s.fixture_type] || '#666', marginRight: 6 }} />
                            <strong>{s.fixture_type}</strong>: {s.total_count} unidades
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Processing;
