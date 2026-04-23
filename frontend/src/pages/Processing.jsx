import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchVideos, fetchVideoFixtures, fetchVideoDetections, deleteVideo, reprocessVideo, fetchFilters } from '../api';
import { TYPE_COLORS, updateTypeColors, StatusBadge } from './Dashboard';

function Processing({ navigate }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [fixtures, setFixtures] = useState({});
  const [detections, setDetections] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [showFrames, setShowFrames] = useState(null);

  useEffect(() => {
    fetchFilters().then(f => { if (f.fixture_types) updateTypeColors(f.fixture_types); }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetchVideos({ limit: 100 })
      .then(data => { setItems(data.videos || []); setTotal(data.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

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
    if (!detections[id]) {
      try {
        const d = await fetchVideoDetections(id);
        setDetections(prev => ({ ...prev, [id]: d }));
      } catch (_) {}
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este item?')) return;
    setDeleting(id);
    try { await deleteVideo(id); setItems(prev => prev.filter(v => v.video_id !== id)); } catch (_) {}
    setDeleting(null);
  };

  const handleReprocess = async (id) => {
    try { await reprocessVideo(id); load(); } catch (_) {}
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
            const det = detections[v.video_id] || {};
            return (
              <div key={v.video_id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: deleting === v.video_id ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => handleExpand(v.video_id)}>
                  <div style={{ width: 60, height: 45, borderRadius: 6, overflow: 'hidden', background: '#F3F4F6', flexShrink: 0 }}>
                    {v.thumbnail_path
                      ? <img src={`/api/thumbnails/${v.video_id}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{isPhoto ? '🖼️' : '🎬'}</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.filename}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      <span>{isPhoto ? 'Foto' : 'Video'}</span>
                      {v.video_date && <span>{new Date(v.video_date).toLocaleDateString('pt-BR')}</span>}
                      {v.detection_model && <span style={{ background: '#EEF2FF', color: '#4338CA', padding: '1px 6px', borderRadius: 8, fontSize: 11 }}>{v.detection_model}</span>}
                      {!isPhoto && v.duration_seconds > 0 && <span>{Math.round(v.duration_seconds)}s</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 200 }}>
                    {v.type_counts && Object.entries(v.type_counts).map(([type, count]) => (
                      <span key={type} className="fixture-type-badge" style={{ background: TYPE_COLORS[type] || '#888', fontSize: 11 }}>{type}: {count}</span>
                    ))}
                  </div>
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

                {(v.status === 'PROCESSING' || v.status === 'PENDING') && (
                  <div style={{ padding: '0 16px 8px' }}>
                    <div className="training-progress-bar-track">
                      <div className="training-progress-bar-fill" style={{ width: `${v.progress_pct || 5}%`, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                )}

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #F3F4F6' }}>
                    {v.status === 'PROCESSING' || v.status === 'PENDING' ? (
                      <div style={{ padding: 16, color: '#6B7280', fontSize: 13 }}>Processando...</div>
                    ) : v.status === 'FAILED' ? (
                      <div style={{ padding: 16, color: '#EF4444', fontSize: 13 }}>{v.error_message || 'Falha no processamento'}</div>
                    ) : (
                      <>
                        {/* Action buttons */}
                        <div style={{ padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {!isPhoto && (
                            <button className={`btn btn-sm ${playingVideo === v.video_id ? '' : 'btn-primary'}`}
                              onClick={() => setPlayingVideo(playingVideo === v.video_id ? null : v.video_id)}>
                              {playingVideo === v.video_id ? 'Fechar player' : 'Assistir video'}
                            </button>
                          )}
                          <button className={`btn btn-sm ${showFrames === v.video_id ? '' : 'btn-secondary'}`}
                            onClick={() => setShowFrames(showFrames === v.video_id ? null : v.video_id)}>
                            {showFrames === v.video_id ? 'Ocultar frames' : `Ver frames (${(det.frames || []).length})`}
                          </button>
                        </div>

                        {/* Video player with detection overlay */}
                        {!isPhoto && playingVideo === v.video_id && (
                          <div style={{ padding: '0 16px 8px' }}>
                            <DetectionVideoPlayer
                              videoUrl={`/api/videos/${v.video_id}/stream`}
                              bySecond={det.by_second || {}}
                            />
                          </div>
                        )}

                        {/* Photo preview with detections */}
                        {isPhoto && v.thumbnail_path && (
                          <div style={{ padding: '0 16px 8px', position: 'relative', display: 'inline-block' }}>
                            <img src={`/api/thumbnails/${v.video_id}`} alt={v.filename}
                              style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8 }} />
                          </div>
                        )}

                        {/* Frame grid (collapsible) */}
                        {showFrames === v.video_id && (det.frames || []).length > 0 && (
                          <div style={{ padding: '0 16px 12px' }}>
                            <div className="training-frame-grid">
                              {(det.frames || []).map(frame => {
                                const anns = (det.by_second || {})[frame.timestamp_sec] || [];
                                return (
                                  <div key={frame.timestamp_sec} className="training-frame-card">
                                    <div style={{ position: 'relative', background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
                                      {frame.thumbnail_url
                                        ? <img src={frame.thumbnail_url} alt="" className="training-frame-thumb" loading="lazy" />
                                        : <div className="training-frame-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 12 }}>{frame.timestamp_sec}s</div>}
                                      {/* Overlay bounding boxes */}
                                      <div style={{ position: 'absolute', inset: 0 }}>
                                        {anns.map((a, i) => (
                                          <div key={i} style={{
                                            position: 'absolute',
                                            left: `${(a.x || 50) - (a.w || 20) / 2}%`,
                                            top: `${(a.y || 50) - (a.h || 20) / 2}%`,
                                            width: `${a.w || 20}%`,
                                            height: `${a.h || 20}%`,
                                            border: `2px solid ${a.color || TYPE_COLORS[a.fixture_type] || '#10B981'}`,
                                            borderRadius: 3,
                                          }}>
                                            <span style={{
                                              position: 'absolute', top: -14, left: 0,
                                              background: a.color || TYPE_COLORS[a.fixture_type] || '#10B981',
                                              color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: 2,
                                              whiteSpace: 'nowrap',
                                            }}>{a.fixture_type}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="training-frame-info">
                                      <span className="training-frame-name">{frame.timestamp_sec}s</span>
                                      {anns.length > 0 && <span className="training-frame-ann-badge">{anns.length} det.</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Fixture summary */}
                        {flist.length > 0 && (
                          <div style={{ padding: '4px 16px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {flist.map(s => (
                              <div key={s.fixture_type} style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[s.fixture_type] || '#666', marginRight: 6 }} />
                                <strong>{s.fixture_type}</strong>: {s.total_count}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
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


/* Video player with detection bounding boxes overlay */
function DetectionVideoPlayer({ videoUrl, bySecond }) {
  const videoRef = useRef(null);
  const [currentAnns, setCurrentAnns] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const sec = Math.floor(video.currentTime);
      setCurrentAnns(bySecond[sec] || []);
      setCurrentTime(video.currentTime);
    };
    const onMeta = () => setDuration(video.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('loadedmetadata', onMeta); video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); };
  }, [bySecond]);

  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); };
  const seek = (e) => { const v = videoRef.current; if (!v || !duration) return; const rect = e.currentTarget.getBoundingClientRect(); v.currentTime = ((e.clientX - rect.left) / rect.width) * duration; };
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', cursor: 'pointer' }} onClick={togglePlay}>
        <video ref={videoRef} src={videoUrl} style={{ width: '100%', maxHeight: 420, display: 'block' }} playsInline />
        {/* Detection overlay */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {currentAnns.map((a, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${(a.x || 50) - (a.w || 20) / 2}%`,
              top: `${(a.y || 50) - (a.h || 20) / 2}%`,
              width: `${a.w || 20}%`,
              height: `${a.h || 20}%`,
              border: `2px solid ${a.color || TYPE_COLORS[a.fixture_type] || '#10B981'}`,
              borderRadius: 3,
            }}>
              <span style={{
                position: 'absolute', top: -16, left: 0,
                background: a.color || TYPE_COLORS[a.fixture_type] || '#10B981',
                color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>{a.fixture_type}</span>
            </div>
          ))}
        </div>
        {!playing && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.5)"/><path d="M24 18l18 12-18 12V18z" fill="white"/></svg>
          </div>
        )}
      </div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
        <button className="btn btn-sm" onClick={togglePlay} style={{ padding: '2px 8px' }}>{playing ? '⏸' : '▶'}</button>
        <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 3, cursor: 'pointer' }} onClick={seek}>
          <div style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%', height: '100%', background: 'var(--app-primary)', borderRadius: 3 }} />
        </div>
        <span style={{ fontSize: 12, color: '#6B7280' }}>{fmtTime(currentTime)} / {fmtTime(duration)}</span>
        <span style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '2px 6px', borderRadius: 4 }}>{currentAnns.length} det.</span>
      </div>
    </div>
  );
}

export default Processing;
