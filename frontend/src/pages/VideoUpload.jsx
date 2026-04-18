import React, { useState, useRef } from 'react';
import { uploadVideo } from '../api';

const UF_REGEX = /^[A-Z]{2}_[A-Za-z0-9]+_\d{8}\.\w+$/;
const VALID_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

function VideoUpload({ navigate }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  function validateFilename(name) {
    if (!UF_REGEX.test(name)) return 'Formato invalido. Use: UF_IDLOJA_yyyymmdd.mp4';
    const parts = name.split('_');
    if (!VALID_UFS.includes(parts[0].toUpperCase())) return `UF invalida: ${parts[0]}`;
    const dateStr = parts[2].split('.')[0];
    const y = parseInt(dateStr.substring(0, 4)), m = parseInt(dateStr.substring(4, 6)), d = parseInt(dateStr.substring(6, 8));
    if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return `Data invalida: ${dateStr}`;
    return null;
  }

  const IMAGE_EXTS = ['jpg','jpeg','png','bmp','webp','tiff','tif'];
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

  async function handleUpload() {
    const valid = files.filter(f => !f.error);
    if (!valid.length) return;
    setUploading(true);
    const res = [];
    for (const f of valid) {
      try {
        const r = await uploadVideo(f.file);
        res.push({ name: f.name, success: true, data: r });
      } catch (e) {
        res.push({ name: f.name, success: false, error: e.message });
      }
    }
    setResults(res);
    setFiles([]);
    setUploading(false);
  }

  const validCount = files.filter(f => !f.error).length;

  return (
    <div className="page">
      <div className="page-header"><h1>Upload</h1></div>

      <div className="card">
        <h3>Padrao de Nomenclatura</h3>
        <div className="naming-guide">
          <code className="naming-pattern">UF_IDLOJA_yyyymmdd.ext</code>
          <div className="naming-examples">
            <span className="example">SP_1234_20260415.mp4</span>
            <span className="example">RJ_5678_20260410.jpg</span>
            <span className="example">MG_0042_20260401.png</span>
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
          <div className="upload-actions">
            <button className="btn btn-primary" onClick={handleUpload} disabled={!validCount || uploading}>
              {uploading ? 'Enviando...' : `Enviar ${validCount} video(s)`}
            </button>
            <button className="btn btn-secondary" onClick={() => setFiles([])}>Limpar</button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="card">
          <h3>Resultados do Upload</h3>
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
          <button className="btn btn-secondary" onClick={() => { setResults([]); navigate('videos'); }} style={{ marginTop: 12 }}>
            Ver Videos
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoUpload;
