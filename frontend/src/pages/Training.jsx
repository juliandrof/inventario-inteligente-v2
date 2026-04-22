import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchTrainingGroups, fetchGroupFrames, autoAnnotateGroup, autoAnnotateGroupStatus, fetchGroupAnnotations,
  fetchTrainingImages, uploadTrainingImage, deleteTrainingImage,
  fetchImageAnnotations, saveAnnotations, autoAnnotate,
  startTrainingJob, fetchTrainingJobs, fetchJobDetail, pollJobStatus, publishJobModel,
  fetchTrainedModels, activateModel, deleteModel,
  fetchDetectionMode, setDetectionMode, fetchTrainingStats,
  fetchConfigFixtureTypes,
  fetchContexts, fetchContextObjectTypes,
} from '../api';
import { TYPE_COLORS, updateTypeColors } from './Dashboard';
import AnnotationEditor from './AnnotationEditor';

const TABS = [
  { key: 'dataset', label: 'Dataset' },
  { key: 'training', label: 'Treinamentos' },
  { key: 'models', label: 'Modelos' },
];

const MODEL_SIZES = [
  { value: 'n', label: 'YOLOv8n', desc: 'Nano - Rapido', detail: 'Menor modelo, inferencia mais rapida. Ideal para dispositivos com recursos limitados.' },
  { value: 's', label: 'YOLOv8s', desc: 'Small - Equilibrado', detail: 'Bom equilibrio entre velocidade e precisao. Recomendado para a maioria dos casos.' },
  { value: 'm', label: 'YOLOv8m', desc: 'Medium - Preciso', detail: 'Maior precisao, requer mais recursos. Ideal quando a acuracia e prioridade.' },
];

const JOB_STATUS_COLORS = {
  PENDING: '#6B7280',
  RUNNING: '#F59E0B',
  COMPLETED: '#10B981',
  FAILED: '#EF4444',
  CANCELLED: '#9CA3AF',
};

const JOB_STATUS_LABELS = {
  PENDING: 'Pendente',
  RUNNING: 'Em execucao',
  COMPLETED: 'Concluido',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelado',
};

function Training() {
  const [tab, setTab] = useState('dataset');
  const [fixtureTypes, setFixtureTypes] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [selectedContext, setSelectedContext] = useState('');

  useEffect(() => {
    fetchConfigFixtureTypes().then(types => {
      setFixtureTypes(types);
      updateTypeColors(types);
    }).catch(() => {});
    fetchContexts().then(ctxs => setContexts(Array.isArray(ctxs) ? ctxs : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedContext) {
      fetchContextObjectTypes(selectedContext).then(types => {
        setFixtureTypes(Array.isArray(types) ? types : []);
        updateTypeColors(Array.isArray(types) ? types : []);
      }).catch(() => {});
    } else {
      fetchConfigFixtureTypes().then(types => {
        setFixtureTypes(types);
        updateTypeColors(types);
      }).catch(() => {});
    }
  }, [selectedContext]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Treinamento YOLO</h1>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dataset' && <DatasetTab fixtureTypes={fixtureTypes} contexts={contexts} selectedContext={selectedContext} setSelectedContext={setSelectedContext} />}
      {tab === 'training' && <TrainingTab />}
      {tab === 'models' && <ModelsTab />}
    </div>
  );
}

/* ========== DATASET TAB ========== */
function DatasetTab({ fixtureTypes, contexts, selectedContext, setSelectedContext }) {
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [uploadMessage, setUploadMessage] = useState(null);
  const fileInputRef = useRef(null);

  // Frame browser state
  const [openGroup, setOpenGroup] = useState(null);
  const [frames, setFrames] = useState([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [autoAnnotatingGroup, setAutoAnnotatingGroup] = useState(null);
  const [selectedFrames, setSelectedFrames] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [playingGroup, setPlayingGroup] = useState(null); // source_name of video being played

  // Annotation editor state
  const [annotatingImage, setAnnotatingImage] = useState(null);
  const [annotatingData, setAnnotatingData] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTrainingGroups()
      .then(grps => setGroups(Array.isArray(grps) ? grps : []))
      .catch(err => { console.error('groups error:', err); setError(err.message); })
      .finally(() => setLoading(false));
    fetchTrainingStats()
      .then(st => setStats(st))
      .catch(err => console.error('stats error:', err));
  }, []);

  useEffect(() => { load(); }, [load]);

  const [uploadProgress, setUploadProgress] = useState('');

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      const messages = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Processando ${file.name} (${i + 1}/${files.length})...`);
        const result = await uploadTrainingImage(file, selectedContext);
        if (result && result.frames_extracted) {
          messages.push(`${result.frames_extracted} frames de "${file.name}"`);
        } else {
          messages.push(`"${file.name}" adicionado`);
        }
      }
      setUploadMessage(messages.join('. '));
      setTimeout(() => setUploadMessage(null), 8000);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const handleOpenGroup = async (sourceName) => {
    if (openGroup === sourceName) { setOpenGroup(null); setFrames([]); return; }
    setOpenGroup(sourceName);
    setLoadingFrames(true);
    try {
      const f = await fetchGroupFrames(sourceName);
      setFrames(Array.isArray(f) ? f : []);
    } catch (err) { setError(err.message); }
    setLoadingFrames(false);
  };

  const [annotateProgress, setAnnotateProgress] = useState(null); // {done, total, status}

  const handleAutoAnnotateGroup = async (sourceName) => {
    setAutoAnnotatingGroup(sourceName);
    setAnnotateProgress(null);
    try {
      await autoAnnotateGroup(sourceName);
      // Poll for progress
      const poll = setInterval(async () => {
        try {
          const status = await autoAnnotateGroupStatus(sourceName);
          setAnnotateProgress(status);
          if (status.status === 'COMPLETED') {
            clearInterval(poll);
            setAutoAnnotatingGroup(null);
            setAnnotateProgress(null);
            setUploadMessage(`Auto-anotacao concluida: ${status.done - status.errors}/${status.total} frames anotados`);
            setTimeout(() => setUploadMessage(null), 6000);
            load();
            if (openGroup === sourceName) handleOpenGroup(sourceName);
          }
        } catch (e) { /* keep polling */ }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setAutoAnnotatingGroup(null);
    }
  };

  const toggleFrame = (id) => {
    setSelectedFrames(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedFrames.size === frames.length) {
      setSelectedFrames(new Set());
    } else {
      setSelectedFrames(new Set(frames.map(f => f.image_id)));
    }
  };

  const deleteSelected = async () => {
    if (selectedFrames.size === 0) return;
    if (!window.confirm(`Excluir ${selectedFrames.size} frame(s) selecionado(s)?`)) return;
    try {
      for (const id of selectedFrames) {
        await deleteTrainingImage(id);
      }
      setSelectedFrames(new Set());
      setSelectMode(false);
      fetchTrainingGroups().then(grps => setGroups(Array.isArray(grps) ? grps : [])).catch(() => {});
      fetchTrainingStats().then(st => setStats(st)).catch(() => {});
      if (openGroup) {
        const f = await fetchGroupFrames(openGroup);
        setFrames(Array.isArray(f) ? f : []);
      }
    } catch (err) { setError(err.message); }
  };

  const handleAnnotate = async (image) => {
    try {
      const anns = await fetchImageAnnotations(image.image_id);
      setAnnotatingData(Array.isArray(anns) ? anns : anns.annotations || []);
      setAnnotatingImage(image);
    } catch (err) { setError(err.message); }
  };

  const handleSaveAnnotations = async (annotations) => {
    try {
      await saveAnnotations(annotatingImage.image_id, annotations);
      // Close editor first, then refresh in background without re-rendering editor
      setAnnotatingImage(null);
      setAnnotatingData(null);
      // Lightweight refresh: just reload groups stats, not full re-render
      fetchTrainingGroups().then(grps => setGroups(Array.isArray(grps) ? grps : [])).catch(() => {});
      fetchTrainingStats().then(st => setStats(st)).catch(() => {});
      if (openGroup) {
        fetchGroupFrames(openGroup).then(f => setFrames(Array.isArray(f) ? f : [])).catch(() => {});
      }
    } catch (err) { setError(err.message); }
  };

  const handleAutoAnnotateFrame = async (image) => {
    try {
      await autoAnnotate(image.image_id);
      // Only refresh the frames list, not the whole page
      if (openGroup) {
        fetchGroupFrames(openGroup).then(f => setFrames(Array.isArray(f) ? f : [])).catch(() => {});
      }
      fetchTrainingGroups().then(grps => setGroups(Array.isArray(grps) ? grps : [])).catch(() => {});
    } catch (err) { setError(err.message); }
  };

  const ftArray = fixtureTypes.map(ft => ({
    name: ft.name,
    display_name: ft.display_name || ft.name,
    color: ft.color || TYPE_COLORS[ft.name] || '#888',
  }));

  return (
    <>
      {/* Stats bar */}
      {stats && (
        <div className="training-stats-bar">
          <div className="training-stat">
            <span className="training-stat-value">{stats.total_images || 0}</span>
            <span className="training-stat-label">Frames</span>
          </div>
          <div className="training-stat">
            <span className="training-stat-value">{stats.total_annotations || 0}</span>
            <span className="training-stat-label">Anotacoes</span>
          </div>
          {Object.entries(stats.annotations_by_type || stats.annotations_per_type || {}).map(([type, count]) => (
            <span key={type} className="fixture-type-badge" style={{ background: TYPE_COLORS[type] || '#888' }}>
              {type}: {count}
            </span>
          ))}
        </div>
      )}

      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}
      {uploadMessage && (
        <div className="card" style={{ background: '#F0FDF4', borderLeft: '4px solid #10B981', padding: '12px 16px' }}>
          <span style={{ color: '#166534' }}>{uploadMessage}</span>
        </div>
      )}

      {/* Context selector - card grid matching Upload page */}
      <div className="card">
        <h3>Selecione o contexto de treinamento</h3>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>
          O contexto define quais tipos de objeto serao usados nas anotacoes e no treinamento.
        </p>
        {contexts.length === 0 ? (
          <div className="empty-state">Nenhum contexto encontrado. Crie um em Configuracoes.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {contexts.map(ctx => {
              const ctxId = ctx.context_id || ctx.id;
              const isSelected = String(selectedContext) === String(ctxId);
              return (
                <div
                  key={ctxId}
                  onClick={() => setSelectedContext(isSelected ? '' : ctxId)}
                  style={{
                    padding: '20px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                    border: isSelected ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                    background: isSelected ? '#FFF1F2' : '#fff',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{ctx.icon || '🎯'}</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{ctx.display_name || ctx.name}</div>
                  {ctx.description && <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>{ctx.description}</div>}
                  {isSelected && (
                    <span className="status-badge" style={{ background: 'var(--app-primary)', marginTop: 8, display: 'inline-block' }}>SELECIONADO</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload zone */}
      <div className="card">
        <div className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}>
          <div className="upload-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M24 8v24M24 8l-8 8M24 8l8 8M8 34v4a2 2 0 002 2h28a2 2 0 002-2v-4" stroke="var(--app-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p>{uploading ? (uploadProgress || 'Extraindo frames...') : 'Arraste arquivos aqui ou clique para selecionar'}</p>
          <p className="upload-hint">Videos: frames extraidos a 1/segundo | Imagens: adicionadas diretamente</p>
          <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
            onChange={e => handleUpload(e.target.files)} />
        </div>
      </div>

      {/* Source groups */}
      {loading ? (
        <div className="empty-state">Carregando...</div>
      ) : groups.length === 0 ? (
        <div className="empty-state">Nenhum dado de treinamento. Faca upload para comecar.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(g => (
            <div key={g.source_name} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Group header */}
              <div className="training-group-header" onClick={() => handleOpenGroup(g.source_name)}>
                <img src={g.thumbnail_url} alt="" className="training-group-thumb" />
                <div className="training-group-info">
                  <div className="training-group-name">{g.source_name}</div>
                  <div className="training-group-meta">
                    {g.frame_count} frame{g.frame_count !== 1 ? 's' : ''} | {g.total_annotations || 0} anotacoes
                  </div>
                </div>
                <div className="training-group-actions" onClick={e => e.stopPropagation()}>
                  {g.has_video && (
                    <button className="btn btn-sm" onClick={() => setPlayingGroup(playingGroup === g.source_name ? null : g.source_name)}>
                      {playingGroup === g.source_name ? 'Parar' : 'Play'}
                    </button>
                  )}
                  <button className="btn btn-sm btn-primary" onClick={() => handleOpenGroup(g.source_name)}>
                    {openGroup === g.source_name ? 'Fechar' : 'Anotar'}
                  </button>
                  <button className="btn btn-sm" disabled={autoAnnotatingGroup === g.source_name}
                    onClick={() => handleAutoAnnotateGroup(g.source_name)}>
                    {autoAnnotatingGroup === g.source_name
                      ? (annotateProgress ? `Anotando ${annotateProgress.done}/${annotateProgress.total}...` : 'Iniciando...')
                      : 'Auto-anotar com IA'}
                  </button>
                </div>
              </div>

              {/* Video player with annotation overlay */}
              {playingGroup === g.source_name && g.video_url && (
                <VideoAnnotationPlayer
                  videoUrl={g.video_url}
                  sourceName={g.source_name}
                  fixtureTypes={ftArray}
                />
              )}

              {/* Frame browser (expanded) */}
              {openGroup === g.source_name && (
                <div className="training-frames-panel">
                  {loadingFrames ? (
                    <div className="empty-state">Carregando frames...</div>
                  ) : (
                    <>
                      <div className="training-frames-toolbar">
                        <button className={`btn btn-sm ${selectMode ? 'btn-primary' : ''}`}
                          onClick={() => { setSelectMode(!selectMode); setSelectedFrames(new Set()); }}>
                          {selectMode ? 'Cancelar selecao' : 'Selecionar frames'}
                        </button>
                        {selectMode && (
                          <>
                            <button className="btn btn-sm" onClick={selectAll}>
                              {selectedFrames.size === frames.length ? 'Desmarcar todos' : 'Selecionar todos'}
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={selectedFrames.size === 0}
                              onClick={deleteSelected}>
                              Excluir {selectedFrames.size} selecionado(s)
                            </button>
                            <span style={{ fontSize: 12, color: '#888' }}>{selectedFrames.size} de {frames.length}</span>
                          </>
                        )}
                      </div>
                      <div className="training-frame-grid">
                        {frames.map(fr => (
                          <div key={fr.image_id}
                            className={`training-frame-card ${selectMode && selectedFrames.has(fr.image_id) ? 'selected' : ''}`}
                            onClick={selectMode ? () => toggleFrame(fr.image_id) : undefined}>
                            <div style={{ position: 'relative' }}>
                              <img src={fr.thumbnail_url} alt={fr.filename} className="training-frame-thumb" loading="lazy" />
                              {selectMode && (
                                <div className="training-frame-checkbox">
                                  <input type="checkbox" checked={selectedFrames.has(fr.image_id)} readOnly />
                                </div>
                              )}
                            </div>
                            <div className="training-frame-info">
                              <span className="training-frame-name">{fr.filename.replace(/.*_frame_/, '').replace('.jpg', '')}</span>
                              {(fr.actual_annotation_count || fr.annotation_count || 0) > 0 && (
                                <span className="training-frame-ann-badge">{fr.actual_annotation_count || fr.annotation_count} ann.</span>
                              )}
                            </div>
                            {!selectMode && (
                              <div className="training-frame-actions">
                                <button className="btn btn-sm btn-primary" onClick={() => handleAnnotate(fr)}>Anotar</button>
                                <button className="btn btn-sm" onClick={() => handleAutoAnnotateFrame(fr)}>IA</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Annotation Editor modal */}
      {annotatingImage && annotatingData !== null && (
        <AnnotationEditor
          imageId={annotatingImage.image_id}
          imageSrc={annotatingImage.image_url}
          initialAnnotations={annotatingData}
          fixtureTypes={ftArray}
          onSave={handleSaveAnnotations}
          onClose={() => { setAnnotatingImage(null); setAnnotatingData(null); }}
        />
      )}
    </>
  );
}

/* ========== VIDEO ANNOTATION PLAYER ========== */
function VideoAnnotationPlayer({ videoUrl, sourceName, fixtureTypes }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [annotations, setAnnotations] = useState({});
  const [currentAnns, setCurrentAnns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    fetchGroupAnnotations(sourceName).then(data => {
      setAnnotations(data || {});
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [sourceName]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const sec = Math.floor(video.currentTime);
      setCurrentAnns(annotations[sec] || []);
      setCurrentTime(video.currentTime);
    };
    const onMeta = () => setDuration(video.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [annotations]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const seek = (e) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * duration;
  };

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const typeColorMap = {};
  (fixtureTypes || []).forEach(ft => { typeColorMap[ft.name] = ft.color || '#E11D48'; });

  return (
    <div className="video-annotation-player">
      <div className={`video-ann-container ${isFullscreen ? 'fullscreen' : ''}`} ref={containerRef}>
        {/* Video + overlay wrapper: overlay is sized by the video element */}
        <div className="video-ann-viewport" onClick={togglePlay}>
          <div className="video-ann-video-wrap">
            <video ref={videoRef} src={videoUrl} className="video-ann-video" playsInline />
            <div className="video-ann-overlay">
              {currentAnns.map((ann, i) => (
                <div key={i} className="video-ann-box" style={{
                  left: `${ann.x - ann.w / 2}%`, top: `${ann.y - ann.h / 2}%`,
                  width: `${ann.w}%`, height: `${ann.h}%`,
                  borderColor: typeColorMap[ann.fixture_type] || '#10B981',
                }}>
                  <span className="video-ann-label" style={{ background: typeColorMap[ann.fixture_type] || '#10B981' }}>
                    {ann.fixture_type}
                  </span>
                </div>
              ))}
            </div>
            {!playing && <div className="video-ann-play-overlay">
              <svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.5)"/><path d="M24 18l18 12-18 12V18z" fill="white"/></svg>
            </div>}
          </div>
        </div>
        {/* Custom controls bar */}
        <div className="video-ann-controls">
          <button className="video-ann-ctrl-btn" onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
          <div className="video-ann-seekbar" onClick={seek}>
            <div className="video-ann-seekbar-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
          </div>
          <span className="video-ann-time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
          <span className="video-ann-det-count">{currentAnns.length} det.</span>
          <button className="video-ann-ctrl-btn" onClick={toggleFullscreen}>{isFullscreen ? '✕' : '⛶'}</button>
        </div>
      </div>
      {!loaded && <div className="empty-state">Carregando anotacoes...</div>}
    </div>
  );
}


/* ========== TRAINING TAB ========== */
function TrainingTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [modelSize, setModelSize] = useState('s');
  const [epochs, setEpochs] = useState(100);
  const [batchSize, setBatchSize] = useState(16);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobDetails, setJobDetails] = useState({});
  const [tooltipKey, setTooltipKey] = useState(null);

  const loadJobs = useCallback((showLoading) => {
    if (showLoading) setLoading(true);
    fetchTrainingJobs()
      .then(resp => setJobs(resp.jobs || resp || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadJobs(true); // show spinner on first load only
  }, [loadJobs]);

  // Silent poll for active jobs
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'RUNNING' || j.status === 'PENDING');
    if (!hasActive) return;
    const interval = setInterval(() => loadJobs(false), 15000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await startTrainingJob({ model_size: modelSize, epochs, batch_size: batchSize });
      setShowConfig(false);
      loadJobs(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleExpandJob = async (jobId) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(jobId);
    if (!jobDetails[jobId]) {
      try {
        const detail = await fetchJobDetail(jobId);
        setJobDetails(prev => ({ ...prev, [jobId]: detail }));
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const handlePublish = async (jobId) => {
    try {
      await publishJobModel(jobId);
      loadJobs(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <>
      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShowConfig(!showConfig)}>
          {showConfig ? 'Cancelar' : 'Iniciar Treinamento'}
        </button>
      </div>

      {/* Training config panel */}
      {showConfig && (
        <div className="card training-config-panel">
          <h3>Configuracao do Treinamento</h3>

          {/* Model size */}
          <div className="training-config-field">
            <div className="training-config-label">
              <span>Tamanho do Modelo</span>
              <InfoTooltip
                id="model-size"
                text="Modelos maiores sao mais precisos mas demoram mais para treinar e para inferencia."
                active={tooltipKey}
                onToggle={setTooltipKey}
              />
            </div>
            <div className="training-model-size-grid">
              {MODEL_SIZES.map(ms => (
                <div
                  key={ms.value}
                  className={`training-model-size-card ${modelSize === ms.value ? 'training-model-size-card-active' : ''}`}
                  onClick={() => setModelSize(ms.value)}
                >
                  <div className="training-model-size-name">{ms.label}</div>
                  <div className="training-model-size-desc">{ms.desc}</div>
                  <div className="training-model-size-detail">{ms.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Epochs */}
          <div className="training-config-field">
            <div className="training-config-label">
              <span>Epochs: {epochs}</span>
              <InfoTooltip
                id="epochs"
                text="Numero de vezes que o modelo vera todo o dataset durante o treinamento. Mais epochs = melhor ajuste, mas pode causar overfitting."
                active={tooltipKey}
                onToggle={setTooltipKey}
              />
            </div>
            <input
              type="range"
              min="30"
              max="300"
              step="10"
              value={epochs}
              onChange={e => setEpochs(Number(e.target.value))}
              className="training-slider"
            />
            <div className="training-slider-labels">
              <span>30</span>
              <span>100</span>
              <span>200</span>
              <span>300</span>
            </div>
          </div>

          {/* Batch size */}
          <div className="training-config-field">
            <div className="training-config-label">
              <span>Batch Size: {batchSize}</span>
              <InfoTooltip
                id="batch-size"
                text="Numero de imagens processadas por vez. Batch maior = treino mais rapido mas exige mais memoria GPU."
                active={tooltipKey}
                onToggle={setTooltipKey}
              />
            </div>
            <div className="training-batch-buttons">
              {[8, 16, 32].map(bs => (
                <button
                  key={bs}
                  className={`btn ${batchSize === bs ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setBatchSize(bs)}
                >
                  {bs}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleStart} disabled={starting}>
              {starting ? 'Iniciando...' : 'Iniciar'}
            </button>
          </div>
        </div>
      )}

      {/* Training jobs list */}
      {loading ? (
        <div className="empty-state">Carregando treinamentos...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">Nenhum treinamento realizado. Clique em "Iniciar Treinamento" para comecar.</div>
      ) : (
        <div className="training-jobs-list">
          {jobs.map(job => {
            const detail = jobDetails[job.job_id];
            const isExpanded = expandedJobId === job.job_id;
            return (
              <div key={job.job_id} className="card training-job-card">
                <div className="training-job-header" onClick={() => handleExpandJob(job.job_id)}>
                  <div className="training-job-header-left">
                    <span className="status-badge" style={{ background: JOB_STATUS_COLORS[job.status] || '#666' }}>
                      {JOB_STATUS_LABELS[job.status] || job.status}
                    </span>
                    <span className="training-job-model">{job.model_size || '-'}</span>
                    <span className="training-job-params">
                      {job.epochs} epochs / batch {job.batch_size}
                    </span>
                  </div>
                  <div className="training-job-header-right">
                    <span className="training-job-duration">{formatDuration(job.duration_seconds)}</span>
                    <span className="training-job-expand">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="training-job-details">
                    {/* Timestamps */}
                    <div style={{ padding: '8px 12px', fontSize: 13, color: '#6B7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {job.started_at && <span>Inicio: {new Date(job.started_at).toLocaleString('pt-BR')}</span>}
                      {job.completed_at && <span>Fim: {new Date(job.completed_at).toLocaleString('pt-BR')}</span>}
                      {job.databricks_run_id && <span>Run ID: {job.databricks_run_id}</span>}
                    </div>

                    {job.status === 'COMPLETED' && (() => {
                      const parsedMetrics = (() => {
                        try {
                          if (job.metrics_json) return JSON.parse(job.metrics_json);
                        } catch (_) {}
                        try {
                          if (detail?.metrics_json) return JSON.parse(detail.metrics_json);
                        } catch (_) {}
                        return detail || {};
                      })();
                      return (
                      <>
                        {/* Metrics */}
                        <div className="training-metrics-grid">
                          <MetricCard label="mAP@50" value={parsedMetrics.map50} />
                          <MetricCard label="mAP@50-95" value={parsedMetrics.map50_95} />
                          <MetricCard label="Precision" value={parsedMetrics.precision} />
                          <MetricCard label="Recall" value={parsedMetrics.recall} />
                        </div>

                        {/* Confusion matrix */}
                        {(detail?.confusion_matrix || job.confusion_matrix) && (
                          <div className="training-confusion-section">
                            <h4>Matriz de Confusao</h4>
                            <ConfusionMatrix data={detail?.confusion_matrix || job.confusion_matrix} />
                          </div>
                        )}

                        <div style={{ marginTop: 16 }}>
                          <button className="btn btn-primary" onClick={() => handlePublish(job.job_id)}>
                            Publicar Modelo
                          </button>
                        </div>
                      </>
                      );
                    })()}

                    {job.status === 'PENDING' && (
                      <div style={{ padding: 12, color: '#6B7280' }}>
                        Aguardando inicio do cluster Databricks...
                      </div>
                    )}

                    {job.status === 'RUNNING' && (
                      <div className="training-job-progress" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
                        <div className="training-progress-bar-track">
                          <div
                            className="training-progress-bar-fill training-progress-bar-indeterminate"
                            style={{ width: '30%', animation: 'training-progress-slide 1.5s ease-in-out infinite' }}
                          />
                        </div>
                        <span className="training-progress-label">Treinando...</span>
                        <style>{`
                          @keyframes training-progress-slide {
                            0% { margin-left: 0%; }
                            50% { margin-left: 70%; }
                            100% { margin-left: 0%; }
                          }
                        `}</style>
                      </div>
                    )}

                    {job.status === 'FAILED' && (
                      <div style={{ padding: 12, background: '#FEF2F2', borderRadius: 8, margin: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>Falha no treinamento</div>
                        <div className="error-text" style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {job.error_message || 'Erro desconhecido. Verifique os logs do Databricks.'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MetricCard({ label, value }) {
  const formatted = value != null ? (typeof value === 'number' ? (value * 100).toFixed(1) + '%' : value) : '-';
  const numericVal = typeof value === 'number' ? value : null;
  let color = '#666';
  if (numericVal !== null) {
    if (numericVal >= 0.8) color = '#10B981';
    else if (numericVal >= 0.5) color = '#F59E0B';
    else color = '#EF4444';
  }

  return (
    <div className="training-metric-card">
      <div className="training-metric-value" style={{ color }}>{formatted}</div>
      <div className="training-metric-label">{label}</div>
    </div>
  );
}

function ConfusionMatrix({ data }) {
  if (!data || !data.labels || !data.matrix) return null;
  const { labels, matrix } = data;
  const maxVal = Math.max(...matrix.flat(), 1);

  return (
    <div className="training-confusion-table-wrapper">
      <table className="training-confusion-table">
        <thead>
          <tr>
            <th></th>
            {labels.map(l => <th key={l}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, ri) => (
            <tr key={rowLabel}>
              <td className="training-confusion-row-label">{rowLabel}</td>
              {matrix[ri].map((val, ci) => {
                const intensity = val / maxVal;
                const isDiag = ri === ci;
                const bg = isDiag
                  ? `rgba(16, 185, 129, ${0.1 + intensity * 0.7})`
                  : val > 0
                    ? `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`
                    : '#f9fafb';
                return (
                  <td key={ci} className="training-confusion-cell" style={{ background: bg }}>
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfoTooltip({ id, text, active, onToggle }) {
  return (
    <span className="info-icon-wrapper">
      <span
        className="info-icon"
        onMouseEnter={() => onToggle(id)}
        onMouseLeave={() => onToggle(null)}
      >
        i
      </span>
      {active === id && <span className="info-tooltip">{text}</span>}
    </span>
  );
}

/* ========== MODELS TAB ========== */
function ModelsTab() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchTrainedModels()
      .then(mdls => { setModels(mdls.models || mdls || []); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}
      <div className="card">
        <h3>Modelos YOLO Treinados</h3>
        {loading ? (
          <div className="empty-state">Carregando modelos...</div>
        ) : models.length === 0 ? (
          <div className="empty-state">Nenhum modelo treinado. Treine um modelo na aba "Treinamentos".</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Nome</th><th>Criado em</th><th>mAP@50</th><th>Precision</th><th>Recall</th><th>Status</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              {models.map(model => (
                <tr key={model.model_id}>
                  <td className="filename">{model.model_name || '-'}</td>
                  <td>{model.created_at ? new Date(model.created_at).toLocaleDateString('pt-BR') : '-'}</td>
                  <td>{model.map50 != null ? (model.map50 * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{(model.precision_val ?? model.precision) != null ? ((model.precision_val ?? model.precision) * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{(model.recall_val ?? model.recall) != null ? ((model.recall_val ?? model.recall) * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{model.is_active ? <span className="status-badge" style={{ background: '#10B981' }}>ATIVO</span> : <span className="status-badge" style={{ background: '#6B7280' }}>Inativo</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!model.is_active && <button className="btn btn-sm btn-primary" onClick={async () => { await activateModel(model.model_id); load(); }}>Ativar</button>}
                      <button className="btn btn-sm btn-danger" onClick={async () => { if (window.confirm('Excluir?')) { await deleteModel(model.model_id); load(); } }}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default Training;
