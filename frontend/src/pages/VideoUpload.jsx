import React, { useState, useRef, useEffect } from 'react';
import { uploadVideo, fetchServingEndpoints, fetchDetectionMode, setDetectionMode, updateConfig, fetchConfigs, fetchTrainedModels, activateModel } from '../api';

const UF_REGEX = /^[A-Z]{2}_[A-Za-z0-9]+_\d{8}\.\w+$/;
const VALID_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const DETECTION_MODES = [
  { key: 'LLM', label: 'LLM', icon: '🧠', desc: 'Modelo multimodal (Claude, GPT, Gemini) analisa cada frame e identifica expositores.' },
  { key: 'YOLO', label: 'YOLO', icon: '⚡', desc: 'Modelo YOLO treinado com seus dados. Deteccao rapida e precisa.' },
  { key: 'HYBRID', label: 'Hibrido', icon: '🔄', desc: 'YOLO detecta bounding boxes + LLM classifica e descreve cada expositor.' },
];

const IMAGE_EXTS = ['jpg','jpeg','png','bmp','webp','tiff','tif'];

function VideoUpload({ navigate }) {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  // Step 2 state
  const [detectionMode, setDetectionModeLocal] = useState('LLM');
  const [selectedLLM, setSelectedLLM] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [endpoints, setEndpoints] = useState([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [yoloModels, setYoloModels] = useState([]);

  // Step 3 state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  // Load endpoints + models when entering step 2
  useEffect(() => {
    if (step !== 2) return;
    setLoadingEndpoints(true);
    Promise.all([
      fetchServingEndpoints().catch(() => []),
      fetchTrainedModels().catch(() => []),
      fetchDetectionMode().catch(() => ({ mode: 'LLM' })),
      fetchConfigs().catch(() => []),
    ]).then(([eps, mdls, dm, configs]) => {
      setEndpoints(eps || []);
      setYoloModels(mdls.models || mdls || []);
      setDetectionModeLocal((dm.mode || 'LLM').toUpperCase());
      const fmapi = (configs || []).find(c => c.config_key === 'fmapi_model');
      if (fmapi) setSelectedLLM(fmapi.config_value);
    }).finally(() => setLoadingEndpoints(false));
  }, [step]);

  function validateFilename(name) {
    if (!UF_REGEX.test(name)) return 'Formato invalido. Use: UF_IDLOJA_yyyymmdd.ext';
    const parts = name.split('_');
    if (!VALID_UFS.includes(parts[0].toUpperCase())) return `UF invalida: ${parts[0]}`;
    const dateStr = parts[2].split('.')[0];
    const y = parseInt(dateStr.substring(0, 4)), m = parseInt(dateStr.substring(4, 6)), d = parseInt(dateStr.substring(6, 8));
    if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return `Data invalida: ${dateStr}`;
    return null;
  }

  function isPhoto(name) { return IMAGE_EXTS.includes(name.split('.').pop()?.toLowerCase()); }

  function handleFiles(fileList) {
    const arr = Array.from(fileList).map(f => ({
      file: f, name: f.name, size: f.size,
      error: validateFilename(f.name),
      uf: f.name.split('_')[0]?.toUpperCase(),
      store: f.name.split('_')[1],
      date: f.name.split('_')[2]?.split('.')[0],
      mediaType: isPhoto(f.name) ? 'Foto' : 'Video',
    }));
    setFiles(prev => [...prev, ...arr]);
  }

  function removeFile(idx) { setFiles(f => f.filter((_, i) => i !== idx)); }

  const validCount = files.filter(f => !f.error).length;

  const goToStep2 = () => {
    if (!validCount) { setError('Nenhum arquivo valido selecionado'); return; }
    setError(null);
    setStep(2);
  };

  const effectiveLLM = useCustom ? customEndpoint : selectedLLM;

  const canProcess = () => {
    if (detectionMode === 'YOLO') return yoloModels.some(m => m.is_active);
    if (detectionMode === 'LLM' || detectionMode === 'HYBRID') return !!effectiveLLM;
    return true;
  };

  async function handleProcess() {
    setError(null);
    setUploading(true);
    setStep(3);

    try {
      // Save detection mode
      setUploadProgress('Configurando modo de deteccao...');
      await setDetectionMode(detectionMode);

      // Save LLM model if applicable
      if ((detectionMode === 'LLM' || detectionMode === 'HYBRID') && effectiveLLM) {
        await updateConfig('fmapi_model', effectiveLLM, 'Serving endpoint do modelo de visao');
      }

      // Upload files
      const valid = files.filter(f => !f.error);
      const res = [];
      for (let i = 0; i < valid.length; i++) {
        setUploadProgress(`Enviando ${valid[i].name} (${i + 1}/${valid.length})...`);
        try {
          const r = await uploadVideo(valid[i].file);
          res.push({ name: valid[i].name, success: true, data: r });
        } catch (e) {
          res.push({ name: valid[i].name, success: false, error: e.message });
        }
      }
      setResults(res);
      setUploadProgress('');
    } catch (err) {
      setError(err.message);
      setUploadProgress('');
    } finally {
      setUploading(false);
    }
  }

  const resetWizard = () => { setStep(1); setFiles([]); setResults([]); setError(null); setUploadProgress(''); };

  const activeYolo = yoloModels.find(m => m.is_active);
  const hasYolo = yoloModels.length > 0;

  return (
    <div className="page">
      <div className="page-header"><h1>Upload</h1></div>

      {error && <div className="card" style={{ background: '#FEF2F2', padding: '12px 16px' }}><span className="error-text">{error}</span></div>}

      {/* Wizard steps indicator */}
      <div className="card" style={{ display: 'flex', justifyContent: 'center', gap: 32, padding: '16px 24px' }}>
        {[
          { n: 1, label: 'Selecionar Arquivos' },
          { n: 2, label: 'Modo de Deteccao' },
          { n: 3, label: 'Processar' },
        ].map(s => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: step >= s.n ? 1 : 0.4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step === s.n ? 'var(--app-primary)' : step > s.n ? '#10B981' : '#E5E7EB',
              color: step >= s.n ? '#fff' : '#9CA3AF', fontWeight: 700, fontSize: 14,
            }}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={{ fontSize: 13, fontWeight: step === s.n ? 700 : 400, color: step === s.n ? 'var(--app-dark)' : '#6B7280' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ===== STEP 1: File selection ===== */}
      {step === 1 && (
        <>
          <div className="card">
            <h3>Padrao de Nomenclatura</h3>
            <div className="naming-guide">
              <code className="naming-pattern">UF_IDLOJA_yyyymmdd.ext</code>
              <div className="naming-examples">
                <span className="example">SP_1234_20260415.mp4</span>
                <span className="example">RJ_5678_20260410.jpg</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" multiple accept="video/*,image/*" style={{ display: 'none' }}
                onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
              <div className="upload-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M24 8v24M24 8l-8 8M24 8l8 8M8 34v4a2 2 0 002 2h28a2 2 0 002-2v-4" stroke="var(--app-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <p>Arraste arquivos aqui ou clique para selecionar</p>
              <p className="upload-hint">Videos: MP4, AVI, MOV, MKV, WebM | Fotos: JPG, PNG, BMP, WebP</p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="card">
              <h3>Arquivos Selecionados ({files.length})</h3>
              <table className="data-table">
                <thead><tr><th>Arquivo</th><th>Tipo</th><th>UF</th><th>Loja</th><th>Data</th><th>Tamanho</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {files.map((f, i) => (
                    <tr key={i} className={f.error ? 'row-error' : ''}>
                      <td className="filename">{f.name}</td>
                      <td><span className={`media-badge ${f.mediaType === 'Foto' ? 'photo' : 'video'}`}>{f.mediaType}</span></td>
                      <td>{f.uf && <span className="uf-badge">{f.uf}</span>}</td>
                      <td>{f.store || '-'}</td>
                      <td>{f.date ? `${f.date.substring(0,4)}-${f.date.substring(4,6)}-${f.date.substring(6,8)}` : '-'}</td>
                      <td>{(f.size / 1024 / 1024).toFixed(1)} MB</td>
                      <td>{f.error ? <span className="error-text">{f.error}</span> : <span className="ok-text">Valido</span>}</td>
                      <td><button className="btn-icon" onClick={() => removeFile(i)}>X</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="upload-actions" style={{ justifyContent: 'space-between' }}>
                <button className="btn btn-secondary" onClick={() => setFiles([])}>Limpar</button>
                <button className="btn btn-primary" onClick={goToStep2} disabled={!validCount}>
                  Proximo: Escolher Deteccao →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== STEP 2: Detection mode + LLM selection ===== */}
      {step === 2 && (
        <>
          <div className="card">
            <h3>Escolha o modo de deteccao</h3>
            <div className="detection-mode-grid">
              {DETECTION_MODES.map(mode => {
                const needsYolo = mode.key === 'YOLO' || mode.key === 'HYBRID';
                const disabled = needsYolo && !hasYolo;
                return (
                  <div
                    key={mode.key}
                    className={`detection-mode-card ${detectionMode === mode.key ? 'detection-mode-card-active' : ''}`}
                    onClick={() => !disabled && setDetectionModeLocal(mode.key)}
                    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  >
                    <div className="detection-mode-icon">{mode.icon}</div>
                    <div className="detection-mode-label">{mode.label}</div>
                    <div className="detection-mode-desc">{mode.desc}</div>
                    {disabled && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Treine um modelo YOLO primeiro</div>}
                    {detectionMode === mode.key && (
                      <span className="status-badge" style={{ background: '#10B981', marginTop: 8 }}>SELECIONADO</span>
                    )}
                    {needsYolo && activeYolo && (
                      <div style={{ fontSize: 11, color: '#10B981', marginTop: 4 }}>Modelo ativo: {activeYolo.model_name}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* LLM Model selection */}
          {(detectionMode === 'LLM' || detectionMode === 'HYBRID') && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>Escolha o modelo LLM</h3>
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
                    <div className="empty-state">Nenhum serving endpoint multimodal encontrado.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                      {endpoints.filter(ep => ep.state === 'READY' || ep.state === true).map(ep => (
                        <div
                          key={ep.name}
                          onClick={() => { setSelectedLLM(ep.name); setUseCustom(false); }}
                          style={{
                            padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                            border: selectedLLM === ep.name && !useCustom ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                            background: selectedLLM === ep.name && !useCustom ? '#FFF1F2' : '#fff',
                            transition: 'all 0.15s',
                          }}
                        >
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
                  <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
                    Digite o nome do serving endpoint do seu modelo personalizado:
                  </p>
                  <input
                    className="inline-input"
                    style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
                    placeholder="ex: meu-modelo-visao-v2"
                    value={customEndpoint}
                    onChange={e => setCustomEndpoint(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* YOLO models table */}
          {(detectionMode === 'YOLO' || detectionMode === 'HYBRID') && yoloModels.length > 0 && (
            <div className="card">
              <h3>Modelos YOLO Treinados</h3>
              <table className="data-table">
                <thead><tr><th>Nome</th><th>mAP@50</th><th>Precision</th><th>Recall</th><th>Status</th><th>Acoes</th></tr></thead>
                <tbody>
                  {yoloModels.map(model => (
                    <tr key={model.model_id}>
                      <td className="filename">{model.model_name || '-'}</td>
                      <td>{model.map50 != null ? (model.map50 * 100).toFixed(1) + '%' : '-'}</td>
                      <td>{(model.precision_val ?? model.precision) != null ? ((model.precision_val ?? model.precision) * 100).toFixed(1) + '%' : '-'}</td>
                      <td>{(model.recall_val ?? model.recall) != null ? ((model.recall_val ?? model.recall) * 100).toFixed(1) + '%' : '-'}</td>
                      <td>{model.is_active ? <span className="status-badge" style={{ background: '#10B981' }}>ATIVO</span> : <span className="status-badge" style={{ background: '#6B7280' }}>Inativo</span>}</td>
                      <td>{!model.is_active && <button className="btn btn-sm btn-primary" onClick={async () => { await activateModel(model.model_id); const m = await fetchTrainedModels(); setYoloModels(m.models || m || []); }}>Ativar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0 16px' }}>
            <button className="btn" onClick={() => setStep(1)} style={{ background: '#6B7280', color: '#fff' }}>← Voltar</button>
            <button className="btn btn-primary" onClick={handleProcess} disabled={!canProcess()}>
              Processar {validCount} arquivo(s) →
            </button>
          </div>
        </>
      )}

      {/* ===== STEP 3: Processing / Results ===== */}
      {step === 3 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          {uploading && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
              <h3>Processando...</h3>
              <p style={{ color: '#6B7280', fontSize: 14 }}>{uploadProgress}</p>
            </>
          )}

          {!uploading && results.length > 0 && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h3>Upload concluido!</h3>
              <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
                Modo: <strong>{detectionMode}</strong>
                {effectiveLLM && <> | Modelo: <strong>{effectiveLLM}</strong></>}
              </p>
              <div style={{ textAlign: 'left', maxWidth: 500, margin: '0 auto' }}>
                {results.map((r, i) => (
                  <div key={i} className={`upload-result ${r.success ? 'success' : 'error'}`}>
                    <span>{r.name}</span>
                    {r.success ? (
                      <span className="ok-text">Enviado! Video ID: {r.data.video_id} - Processando...</span>
                    ) : (
                      <span className="error-text">Erro: {r.error}</span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                <button className="btn btn-primary" onClick={() => navigate('videos')}>Ver Videos</button>
                <button className="btn btn-secondary" onClick={resetWizard}>Novo Upload</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default VideoUpload;
