import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchTrainingImages, uploadTrainingImage, deleteTrainingImage,
  fetchImageAnnotations, saveAnnotations, autoAnnotate,
  startTrainingJob, fetchTrainingJobs, fetchJobDetail,
  fetchTrainedModels, activateModel, deleteModel,
  fetchDetectionMode, setDetectionMode, fetchTrainingStats,
  fetchConfigFixtureTypes,
} from '../api';
import { TYPE_COLORS, updateTypeColors } from './Dashboard';
import AnnotationEditor from './AnnotationEditor';

const TABS = [
  { key: 'dataset', label: 'Dataset' },
  { key: 'training', label: 'Treinamentos' },
  { key: 'models', label: 'Modelos' },
];

const MODEL_SIZES = [
  { value: 'yolov8n', label: 'YOLOv8n', desc: 'Nano - Rapido', detail: 'Menor modelo, inferencia mais rapida. Ideal para dispositivos com recursos limitados.' },
  { value: 'yolov8s', label: 'YOLOv8s', desc: 'Small - Equilibrado', detail: 'Bom equilibrio entre velocidade e precisao. Recomendado para a maioria dos casos.' },
  { value: 'yolov8m', label: 'YOLOv8m', desc: 'Medium - Preciso', detail: 'Maior precisao, requer mais recursos. Ideal quando a acuracia e prioridade.' },
];

const JOB_STATUS_COLORS = {
  PENDING: '#6B7280',
  RUNNING: '#F59E0B',
  COMPLETED: '#10B981',
  FAILED: '#EF4444',
};

const JOB_STATUS_LABELS = {
  PENDING: 'Pendente',
  RUNNING: 'Em execucao',
  COMPLETED: 'Concluido',
  FAILED: 'Falhou',
};

function Training() {
  const [tab, setTab] = useState('dataset');
  const [fixtureTypes, setFixtureTypes] = useState([]);

  useEffect(() => {
    fetchConfigFixtureTypes().then(types => {
      setFixtureTypes(types);
      updateTypeColors(types);
    }).catch(() => {});
  }, []);

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

      {tab === 'dataset' && <DatasetTab fixtureTypes={fixtureTypes} />}
      {tab === 'training' && <TrainingTab />}
      {tab === 'models' && <ModelsTab fixtureTypes={fixtureTypes} />}
    </div>
  );
}

/* ========== DATASET TAB ========== */
function DatasetTab({ fixtureTypes }) {
  const [images, setImages] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [annotatingImage, setAnnotatingImage] = useState(null);
  const [annotatingData, setAnnotatingData] = useState(null);
  const [autoAnnotatingIds, setAutoAnnotatingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchTrainingImages(),
      fetchTrainingStats(),
    ]).then(([imgsResp, st]) => {
      setImages(imgsResp.images || imgsResp || []);
      setStats(st);
      setError(null);
    }).catch(err => {
      setError(err.message);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await uploadTrainingImage(file);
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir esta imagem e suas anotacoes?')) return;
    try {
      await deleteTrainingImage(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAnnotate = async (image) => {
    try {
      const anns = await fetchImageAnnotations(image.image_id);
      setAnnotatingData(anns.annotations || []);
      setAnnotatingImage(image);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveAnnotations = async (annotations) => {
    try {
      await saveAnnotations(annotatingImage.image_id, annotations);
      setAnnotatingImage(null);
      setAnnotatingData(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAutoAnnotate = async (image) => {
    setAutoAnnotatingIds(prev => new Set([...prev, image.image_id]));
    try {
      await autoAnnotate(image.image_id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAutoAnnotatingIds(prev => {
        const next = new Set(prev);
        next.delete(image.image_id);
        return next;
      });
    }
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
            <span className="training-stat-label">Imagens</span>
          </div>
          <div className="training-stat">
            <span className="training-stat-value">{stats.total_annotations || 0}</span>
            <span className="training-stat-label">Anotacoes</span>
          </div>
          {stats.annotations_by_type && Object.entries(stats.annotations_by_type).map(([type, count]) => (
            <span
              key={type}
              className="fixture-type-badge"
              style={{ background: TYPE_COLORS[type] || '#888' }}
            >
              {type}: {count}
            </span>
          ))}
        </div>
      )}

      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}

      {/* Upload zone */}
      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="upload-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M24 8v24M24 8l-8 8M24 8l8 8M8 32v4a4 4 0 004 4h24a4 4 0 004-4v-4" stroke="#999" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p>{uploading ? 'Enviando...' : 'Arraste imagens aqui ou clique para selecionar'}</p>
        <p className="upload-hint">Formatos aceitos: JPG, PNG, WEBP</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleUpload(e.target.files)}
        />
      </div>

      {/* Image grid */}
      {loading ? (
        <div className="empty-state">Carregando imagens...</div>
      ) : images.length === 0 ? (
        <div className="empty-state">Nenhuma imagem de treinamento. Faca upload para comecar.</div>
      ) : (
        <div className="training-image-grid">
          {images.map(img => (
            <div key={img.image_id} className="training-image-card">
              <div className="training-image-thumb-area">
                <img
                  src={img.thumbnail_url || img.image_url}
                  alt={img.filename}
                  className="training-image-thumb"
                />
                {img.annotation_count > 0 && (
                  <span className="training-image-ann-count">
                    {img.annotation_count} anotacoes
                  </span>
                )}
              </div>
              <div className="training-image-card-body">
                <div className="training-image-filename">{img.filename}</div>
                <div className="training-image-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => handleAnnotate(img)}>
                    Anotar
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleAutoAnnotate(img)}
                    disabled={autoAnnotatingIds.has(img.image_id)}
                  >
                    {autoAnnotatingIds.has(img.image_id) ? 'Anotando...' : 'Auto-anotar com IA'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(img.image_id)}>
                    Excluir
                  </button>
                </div>
              </div>
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

/* ========== TRAINING TAB ========== */
function TrainingTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [modelSize, setModelSize] = useState('yolov8s');
  const [epochs, setEpochs] = useState(100);
  const [batchSize, setBatchSize] = useState(16);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobDetails, setJobDetails] = useState({});
  const [tooltipKey, setTooltipKey] = useState(null);

  const loadJobs = useCallback(() => {
    setLoading(true);
    fetchTrainingJobs()
      .then(resp => setJobs(resp.jobs || resp || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await startTrainingJob({ model_size: modelSize, epochs, batch_size: batchSize });
      setShowConfig(false);
      loadJobs();
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
      await activateModel(jobId);
      loadJobs();
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
              min="10"
              max="300"
              value={epochs}
              onChange={e => setEpochs(Number(e.target.value))}
              className="training-slider"
            />
            <div className="training-slider-labels">
              <span>10</span>
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
                    {job.status === 'COMPLETED' && (
                      <>
                        {/* Metrics */}
                        <div className="training-metrics-grid">
                          <MetricCard label="mAP@50" value={job.map50 ?? detail?.map50} />
                          <MetricCard label="mAP@50-95" value={job.map50_95 ?? detail?.map50_95} />
                          <MetricCard label="Precision" value={job.precision ?? detail?.precision} />
                          <MetricCard label="Recall" value={job.recall ?? detail?.recall} />
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
                    )}

                    {job.status === 'RUNNING' && (
                      <div className="training-job-progress">
                        <div className="training-progress-bar-track">
                          <div
                            className="training-progress-bar-fill"
                            style={{ width: `${job.progress_pct || 0}%` }}
                          />
                        </div>
                        <span className="training-progress-label">{Math.round(job.progress_pct || 0)}%</span>
                      </div>
                    )}

                    {job.status === 'FAILED' && job.error_message && (
                      <div className="error-text" style={{ padding: 12 }}>{job.error_message}</div>
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
  const [detectionMode, setDetectionModeState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchTrainedModels(),
      fetchDetectionMode(),
    ]).then(([mdls, dm]) => {
      setModels(mdls.models || mdls || []);
      setDetectionModeState(dm.mode || 'llm');
      setError(null);
    }).catch(err => {
      setError(err.message);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (modelId) => {
    try {
      await activateModel(modelId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (modelId) => {
    if (!window.confirm('Excluir este modelo?')) return;
    try {
      await deleteModel(modelId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleModeChange = async (mode) => {
    try {
      await setDetectionMode(mode);
      setDetectionModeState(mode);
    } catch (err) {
      setError(err.message);
    }
  };

  const DETECTION_MODES = [
    {
      key: 'llm',
      label: 'LLM',
      desc: 'Usa modelo de linguagem multimodal (ex: GPT-4V, Claude Vision) para detectar e classificar expositores via analise de frames de video.',
      icon: '🧠',
    },
    {
      key: 'yolo',
      label: 'YOLO',
      desc: 'Usa modelo YOLO treinado com seus dados customizados. Deteccao rapida e precisa em tempo real, otimizado para seu catalogo de expositores.',
      icon: '⚡',
    },
    {
      key: 'hybrid',
      label: 'Hibrido',
      desc: 'YOLO para deteccao rapida de bounding boxes + LLM para classificacao refinada e descricao de cada expositor detectado.',
      icon: '🔄',
    },
  ];

  return (
    <>
      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}

      {/* Detection mode selector */}
      <div className="card">
        <h3>Modo de Deteccao</h3>
        <div className="detection-mode-grid">
          {DETECTION_MODES.map(mode => (
            <div
              key={mode.key}
              className={`detection-mode-card ${detectionMode === mode.key ? 'detection-mode-card-active' : ''}`}
              onClick={() => handleModeChange(mode.key)}
            >
              <div className="detection-mode-icon">{mode.icon}</div>
              <div className="detection-mode-label">{mode.label}</div>
              <div className="detection-mode-desc">{mode.desc}</div>
              {detectionMode === mode.key && (
                <span className="status-badge" style={{ background: '#10B981', marginTop: 8 }}>ATIVO</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Models list */}
      <div className="card">
        <h3>Modelos Treinados</h3>
        {loading ? (
          <div className="empty-state">Carregando modelos...</div>
        ) : models.length === 0 ? (
          <div className="empty-state">Nenhum modelo treinado. Treine um modelo na aba "Treinamentos".</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Versao</th>
                <th>Criado em</th>
                <th>mAP@50</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {models.map(model => (
                <tr key={model.model_id}>
                  <td className="filename">{model.name}</td>
                  <td>{model.version || '-'}</td>
                  <td>{model.created_at ? new Date(model.created_at).toLocaleDateString('pt-BR') : '-'}</td>
                  <td>{model.map50 != null ? (model.map50 * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{model.precision != null ? (model.precision * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{model.recall != null ? (model.recall * 100).toFixed(1) + '%' : '-'}</td>
                  <td>
                    {model.is_active ? (
                      <span className="status-badge" style={{ background: '#10B981' }}>ACTIVE</span>
                    ) : (
                      <span className="status-badge" style={{ background: '#6B7280' }}>Inativo</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!model.is_active && (
                        <button className="btn btn-sm btn-primary" onClick={() => handleActivate(model.model_id)}>
                          Ativar
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(model.model_id)}>
                        Excluir
                      </button>
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
