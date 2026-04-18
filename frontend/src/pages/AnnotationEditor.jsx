import React, { useState, useRef, useEffect, useCallback } from 'react';

function AnnotationEditor({ imageId, imageSrc, initialAnnotations, fixtureTypes, onSave, onClose }) {
  const [annotations, setAnnotations] = useState(initialAnnotations || []);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [selectedType, setSelectedType] = useState(fixtureTypes?.[0]?.name || '');
  const [drawing, setDrawing] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const typeColorMap = {};
  (fixtureTypes || []).forEach(ft => {
    typeColorMap[ft.name] = ft.color || '#888';
  });

  const getImgRect = useCallback(() => {
    if (!imgRef.current) return null;
    return imgRef.current.getBoundingClientRect();
  }, []);

  const toPercent = useCallback((px, dim) => (px / dim) * 100, []);
  const fromPercent = useCallback((pct, dim) => (pct / 100) * dim, []);

  const handleImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  const handleMouseDown = useCallback((e) => {
    const rect = getImgRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    setDrawing({ startX: x, startY: y, curX: x, curY: y, rectW: rect.width, rectH: rect.height });
    setSelectedIdx(null);
  }, [getImgRect]);

  const handleMouseMove = useCallback((e) => {
    if (!drawing) return;
    const rect = getImgRect();
    if (!rect) return;
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    setDrawing(prev => ({ ...prev, curX, curY }));
  }, [drawing, getImgRect]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    const { startX, startY, curX, curY, rectW, rectH } = drawing;
    const minX = Math.min(startX, curX);
    const minY = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    if (w > 5 && h > 5) {
      const cx = toPercent(minX + w / 2, rectW);
      const cy = toPercent(minY + h / 2, rectH);
      const pw = toPercent(w, rectW);
      const ph = toPercent(h, rectH);
      const newAnn = {
        fixture_type: selectedType,
        x: Math.round(cx * 10) / 10,
        y: Math.round(cy * 10) / 10,
        w: Math.round(pw * 10) / 10,
        h: Math.round(ph * 10) / 10,
      };
      setAnnotations(prev => [...prev, newAnn]);
      setSelectedIdx(annotations.length);
    }
    setDrawing(null);
  }, [drawing, selectedType, toPercent, annotations.length]);

  const handleClickAnnotation = useCallback((e, idx) => {
    e.stopPropagation();
    setSelectedIdx(idx === selectedIdx ? null : idx);
  }, [selectedIdx]);

  const deleteAnnotation = useCallback((idx) => {
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx !== null) {
      e.preventDefault();
      deleteAnnotation(selectedIdx);
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [selectedIdx, deleteAnnotation, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(annotations);
    } finally {
      setSaving(false);
    }
  };

  const getDrawingRect = () => {
    if (!drawing) return null;
    const { startX, startY, curX, curY, rectW, rectH } = drawing;
    return {
      left: `${toPercent(Math.min(startX, curX), rectW)}%`,
      top: `${toPercent(Math.min(startY, curY), rectH)}%`,
      width: `${toPercent(Math.abs(curX - startX), rectW)}%`,
      height: `${toPercent(Math.abs(curY - startY), rectH)}%`,
    };
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="annotation-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="annotation-editor-header">
          <h3>Anotacao de Imagem</h3>
          <button className="btn-icon" onClick={onClose} title="Fechar">✕</button>
        </div>

        <div className="annotation-editor-body">
          {/* Canvas area */}
          <div
            className="annotation-canvas-area"
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className="annotation-canvas-wrapper">
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Imagem para anotacao"
                className="annotation-canvas-img"
                onLoad={handleImgLoad}
                draggable={false}
              />

              {/* Existing annotations */}
              {annotations.map((ann, idx) => {
                const color = typeColorMap[ann.fixture_type] || '#888';
                const left = ann.x - ann.w / 2;
                const top = ann.y - ann.h / 2;
                return (
                  <div
                    key={idx}
                    className={`annotation-box ${idx === selectedIdx ? 'annotation-box-selected' : ''}`}
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${ann.w}%`,
                      height: `${ann.h}%`,
                      borderColor: color,
                    }}
                    onClick={(e) => handleClickAnnotation(e, idx)}
                  >
                    <span className="annotation-label" style={{ background: color }}>
                      {ann.fixture_type}
                    </span>
                  </div>
                );
              })}

              {/* Drawing rectangle */}
              {drawing && (() => {
                const rect = getDrawingRect();
                const color = typeColorMap[selectedType] || '#888';
                return rect ? (
                  <div
                    className="annotation-box annotation-box-drawing"
                    style={{
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                      borderColor: color,
                    }}
                  />
                ) : null;
              })()}
            </div>
          </div>

          {/* Sidebar */}
          <div className="annotation-sidebar">
            <div className="annotation-sidebar-section">
              <h4>Tipo de Expositor</h4>
              <div className="annotation-type-buttons">
                {(fixtureTypes || []).map(ft => (
                  <button
                    key={ft.name}
                    className={`annotation-type-btn ${selectedType === ft.name ? 'annotation-type-btn-active' : ''}`}
                    style={{
                      borderColor: ft.color || '#888',
                      background: selectedType === ft.name ? (ft.color || '#888') : 'transparent',
                      color: selectedType === ft.name ? '#fff' : (ft.color || '#888'),
                    }}
                    onClick={() => setSelectedType(ft.name)}
                  >
                    {ft.display_name || ft.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="annotation-sidebar-section annotation-list-section">
              <h4>Anotacoes ({annotations.length})</h4>
              <div className="annotation-list">
                {annotations.length === 0 && (
                  <div className="empty-state">
                    Clique e arraste na imagem para criar anotacoes
                  </div>
                )}
                {annotations.map((ann, idx) => {
                  const color = typeColorMap[ann.fixture_type] || '#888';
                  return (
                    <div
                      key={idx}
                      className={`annotation-list-item ${idx === selectedIdx ? 'annotation-list-item-selected' : ''}`}
                      onClick={() => setSelectedIdx(idx === selectedIdx ? null : idx)}
                    >
                      <span className="annotation-list-dot" style={{ background: color }} />
                      <span className="annotation-list-name">{ann.fixture_type}</span>
                      <span className="annotation-list-coords">
                        ({ann.x.toFixed(1)}, {ann.y.toFixed(1)})
                      </span>
                      <button
                        className="btn-icon"
                        title="Excluir anotacao"
                        onClick={(e) => { e.stopPropagation(); deleteAnnotation(idx); }}
                      >
                        🗑
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="annotation-sidebar-actions">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnotationEditor;
