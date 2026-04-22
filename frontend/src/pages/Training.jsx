import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchTrainingGroups, fetchGroupFrames, deleteTrainingGroup,
  autoAnnotateGroup, autoAnnotateGroupStatus, fetchActiveAutoAnnotations, fetchGroupAnnotations,
  uploadTrainingImage, deleteTrainingImage,
  fetchImageAnnotations, saveAnnotations, autoAnnotate,
  startTrainingJob, fetchTrainingJobs, fetchJobDetail, publishJobModel,
  fetchUCModels, activateUCModel, deleteUCModel,
  fetchConfigFixtureTypes,
  fetchContexts, fetchContextObjectTypes,
  fetchServingEndpoints, updateConfig,
} from '../api';
import { TYPE_COLORS, updateTypeColors } from './Dashboard';
import AnnotationEditor from './AnnotationEditor';

const TABS = [
  { key: 'datasets', label: 'Datasets' },
  { key: 'models', label: 'Modelos' },
];

const MODEL_SIZES = [
  { value: 'n', label: 'YOLOv8n', desc: 'Nano - Rapido', detail: 'Menor modelo, inferencia mais rapida.' },
  { value: 's', label: 'YOLOv8s', desc: 'Small - Equilibrado', detail: 'Bom equilibrio entre velocidade e precisao.' },
  { value: 'm', label: 'YOLOv8m', desc: 'Medium - Preciso', detail: 'Maior precisao, requer mais recursos.' },
];

const JOB_STATUS_COLORS = {
  PENDING: '#6B7280', RUNNING: '#F59E0B', COMPLETED: '#10B981', FAILED: '#EF4444', CANCELLED: '#9CA3AF',
};
const JOB_STATUS_LABELS = {
  PENDING: 'Pendente', RUNNING: 'Em execucao', COMPLETED: 'Concluido', FAILED: 'Falhou', CANCELLED: 'Cancelado',
};

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif'];
function isPhoto(name) { return IMAGE_EXTS.includes(name.split('.').pop()?.toLowerCase()); }

function Training() {
  const [tab, setTab] = useState('datasets');
  const [fixtureTypes, setFixtureTypes] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchConfigFixtureTypes().then(types => {
      setFixtureTypes(types);
      updateTypeColors(types);
    }).catch(() => {});
    fetchContexts().then(ctxs => setContexts(Array.isArray(ctxs) ? ctxs : [])).catch(() => {});
  }, []);

  const handleWizardClose = () => {
    setShowWizard(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Treinamento YOLO</h1>
        {tab === 'datasets' && (
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            Novo Treinamento
          </button>
        )}
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'datasets' && <DatasetsTab key={refreshKey} fixtureTypes={fixtureTypes} contexts={contexts} />}
      {tab === 'models' && <ModelsTab />}

      {showWizard && (
        <TrainingWizard
          contexts={contexts}
          fixtureTypes={fixtureTypes}
          setFixtureTypes={setFixtureTypes}
          onClose={handleWizardClose}
        />
      )}
    </div>
  );
}


/* ================================================================
   TRAINING WIZARD (3 steps: Context → Upload → Annotate)
   ================================================================ */
function TrainingWizard({ contexts, fixtureTypes, setFixtureTypes, onClose }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);

  // Step 1: Context
  const [selectedContext, setSelectedContext] = useState(null);

  // Step 2: Upload + frame interval
  const [files, setFiles] = useState([]);
  const [frameInterval, setFrameInterval] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadedGroups, setUploadedGroups] = useState([]);
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  // Step 3: AI Model selection
  const [endpoints, setEndpoints] = useState([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [selectedLLM, setSelectedLLM] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [customEndpoint, setCustomEndpoint] = useState('');

  // Step 4: Annotate (auto + review)
  const [frames, setFrames] = useState([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [annotatingImage, setAnnotatingImage] = useState(null);
  const [annotatingData, setAnnotatingData] = useState(null);
  const [selectedFrames, setSelectedFrames] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [autoAnnotatingGroup, setAutoAnnotatingGroup] = useState(null);
  const [annotateProgress, setAnnotateProgress] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Load context fixture types when context selected
  useEffect(() => {
    if (selectedContext) {
      fetchContextObjectTypes(selectedContext).then(types => {
        if (setFixtureTypes) {
          setFixtureTypes(Array.isArray(types) ? types : []);
          updateTypeColors(Array.isArray(types) ? types : []);
        }
      }).catch(() => {});
    }
  }, [selectedContext, setFixtureTypes]);

  // Load endpoints when entering step 3
  useEffect(() => {
    if (step !== 3) return;
    setLoadingEndpoints(true);
    fetchServingEndpoints()
      .then(eps => setEndpoints(eps || []))
      .catch(() => setEndpoints([]))
      .finally(() => setLoadingEndpoints(false));
  }, [step]);

  const goToStep2 = () => {
    if (!selectedContext) { setError('Selecione um contexto'); return; }
    setError(null);
    setStep(2);
  };

  const handleFiles = (fileList) => {
    const arr = Array.from(fileList).map(f => ({
      file: f, name: f.name, size: f.size,
      mediaType: isPhoto(f.name) ? 'Foto' : 'Video',
    }));
    setFiles(prev => [...prev, ...arr]);
  };

  const removeFile = (idx) => setFiles(f => f.filter((_, i) => i !== idx));

  const goToStep3 = () => {
    if (files.length === 0) { setError('Adicione pelo menos um arquivo'); return; }
    setError(null);
    setStep(3);
  };

  const effectiveLLM = useCustom ? customEndpoint : selectedLLM;

  const handleUploadAndAnnotate = async () => {
    if (!effectiveLLM) { setError('Selecione um modelo de IA'); return; }
    setUploading(true);
    setError(null);
    const groups = [];
    try {
      // Save LLM model config
      setUploadProgress('Configurando modelo de IA...');
      await updateConfig('fmapi_model', effectiveLLM, 'Serving endpoint do modelo de visao');

      // Upload files
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setUploadProgress(`Processando ${f.name} (${i + 1}/${files.length})...`);
        const result = await uploadTrainingImage(f.file, selectedContext, frameInterval);
        groups.push(f.name);
        if (result?.frames_extracted) {
          setUploadProgress(`${result.frames_extracted} frames extraidos de "${f.name}"`);
        }
      }
      setUploadedGroups(groups);
      setStep(4);

      // Auto-annotate immediately
      setUploadProgress('');
      loadAllFrames(groups);
      startAutoAnnotate(groups);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const loadAllFrames = async (groups) => {
    setLoadingFrames(true);
    try {
      let allFrames = [];
      for (const g of groups) {
        const f = await fetchGroupFrames(g);
        allFrames = allFrames.concat(Array.isArray(f) ? f : []);
      }
      setFrames(allFrames);
    } catch (err) { setError(err.message); }
    setLoadingFrames(false);
  };

  const startAutoAnnotate = async (groups) => {
    if (groups.length === 0) return;
    const sourceName = groups[0];
    setAutoAnnotatingGroup(sourceName);
    setAnnotateProgress(null);
    try {
      await autoAnnotateGroup(sourceName);
      const poll = setInterval(async () => {
        try {
          const status = await autoAnnotateGroupStatus(sourceName);
          setAnnotateProgress(status);
          if (status.status === 'COMPLETED') {
            clearInterval(poll);
            setAutoAnnotatingGroup(null);
            setAnnotateProgress(null);
            setSuccessMsg(`Auto-anotacao concluida: ${status.done - status.errors}/${status.total} frames anotados`);
            setTimeout(() => setSuccessMsg(null), 6000);
            loadAllFrames(groups);
          }
        } catch (_) { /* keep polling */ }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setAutoAnnotatingGroup(null);
    }
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
      setAnnotatingImage(null);
      setAnnotatingData(null);
      loadAllFrames(uploadedGroups);
    } catch (err) { setError(err.message); }
  };

  const handleAutoAnnotateFrame = async (image) => {
    try {
      await autoAnnotate(image.image_id);
      loadAllFrames(uploadedGroups);
    } catch (err) { setError(err.message); }
  };

  const toggleFrame = (id) => {
    setSelectedFrames(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selectedFrames.size === 0) return;
    if (!window.confirm(`Excluir ${selectedFrames.size} frame(s)?`)) return;
    try {
      for (const id of selectedFrames) await deleteTrainingImage(id);
      setSelectedFrames(new Set());
      setSelectMode(false);
      loadAllFrames(uploadedGroups);
    } catch (err) { setError(err.message); }
  };

  const ftArray = fixtureTypes.map(ft => ({
    name: ft.name,
    display_name: ft.display_name || ft.name,
    color: ft.color || TYPE_COLORS[ft.name] || '#888',
  }));

  const hasVideo = files.some(f => f.mediaType === 'Video');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, overflow: 'auto' }}>
      <div style={{ margin: '40px auto', maxWidth: 900, background: '#fff', borderRadius: 16, minHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Novo Treinamento</h2>
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              {[{ n: 1, l: 'Contexto' }, { n: 2, l: 'Upload' }, { n: 3, l: 'Modelo IA' }, { n: 4, l: 'Revisar' }].map(s => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: step >= s.n ? 1 : 0.4 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: step === s.n ? 'var(--app-primary)' : step > s.n ? '#10B981' : '#D1D5DB',
                    color: '#fff', fontSize: 13, fontWeight: 700,
                  }}>{step > s.n ? '✓' : s.n}</div>
                  <span style={{ fontSize: 13, fontWeight: step === s.n ? 600 : 400 }}>{s.l}</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1, overflow: 'auto' }}>
          {error && <div style={{ background: '#FEF2F2', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}><span className="error-text">{error}</span></div>}
          {successMsg && <div style={{ background: '#F0FDF4', borderLeft: '4px solid #10B981', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}><span style={{ color: '#166534' }}>{successMsg}</span></div>}

          {/* STEP 1: Context */}
          {step === 1 && (
            <>
              <h3 style={{ margin: '0 0 8px' }}>Selecione o contexto de treinamento</h3>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>O contexto define quais tipos de objeto serao usados nas anotacoes.</p>
              {contexts.length === 0 ? (
                <div className="empty-state">Nenhum contexto encontrado. Crie um em Configuracoes.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
                  {contexts.map(ctx => {
                    const ctxId = ctx.context_id || ctx.id;
                    const sel = String(selectedContext) === String(ctxId);
                    return (
                      <div key={ctxId} onClick={() => setSelectedContext(ctxId)} style={{
                        padding: '20px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                        border: sel ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                        background: sel ? '#FFF1F2' : '#fff', transition: 'all 0.15s',
                      }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>{ctx.icon || '🎯'}</div>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{ctx.display_name || ctx.name}</div>
                        {ctx.description && <div style={{ fontSize: 12, color: '#6B7280' }}>{ctx.description}</div>}
                        {sel && <span className="status-badge" style={{ background: 'var(--app-primary)', marginTop: 8, display: 'inline-block' }}>SELECIONADO</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* STEP 2: Upload */}
          {step === 2 && (
            <>
              <h3 style={{ margin: '0 0 8px' }}>Upload do Dataset</h3>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Adicione videos ou fotos. Um arquivo por vez ou varios de uma vez.</p>

              <div className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                style={{ marginBottom: 16 }}>
                <div className="upload-icon">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <path d="M24 8v24M24 8l-8 8M24 8l8 8M8 34v4a2 2 0 002 2h28a2 2 0 002-2v-4" stroke="var(--app-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p>{uploading ? uploadProgress : 'Arraste arquivos aqui ou clique para selecionar'}</p>
                <p className="upload-hint">Videos e imagens aceitos</p>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                  onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
              </div>

              {/* Frame interval selector for videos */}
              {(hasVideo || files.length === 0) && (
                <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                    Intervalo de frames (para videos): a cada {frameInterval} segundo{frameInterval > 1 ? 's' : ''}
                  </label>
                  <input type="range" min="1" max="10" step="1" value={frameInterval}
                    onChange={e => setFrameInterval(Number(e.target.value))}
                    style={{ width: '100%' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9CA3AF' }}>
                    <span>1s (mais frames)</span><span>5s</span><span>10s (menos frames)</span>
                  </div>
                </div>
              )}

              {/* File list */}
              {files.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#F9FAFB', borderRadius: 8 }}>
                      <span style={{ fontSize: 20 }}>{f.mediaType === 'Video' ? '🎬' : '🖼️'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{f.name}</div>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>{f.mediaType} | {(f.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => removeFile(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* STEP 3: AI Model selection */}
          {step === 3 && (
            <>
              <h3 style={{ margin: '0 0 8px' }}>Modelo de IA para auto-anotacao</h3>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Selecione o modelo LLM que ira anotar automaticamente os frames do dataset.</p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className={`tab ${!useCustom ? 'active' : ''}`} onClick={() => setUseCustom(false)} style={{ fontSize: 12, padding: '4px 12px' }}>
                    Endpoints Databricks
                  </button>
                  <button className={`tab ${useCustom ? 'active' : ''}`} onClick={() => setUseCustom(true)} style={{ fontSize: 12, padding: '4px 12px' }}>
                    Personalizado
                  </button>
                </div>
              </div>

              {!useCustom ? (
                <>
                  {loadingEndpoints ? (
                    <div className="empty-state">Carregando modelos do Databricks...</div>
                  ) : endpoints.length === 0 ? (
                    <div className="empty-state">Nenhum serving endpoint encontrado.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                      {endpoints.filter(ep => ep.state === 'READY' || ep.state === true).map(ep => (
                        <div key={ep.name} onClick={() => { setSelectedLLM(ep.name); setUseCustom(false); }}
                          style={{
                            padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                            border: selectedLLM === ep.name && !useCustom ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                            background: selectedLLM === ep.name && !useCustom ? '#FFF1F2' : '#fff',
                            transition: 'all 0.15s',
                          }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{ep.display_name || ep.name}</div>
                          <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>{ep.name}</div>
                          {ep.description && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6, lineHeight: 1.4 }}>{ep.description}</div>}
                          {selectedLLM === ep.name && !useCustom && (
                            <span className="status-badge" style={{ background: 'var(--app-primary)', marginTop: 8, display: 'inline-block' }}>SELECIONADO</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>Digite o nome do serving endpoint personalizado:</p>
                  <input className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
                    placeholder="ex: meu-modelo-visao-v2" value={customEndpoint}
                    onChange={e => setCustomEndpoint(e.target.value)} />
                </div>
              )}
            </>
          )}

          {/* STEP 4: Review annotations */}
          {step === 4 && (
            <>
              <h3 style={{ margin: '0 0 8px' }}>Revisar Anotacoes</h3>
              {autoAnnotatingGroup ? (
                <div style={{ background: '#FFF7ED', borderLeft: '4px solid #F59E0B', padding: '12px 16px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="training-progress-bar-track" style={{ flex: 1 }}>
                    <div className="training-progress-bar-fill" style={{ width: annotateProgress ? `${(annotateProgress.done / annotateProgress.total) * 100}%` : '10%', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 13, color: '#92400E', whiteSpace: 'nowrap' }}>
                    {annotateProgress ? `Anotando com IA: ${annotateProgress.done}/${annotateProgress.total}` : 'Iniciando auto-anotacao...'}
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>
                  Revise as anotacoes geradas pela IA. Corrija ou exclua frames desnecessarios.
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <button className={`btn ${selectMode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setSelectMode(!selectMode); setSelectedFrames(new Set()); }}>
                  {selectMode ? 'Cancelar selecao' : 'Selecionar frames'}
                </button>
                {selectMode && (
                  <>
                    <button className="btn btn-sm" onClick={() => {
                      setSelectedFrames(prev => prev.size === frames.length ? new Set() : new Set(frames.map(f => f.image_id)));
                    }}>
                      {selectedFrames.size === frames.length ? 'Desmarcar todos' : 'Selecionar todos'}
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={selectedFrames.size === 0} onClick={deleteSelected}>
                      Excluir {selectedFrames.size} selecionado(s)
                    </button>
                  </>
                )}
              </div>

              {loadingFrames ? (
                <div className="empty-state">Carregando frames...</div>
              ) : frames.length === 0 ? (
                <div className="empty-state">Nenhum frame encontrado.</div>
              ) : (
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
                          <button className="btn btn-sm btn-primary" onClick={() => handleAnnotate(fr)}>Revisar</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step > 1 && step < 4 && (
              <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>Voltar</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            {step === 1 && <button className="btn btn-primary" onClick={goToStep2}>Proximo</button>}
            {step === 2 && <button className="btn btn-primary" onClick={goToStep3} disabled={files.length === 0}>Proximo</button>}
            {step === 3 && (
              <button className="btn btn-primary" onClick={handleUploadAndAnnotate} disabled={uploading || !effectiveLLM}>
                {uploading ? (uploadProgress || 'Enviando...') : 'Enviar e Auto-anotar'}
              </button>
            )}
            {step === 4 && <button className="btn btn-primary" onClick={onClose}>Concluir</button>}
          </div>
        </div>
      </div>

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
    </div>
  );
}


/* ================================================================
   DATASETS TAB
   ================================================================ */
function DatasetsTab({ fixtureTypes, contexts }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [deletingGroup, setDeletingGroup] = useState(null);

  // Expand/annotate state
  const [openGroup, setOpenGroup] = useState(null);
  const [frames, setFrames] = useState([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [autoAnnotatingGroup, setAutoAnnotatingGroup] = useState(null);
  const [annotateProgress, setAnnotateProgress] = useState(null);
  const [selectedFrames, setSelectedFrames] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [playingGroup, setPlayingGroup] = useState(null);

  // Annotation editor
  const [annotatingImage, setAnnotatingImage] = useState(null);
  const [annotatingData, setAnnotatingData] = useState(null);

  // Training modal
  const [trainGroup, setTrainGroup] = useState(null);
  const [trainDataset, setTrainDataset] = useState('');
  const [trainModelName, setTrainModelName] = useState('');
  const [trainModelSize, setTrainModelSize] = useState('s');
  const [trainEpochs, setTrainEpochs] = useState(100);
  const [trainBatchSize, setTrainBatchSize] = useState(16);
  const [startingTrain, setStartingTrain] = useState(false);

  // Training jobs
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobDetails, setJobDetails] = useState({});
  const [publishing, setPublishing] = useState(null);
  const [publishModal, setPublishModal] = useState(null);
  const [publishName, setPublishName] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTrainingGroups()
      .then(grps => setGroups(Array.isArray(grps) ? grps : []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    fetchTrainingJobs()
      .then(resp => setJobs(resp.jobs || resp || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // Check for active auto-annotation jobs on mount and poll
  useEffect(() => {
    let pollInterval = null;
    fetchActiveAutoAnnotations().then(active => {
      const keys = Object.keys(active || {});
      if (keys.length > 0) {
        const sourceName = keys[0];
        const job = active[sourceName];
        setAutoAnnotatingGroup(sourceName);
        setAnnotateProgress(job);

        pollInterval = setInterval(async () => {
          try {
            const status = await autoAnnotateGroupStatus(sourceName);
            setAnnotateProgress(status);
            if (status.status === 'COMPLETED') {
              clearInterval(pollInterval);
              setAutoAnnotatingGroup(null);
              setAnnotateProgress(null);
              setSuccessMsg(`Auto-anotacao concluida: ${status.done - status.errors}/${status.total} frames anotados`);
              setTimeout(() => setSuccessMsg(null), 6000);
              load();
            }
          } catch (_) { /* keep polling */ }
        }, 2000);
      }
    }).catch(() => {});

    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for active jobs
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'RUNNING' || j.status === 'PENDING');
    if (!hasActive) return;
    const interval = setInterval(() => {
      fetchTrainingJobs().then(resp => setJobs(resp.jobs || resp || [])).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [jobs]);

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

  const handleDeleteGroup = async (sourceName) => {
    if (!window.confirm(`Excluir dataset "${sourceName}" e todos os frames?`)) return;
    setDeletingGroup(sourceName);
    try {
      await deleteTrainingGroup(sourceName);
      if (openGroup === sourceName) { setOpenGroup(null); setFrames([]); }
      setGroups(prev => prev.filter(g => g.source_name !== sourceName));
      setSuccessMsg('Dataset excluido com sucesso');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) { setError(err.message); }
    setDeletingGroup(null);
  };

  const handleAutoAnnotateGroup = async (sourceName) => {
    setAutoAnnotatingGroup(sourceName);
    setAnnotateProgress(null);
    try {
      await autoAnnotateGroup(sourceName);
      const poll = setInterval(async () => {
        try {
          const status = await autoAnnotateGroupStatus(sourceName);
          setAnnotateProgress(status);
          if (status.status === 'COMPLETED') {
            clearInterval(poll);
            setAutoAnnotatingGroup(null);
            setAnnotateProgress(null);
            setSuccessMsg(`Auto-anotacao concluida: ${status.done - status.errors}/${status.total} frames anotados`);
            setTimeout(() => setSuccessMsg(null), 6000);
            load();
            if (openGroup === sourceName) handleOpenGroup(sourceName);
          }
        } catch (_) { /* keep polling */ }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setAutoAnnotatingGroup(null);
    }
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
      setAnnotatingImage(null);
      setAnnotatingData(null);
      fetchTrainingGroups().then(grps => setGroups(Array.isArray(grps) ? grps : [])).catch(() => {});
      if (openGroup) fetchGroupFrames(openGroup).then(f => setFrames(Array.isArray(f) ? f : [])).catch(() => {});
    } catch (err) { setError(err.message); }
  };

  const handleAutoAnnotateFrame = async (image) => {
    try {
      await autoAnnotate(image.image_id);
      if (openGroup) fetchGroupFrames(openGroup).then(f => setFrames(Array.isArray(f) ? f : [])).catch(() => {});
      fetchTrainingGroups().then(grps => setGroups(Array.isArray(grps) ? grps : [])).catch(() => {});
    } catch (err) { setError(err.message); }
  };

  const deleteSelected = async () => {
    if (selectedFrames.size === 0) return;
    if (!window.confirm(`Excluir ${selectedFrames.size} frame(s)?`)) return;
    try {
      for (const id of selectedFrames) await deleteTrainingImage(id);
      setSelectedFrames(new Set());
      setSelectMode(false);
      load();
      if (openGroup) {
        const f = await fetchGroupFrames(openGroup);
        setFrames(Array.isArray(f) ? f : []);
      }
    } catch (err) { setError(err.message); }
  };

  // Training modal handlers
  const openTrainModal = () => {
    const annotated = groups.filter(g => g.total_annotations > 0);
    setTrainDataset(annotated.length === 1 ? annotated[0].source_name : '');
    setTrainModelName(`yolo_${trainModelSize}_e${trainEpochs}`);
    setTrainGroup(true);
  };

  const handleStartTraining = async () => {
    if (!trainDataset) { setError('Selecione um dataset'); return; }
    setStartingTrain(true);
    setError(null);
    try {
      await startTrainingJob({
        model_size: trainModelSize,
        epochs: trainEpochs,
        batch_size: trainBatchSize,
        model_name: trainModelName,
        dataset_name: trainDataset,
      });
      setTrainGroup(null);
      setSuccessMsg('Treinamento iniciado! Acompanhe abaixo.');
      setTimeout(() => setSuccessMsg(null), 6000);
      fetchTrainingJobs().then(resp => setJobs(resp.jobs || resp || [])).catch(() => {});
    } catch (err) { setError(err.message); }
    setStartingTrain(false);
  };

  // Job expand
  const handleExpandJob = async (jobId) => {
    if (expandedJobId === jobId) { setExpandedJobId(null); return; }
    setExpandedJobId(jobId);
    if (!jobDetails[jobId]) {
      try {
        const detail = await fetchJobDetail(jobId);
        setJobDetails(prev => ({ ...prev, [jobId]: detail }));
      } catch (err) { setError(err.message); }
    }
  };

  const openPublishModal = (job) => {
    const suggested = job.model_name || `yolo_${job.model_size || 'n'}_e${job.epochs || 50}`;
    setPublishName(suggested);
    setPublishModal({ jobId: job.job_id });
  };

  const handlePublish = async () => {
    if (!publishModal) return;
    try {
      setPublishing(publishModal.jobId);
      setError(null);
      setPublishModal(null);
      const result = await publishJobModel(publishModal.jobId, publishName);
      fetchTrainingJobs().then(resp => setJobs(resp.jobs || resp || [])).catch(() => {});
      const ucInfo = result.uc_model ? ` | UC: ${result.uc_model} v${result.uc_version || '?'}` : '';
      const ucErr = result.uc_error ? ` | Erro UC: ${result.uc_error}` : '';
      setSuccessMsg(`Modelo publicado!${ucInfo}${ucErr}`);
      setTimeout(() => setSuccessMsg(null), 10000);
    } catch (err) { setError(`Falha ao publicar: ${err.message}`); }
    setPublishing(null);
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

  const ftArray = fixtureTypes.map(ft => ({
    name: ft.name,
    display_name: ft.display_name || ft.name,
    color: ft.color || TYPE_COLORS[ft.name] || '#888',
  }));

  return (
    <>
      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}
      {successMsg && <div className="card" style={{ background: '#F0FDF4', borderLeft: '4px solid #10B981', padding: '12px 16px' }}><span style={{ color: '#166534' }}>{successMsg}</span></div>}

      {/* Publish Modal */}
      {publishModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 8px' }}>Publicar Modelo no Unity Catalog</h3>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>
              O modelo sera registrado em <strong>jsf_demo_catalog.scenic_crawler</strong>.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Nome do modelo no UC</label>
            <input className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px', marginBottom: 4 }}
              value={publishName}
              onChange={e => setPublishName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 20 }}>
              Nome completo: <code>jsf_demo_catalog.scenic_crawler.{publishName || '...'}</code>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setPublishModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handlePublish} disabled={!publishName}>Publicar no UC</button>
            </div>
          </div>
        </div>
      )}

      {/* Training config modal */}
      {trainGroup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 560, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 20px' }}>Iniciar Treinamento</h3>

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Dataset</label>
            <select className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px', marginBottom: 16 }}
              value={trainDataset} onChange={e => setTrainDataset(e.target.value)}>
              <option value="">Selecione um dataset...</option>
              {groups.filter(g => g.total_annotations > 0).map(g => (
                <option key={g.source_name} value={g.source_name}>
                  {g.source_name} ({g.frame_count} frames, {g.total_annotations} anotacoes{g.context_name ? ` - ${g.context_name}` : ''})
                </option>
              ))}
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Nome do modelo</label>
            <input className="inline-input" style={{ width: '100%', fontSize: 14, padding: '10px 14px', marginBottom: 16 }}
              value={trainModelName}
              onChange={e => setTrainModelName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="ex: yolo_expositores_v1" />

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Tamanho do modelo</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {MODEL_SIZES.map(ms => (
                <div key={ms.value} onClick={() => { setTrainModelSize(ms.value); setTrainModelName(`yolo_${ms.value}_e${trainEpochs}`); }}
                  style={{
                    padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: trainModelSize === ms.value ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                    background: trainModelSize === ms.value ? '#FFF1F2' : '#fff',
                  }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{ms.label}</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>{ms.desc}</div>
                </div>
              ))}
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Epochs: {trainEpochs}</label>
            <input type="range" min="30" max="300" step="10" value={trainEpochs}
              onChange={e => { setTrainEpochs(Number(e.target.value)); setTrainModelName(`yolo_${trainModelSize}_e${e.target.value}`); }}
              style={{ width: '100%', marginBottom: 16 }} />

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Batch Size</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[8, 16, 32].map(bs => (
                <button key={bs} className={`btn ${trainBatchSize === bs ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTrainBatchSize(bs)}>{bs}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setTrainGroup(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleStartTraining} disabled={startingTrain || !trainModelName || !trainDataset}>
                {startingTrain ? 'Iniciando...' : 'Iniciar Treinamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dataset groups */}
      <h3 style={{ margin: '16px 0 8px' }}>Datasets</h3>

      {loading ? (
        <div className="empty-state">Carregando...</div>
      ) : groups.length === 0 ? (
        <div className="empty-state">Nenhum dataset. Clique em "Novo Treinamento" para comecar.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(g => (
            <div key={g.source_name} className="card" style={{ padding: 0, overflow: 'hidden', opacity: deletingGroup === g.source_name ? 0.5 : 1, transition: 'opacity 0.2s' }}>
              <div className="training-group-header" onClick={() => handleOpenGroup(g.source_name)}>
                <img src={g.thumbnail_url} alt="" className="training-group-thumb" />
                <div className="training-group-info">
                  <div className="training-group-name">{g.source_name}</div>
                  <div className="training-group-meta">
                    {g.frame_count} frame{g.frame_count !== 1 ? 's' : ''} | {g.total_annotations || 0} anotacoes
                    {g.context_name && <span style={{ marginLeft: 8, background: '#EEF2FF', color: '#4338CA', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>{g.context_name}</span>}
                  </div>
                </div>
                <div className="training-group-actions" onClick={e => e.stopPropagation()}>
                  {deletingGroup === g.source_name ? (
                    <span style={{ fontSize: 13, color: '#6B7280' }}>Excluindo...</span>
                  ) : (
                    <>
                      {g.has_video && (
                        <button className="btn btn-sm" onClick={() => setPlayingGroup(playingGroup === g.source_name ? null : g.source_name)}>
                          {playingGroup === g.source_name ? 'Parar' : 'Play'}
                        </button>
                      )}
                      <button className="btn btn-sm btn-primary" onClick={() => handleOpenGroup(g.source_name)}>
                        {openGroup === g.source_name ? 'Fechar' : 'Revisar anotacoes'}
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteGroup(g.source_name)}>Excluir</button>
                    </>
                  )}
                </div>
              </div>

              {/* Auto-annotation progress bar */}
              {autoAnnotatingGroup === g.source_name && (
                <div style={{ padding: '10px 16px', background: '#FFF7ED', borderTop: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="training-progress-bar-track" style={{ flex: 1 }}>
                    <div className="training-progress-bar-fill" style={{
                      width: annotateProgress ? `${(annotateProgress.done / Math.max(annotateProgress.total, 1)) * 100}%` : '10%',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <span style={{ fontSize: 13, color: '#92400E', whiteSpace: 'nowrap' }}>
                    {annotateProgress ? `Auto-anotando: ${annotateProgress.done}/${annotateProgress.total}` : 'Iniciando auto-anotacao...'}
                  </span>
                </div>
              )}

              {/* Video player */}
              {playingGroup === g.source_name && g.video_url && (
                <VideoAnnotationPlayer videoUrl={g.video_url} sourceName={g.source_name} fixtureTypes={ftArray} />
              )}

              {/* Frame browser */}
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
                            <button className="btn btn-sm" onClick={() => {
                              setSelectedFrames(prev => prev.size === frames.length ? new Set() : new Set(frames.map(f => f.image_id)));
                            }}>
                              {selectedFrames.size === frames.length ? 'Desmarcar todos' : 'Selecionar todos'}
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={selectedFrames.size === 0} onClick={deleteSelected}>
                              Excluir {selectedFrames.size}
                            </button>
                          </>
                        )}
                      </div>
                      <div className="training-frame-grid">
                        {frames.map(fr => (
                          <div key={fr.image_id}
                            className={`training-frame-card ${selectMode && selectedFrames.has(fr.image_id) ? 'selected' : ''}`}
                            onClick={selectMode ? () => {
                              setSelectedFrames(prev => {
                                const next = new Set(prev);
                                if (next.has(fr.image_id)) next.delete(fr.image_id); else next.add(fr.image_id);
                                return next;
                              });
                            } : undefined}>
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
                                <button className="btn btn-sm btn-primary" onClick={() => handleAnnotate(fr)}>Revisar</button>
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

      {/* Training Jobs */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Treinamentos</h3>
        <button className="btn btn-primary" onClick={openTrainModal}
          disabled={!groups.length || !groups.some(g => g.total_annotations > 0)}>
          Treinar Modelo
        </button>
      </div>
      {jobs.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>Nenhum treinamento realizado.</div>
      ) : (
        <div style={{ marginTop: 12 }}>
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
                      {job.model_name && <span style={{ fontSize: 13, fontWeight: 600 }}>{job.model_name}</span>}
                      <span className="training-job-model">{job.model_size || '-'}</span>
                      <span className="training-job-params">{job.epochs}ep / batch{job.batch_size}</span>
                      {job.dataset_name && <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 4 }}>| Dataset: {job.dataset_name}</span>}
                    </div>
                    <div className="training-job-header-right">
                      <span className="training-job-duration">{formatDuration(job.duration_seconds)}</span>
                      <span className="training-job-expand">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="training-job-details">
                      <div style={{ padding: '8px 12px', fontSize: 13, color: '#6B7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {job.started_at && <span>Inicio: {new Date(job.started_at).toLocaleString('pt-BR')}</span>}
                        {job.completed_at && <span>Fim: {new Date(job.completed_at).toLocaleString('pt-BR')}</span>}
                        {job.databricks_run_id && <span>Run: {job.databricks_run_id}</span>}
                      </div>

                      {job.status === 'COMPLETED' && (() => {
                        const pm = (() => { try { if (job.metrics_json) return JSON.parse(job.metrics_json); } catch (_) {} try { if (detail?.metrics_json) return JSON.parse(detail.metrics_json); } catch (_) {} return detail || {}; })();
                        return (
                          <>
                            <div className="training-metrics-grid">
                              <MetricCard label="mAP@50" value={pm.map50} />
                              <MetricCard label="mAP@50-95" value={pm.map50_95} />
                              <MetricCard label="Precision" value={pm.precision} />
                              <MetricCard label="Recall" value={pm.recall} />
                            </div>
                            <div style={{ marginTop: 16, padding: '0 12px 12px' }}>
                              <button className="btn btn-primary" onClick={() => openPublishModal(job)} disabled={publishing === job.job_id}>
                                {publishing === job.job_id ? 'Publicando...' : 'Publicar no UC'}
                              </button>
                            </div>
                          </>
                        );
                      })()}

                      {job.status === 'RUNNING' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
                          <div className="training-progress-bar-track">
                            <div className="training-progress-bar-fill training-progress-bar-indeterminate"
                              style={{ width: '30%', animation: 'training-progress-slide 1.5s ease-in-out infinite' }} />
                          </div>
                          <span className="training-progress-label">Treinando...</span>
                          <style>{`@keyframes training-progress-slide { 0% { margin-left: 0%; } 50% { margin-left: 70%; } 100% { margin-left: 0%; } }`}</style>
                        </div>
                      )}

                      {job.status === 'PENDING' && <div style={{ padding: 12, color: '#6B7280' }}>Aguardando cluster...</div>}

                      {job.status === 'FAILED' && (
                        <div style={{ padding: 12, background: '#FEF2F2', borderRadius: 8, margin: '8px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>Falha</div>
                          <div className="error-text" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{job.error_message || 'Erro desconhecido'}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Annotation Editor */}
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


/* ================================================================
   VIDEO ANNOTATION PLAYER
   ================================================================ */
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
    fetchGroupAnnotations(sourceName).then(data => { setAnnotations(data || {}); setLoaded(true); }).catch(() => setLoaded(true));
  }, [sourceName]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => { const sec = Math.floor(video.currentTime); setCurrentAnns(annotations[sec] || []); setCurrentTime(video.currentTime); };
    const onMeta = () => setDuration(video.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('loadedmetadata', onMeta); video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); };
  }, [annotations]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => { document.fullscreenElement ? document.exitFullscreen() : containerRef.current?.requestFullscreen(); };
  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); };
  const seek = (e) => { const v = videoRef.current; if (!v || !duration) return; const rect = e.currentTarget.getBoundingClientRect(); v.currentTime = ((e.clientX - rect.left) / rect.width) * duration; };
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const typeColorMap = {};
  (fixtureTypes || []).forEach(ft => { typeColorMap[ft.name] = ft.color || '#E11D48'; });

  return (
    <div className="video-annotation-player">
      <div className={`video-ann-container ${isFullscreen ? 'fullscreen' : ''}`} ref={containerRef}>
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
                  <span className="video-ann-label" style={{ background: typeColorMap[ann.fixture_type] || '#10B981' }}>{ann.fixture_type}</span>
                </div>
              ))}
            </div>
            {!playing && <div className="video-ann-play-overlay"><svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.5)"/><path d="M24 18l18 12-18 12V18z" fill="white"/></svg></div>}
          </div>
        </div>
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


/* ================================================================
   MODELS TAB (from Unity Catalog)
   ================================================================ */
function ModelsTab() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchUCModels()
      .then(mdls => { setModels(Array.isArray(mdls) ? mdls : mdls.models || []); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (model) => {
    try {
      await activateUCModel(model.name);
      setSuccessMsg(`Modelo "${model.short_name}" ativado para deteccao`);
      setTimeout(() => setSuccessMsg(null), 5000);
      load();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (model) => {
    if (!window.confirm(`Excluir modelo "${model.short_name}" do Unity Catalog?`)) return;
    try {
      await deleteUCModel(model.name);
      setSuccessMsg(`Modelo "${model.short_name}" excluido do UC`);
      setTimeout(() => setSuccessMsg(null), 5000);
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      {error && <div className="card" style={{ background: '#FEF2F2' }}><span className="error-text">{error}</span></div>}
      {successMsg && <div className="card" style={{ background: '#F0FDF4', borderLeft: '4px solid #10B981', padding: '12px 16px' }}><span style={{ color: '#166534' }}>{successMsg}</span></div>}

      <div className="card">
        <h3>Modelos YOLO no Unity Catalog</h3>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>
          Modelos registrados em <code>jsf_demo_catalog.scenic_crawler</code>. Ative um modelo para usa-lo na deteccao.
        </p>
        {loading ? (
          <div className="empty-state">Carregando modelos do UC...</div>
        ) : models.length === 0 ? (
          <div className="empty-state">Nenhum modelo registrado no Unity Catalog. Treine e publique um modelo na aba Datasets.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Nome</th><th>Versao</th><th>Status</th><th>Criado em</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              {models.map(model => (
                <tr key={model.name + model.version}>
                  <td className="filename">{model.short_name}</td>
                  <td>v{model.version}</td>
                  <td>
                    {model.is_active
                      ? <span className="status-badge" style={{ background: '#10B981' }}>ATIVO</span>
                      : <span className="status-badge" style={{ background: '#6B7280' }}>Inativo</span>}
                  </td>
                  <td>{model.created_at ? new Date(model.created_at * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!model.is_active && <button className="btn btn-sm btn-primary" onClick={() => handleActivate(model)}>Ativar</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(model)}>Excluir</button>
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


/* ================================================================
   HELPER COMPONENTS
   ================================================================ */
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

export default Training;
