import React, { useState, useEffect } from 'react';
import { fetchReviewVideos, fetchReviewFixtures, fetchFixtureFrames, fetchFilters } from '../api';
import { TYPE_COLORS, updateTypeColors } from './Dashboard';

function Review({ pageParams }) {
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState(pageParams?.uf || '');
  const [selStore, setSelStore] = useState(pageParams?.store_id || '');
  const [selDate, setSelDate] = useState('');
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [reviewData, setReviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [frameModal, setFrameModal] = useState(null); // { videoId, trackingId, fixture }
  const [frameData, setFrameData] = useState(null);
  const [loadingFrames, setLoadingFrames] = useState(false);

  useEffect(() => { fetchFilters().then(f => { setFilters(f); updateTypeColors(f.fixture_types); }).catch(() => {}); }, []);

  useEffect(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    if (selDate) f.video_date = selDate;
    fetchReviewVideos(f).then(setVideos).catch(() => {});
  }, [selUF, selStore, selDate]);

  async function loadReview(videoId) {
    setSelectedVideo(videoId);
    setLoading(true);
    try {
      const data = await fetchReviewFixtures(videoId);
      setReviewData(data);
    } catch (e) {
      setReviewData(null);
    }
    setLoading(false);
  }

  async function openFrames(videoId, trackingId, fixture) {
    setFrameModal({ videoId, trackingId, fixture });
    setLoadingFrames(true);
    try {
      const data = await fetchFixtureFrames(videoId, trackingId);
      setFrameData(data);
    } catch (e) {
      setFrameData(null);
    }
    setLoadingFrames(false);
  }

  const filteredFixtures = reviewData?.fixtures?.filter(f => {
    if (!filterType) return true;
    return f.fixture_type === filterType;
  }) || [];

  const typeCounts = reviewData?.type_counts || {};
  const allTypes = Object.keys(typeCounts);

  return (
    <div className="page">
      <div className="page-header"><h1>Revisao de Analise</h1></div>

      {/* Filters */}
      <div className="card">
        <div className="review-filters">
          <select className="filter-select" value={selUF} onChange={e => { setSelUF(e.target.value); setSelStore(''); }}>
            <option value="">Todas UFs</option>
            {filters.ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="filter-select" value={selStore} onChange={e => setSelStore(e.target.value)}>
            <option value="">Todas Lojas</option>
            {filters.stores.filter(s => !selUF || s.uf === selUF).map(s => (
              <option key={s.store_id} value={s.store_id}>{s.store_id}{s.name ? ` - ${s.name}` : ''}</option>
            ))}
          </select>
          <input type="date" className="filter-select" value={selDate} onChange={e => setSelDate(e.target.value)} />
        </div>
      </div>

      {/* Video Selection */}
      {!selectedVideo && (
        <div className="card">
          <h3>Selecione um video para revisar</h3>
          <table className="data-table">
            <thead>
              <tr><th>Arquivo</th><th>Loja</th><th>UF</th><th>Data</th><th>Frames</th><th>Deteccoes</th><th>Objetos</th><th></th></tr>
            </thead>
            <tbody>
              {videos.map(v => (
                <tr key={v.video_id} className="clickable" onClick={() => loadReview(v.video_id)}>
                  <td className="filename">{v.filename}</td>
                  <td>{v.store_id}{v.store_name ? ` - ${v.store_name}` : ''}</td>
                  <td><span className="uf-badge">{v.uf}</span></td>
                  <td>{v.video_date}</td>
                  <td>{v.frames_with_detections || 0}</td>
                  <td>{v.total_detections || 0}</td>
                  <td><strong>{v.fixture_count || 0}</strong></td>
                  <td><button className="btn btn-sm btn-primary">Revisar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {videos.length === 0 && <div className="empty-state">Nenhum video concluido encontrado</div>}
        </div>
      )}

      {loading && <div className="card"><div className="empty-state">Carregando...</div></div>}

      {/* Review Panel */}
      {selectedVideo && reviewData && !loading && (
        <>
          <div className="card review-header-card">
            <div className="review-header">
              <div>
                <h3>{reviewData.video.filename}</h3>
                <div className="review-meta">
                  <span className="uf-badge">{reviewData.video.uf}</span>
                  <span>Loja {reviewData.video.store_id}</span>
                  <span>{reviewData.video.video_date}</span>
                  <span><strong>{reviewData.total_fixtures}</strong> objetos unicos</span>
                </div>
              </div>
              <button className="btn btn-secondary" onClick={() => { setSelectedVideo(null); setReviewData(null); setFilterType(''); }}>
                Voltar
              </button>
            </div>

            {/* Type count tags */}
            <div className="review-summary">
              <h4>Contagem por Tipo (deduplicado)</h4>
              <div className="review-summary-chips">
                {allTypes.map(t => (
                  <div key={t} className="summary-chip" style={{ borderColor: TYPE_COLORS[t] || '#666' }}>
                    <span className="chip-dot" style={{ background: TYPE_COLORS[t] || '#666' }} />
                    <strong>{typeCounts[t]}x</strong> {t}
                  </div>
                ))}
              </div>
            </div>

            {allTypes.length > 0 && (
              <div className="review-type-filter">
                <span>Filtrar:</span>
                <button className={`filter-chip ${!filterType ? 'active' : ''}`} onClick={() => setFilterType('')}>
                  Todos ({reviewData.total_fixtures})
                </button>
                {allTypes.map(t => (
                  <button key={t} className={`filter-chip ${filterType === t ? 'active' : ''}`}
                    style={filterType === t ? { background: TYPE_COLORS[t] || '#666', color: 'white' } : {}}
                    onClick={() => setFilterType(filterType === t ? '' : t)}>
                    {t} ({typeCounts[t]})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fixture Grid - deduplicated */}
          <div className="review-frame-grid">
            {filteredFixtures.map(f => (
              <FixtureCard key={f.fixture_id} fixture={f} onViewFrames={() => openFrames(selectedVideo, f.tracking_id, f)} />
            ))}
          </div>

          {filteredFixtures.length === 0 && (
            <div className="card"><div className="empty-state">Nenhum objeto{filterType ? ` do tipo ${filterType}` : ''}</div></div>
          )}
        </>
      )}

      {/* Frame Modal */}
      {frameModal && (
        <div className="modal-overlay" onClick={() => { setFrameModal(null); setFrameData(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                Frames - {frameModal.fixture.display_name || frameModal.fixture.fixture_type}
                <span className="modal-subtitle"> (Track #{frameModal.trackingId})</span>
              </h3>
              <button className="btn btn-sm" onClick={() => { setFrameModal(null); setFrameData(null); }}>Fechar</button>
            </div>

            {loadingFrames && <div className="empty-state">Carregando frames...</div>}

            {frameData && (
              <>
                <p className="modal-info">Este objeto apareceu em <strong>{frameData.total}</strong> frame(s) analisados</p>
                <div className="modal-frame-grid">
                  {frameData.frames.map((fr, i) => (
                    <div key={i} className="modal-frame-card">
                      {fr.thumbnail_path ? (
                        <img src={`/api/thumbnails/${fr.thumbnail_path}`} alt={`Frame ${fr.frame_index}`} className="modal-frame-thumb" loading="lazy" />
                      ) : (
                        <div className="frame-thumb-placeholder">Frame {fr.frame_index}</div>
                      )}
                      <div className="modal-frame-info">
                        <div className="modal-frame-time">{formatTime(fr.timestamp_sec)}</div>
                        <div className="modal-frame-conf">Confianca: {Math.round(fr.confidence * 100)}%</div>
                        <OccBadge level={fr.occupancy_level} pct={fr.occupancy_pct} />
                        {fr.ai_description && <p className="modal-frame-desc">{fr.ai_description}</p>}
                        <div className="modal-frame-pos">Posicao: ({Math.round(fr.position.x)}%, {Math.round(fr.position.y)}%)</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function FixtureCard({ fixture, onViewFrames }) {
  const f = fixture;
  const color = TYPE_COLORS[f.fixture_type] || f.type_color || '#666';

  return (
    <div className="review-frame-card">
      <div className="frame-thumb-container">
        {f.best_thumbnail_path ? (
          <img src={`/api/thumbnails/${f.best_thumbnail_path}`} alt={f.fixture_type} className="frame-thumb" loading="lazy" />
        ) : (
          <div className="frame-thumb-placeholder">{f.fixture_type}</div>
        )}
        <div className="frame-overlay">
          <span className="frame-time">{formatTime(f.first_seen_sec)} - {formatTime(f.last_seen_sec)}</span>
          <span className="frame-count">Track #{f.tracking_id}</span>
        </div>
      </div>

      <div className="frame-tags">
        <span className="det-tag" style={{ background: color }}>{f.display_name || f.fixture_type}</span>
        <OccBadge level={f.occupancy_level} pct={f.occupancy_pct} />
      </div>

      <div className="fixture-card-body">
        <div className="fixture-card-stats">
          <span>Confianca: <strong>{Math.round((f.avg_confidence || 0) * 100)}%</strong></span>
          <span>Zona: <strong>{f.position_zone || '-'}</strong></span>
          <span>Visto em: <strong>{f.raw_frame_count || f.frame_count}</strong> frames</span>
        </div>
        {f.ai_description && <p className="det-description">{f.ai_description}</p>}
      </div>

      <button className="frame-expand-btn" onClick={onViewFrames}>
        Ver todos os frames ({f.raw_frame_count || f.frame_count})
      </button>
    </div>
  );
}


function OccBadge({ level, pct }) {
  const colors = { VAZIO: '#EF4444', PARCIAL: '#F59E0B', CHEIO: '#10B981' };
  return <span className="occ-badge" style={{ background: colors[level] || '#999' }}>{level} {Math.round(pct || 0)}%</span>;
}

function formatTime(sec) {
  if (sec == null) return '--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default Review;
