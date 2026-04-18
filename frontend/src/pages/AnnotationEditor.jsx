import React, { useState, useRef, useEffect, useCallback } from 'react';

const HANDLE_SIZE = 8;       // px, visual size of resize handles
const HANDLE_HIT = 12;       // px, hit-test area around handles
const MIN_BOX_PCT = 1.5;     // minimum box dimension in %

// Handle positions: [name, xFraction, yFraction]
const HANDLE_DEFS = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['w', 0, 0.5],              ['e', 1, 0.5],
  ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1],
];

const CURSOR_MAP = {
  nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
  n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function AnnotationEditor({ imageId, imageSrc, initialAnnotations, fixtureTypes, onSave, onClose }) {
  const [annotations, setAnnotations] = useState(initialAnnotations || []);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [selectedType, setSelectedType] = useState(fixtureTypes?.[0]?.name || '');
  const [saving, setSaving] = useState(false);

  // Drag state kept in ref for performance (no re-render per mousemove on state)
  const dragRef = useRef(null);
  // We do need a render-trigger for the visual preview while dragging
  const [dragRender, setDragRender] = useState(0);

  const wrapperRef = useRef(null);
  const imgRef = useRef(null);

  // Build color map
  const typeColorMap = {};
  (fixtureTypes || []).forEach(ft => { typeColorMap[ft.name] = ft.color || '#888'; });

  // --- Coordinate helpers ---
  const getWrapperRect = useCallback(() => {
    if (!wrapperRef.current) return null;
    return wrapperRef.current.getBoundingClientRect();
  }, []);

  const pxToPercent = useCallback((pxX, pxY, rect) => ({
    x: (pxX / rect.width) * 100,
    y: (pxY / rect.height) * 100,
  }), []);

  // Convert center-format annotation to top-left rect for display
  const annToRect = (ann) => ({
    left: ann.x - ann.w / 2,
    top: ann.y - ann.h / 2,
    width: ann.w,
    height: ann.h,
  });

  // Convert top-left rect back to center-format annotation
  const rectToAnn = (left, top, width, height, fixtureType) => ({
    fixture_type: fixtureType,
    x: Math.round((left + width / 2) * 10) / 10,
    y: Math.round((top + height / 2) * 10) / 10,
    w: Math.round(width * 10) / 10,
    h: Math.round(height * 10) / 10,
  });

  // --- Hit testing ---
  const hitTestHandle = useCallback((ann, pctX, pctY, rect) => {
    const r = annToRect(ann);
    const hitPctX = (HANDLE_HIT / rect.width) * 100;
    const hitPctY = (HANDLE_HIT / rect.height) * 100;
    for (const [name, fx, fy] of HANDLE_DEFS) {
      const hx = r.left + r.width * fx;
      const hy = r.top + r.height * fy;
      if (Math.abs(pctX - hx) < hitPctX && Math.abs(pctY - hy) < hitPctY) {
        return name;
      }
    }
    return null;
  }, []);

  const hitTestBox = useCallback((ann, pctX, pctY) => {
    const r = annToRect(ann);
    return pctX >= r.left && pctX <= r.left + r.width &&
           pctY >= r.top && pctY <= r.top + r.height;
  }, []);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // left click only
    const rect = getWrapperRect();
    if (!rect) return;

    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    if (rawX < 0 || rawY < 0 || rawX > rect.width || rawY > rect.height) return;

    const pct = pxToPercent(rawX, rawY, rect);

    // Check handles on selected annotation first
    if (selectedIdx !== null && annotations[selectedIdx]) {
      const handle = hitTestHandle(annotations[selectedIdx], pct.x, pct.y, rect);
      if (handle) {
        const ann = annotations[selectedIdx];
        const r = annToRect(ann);
        dragRef.current = {
          mode: 'resize',
          idx: selectedIdx,
          handle,
          origRect: { ...r },
          startPctX: pct.x,
          startPctY: pct.y,
          currentAnn: { ...ann },
        };
        e.preventDefault();
        return;
      }
    }

    // Check if clicking on any box (iterate in reverse so top-most wins)
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (hitTestBox(annotations[i], pct.x, pct.y)) {
        // If clicking the selected box's handle area, that was already checked above.
        // Check handles for this newly-clicked box too
        const handle = hitTestHandle(annotations[i], pct.x, pct.y, rect);
        if (handle) {
          setSelectedIdx(i);
          const ann = annotations[i];
          const r = annToRect(ann);
          dragRef.current = {
            mode: 'resize',
            idx: i,
            handle,
            origRect: { ...r },
            startPctX: pct.x,
            startPctY: pct.y,
            currentAnn: { ...ann },
          };
          e.preventDefault();
          return;
        }

        // Start move
        setSelectedIdx(i);
        dragRef.current = {
          mode: 'move',
          idx: i,
          startPctX: pct.x,
          startPctY: pct.y,
          origAnn: { ...annotations[i] },
          currentAnn: { ...annotations[i] },
        };
        e.preventDefault();
        return;
      }
    }

    // No box hit -- start drawing a new one
    setSelectedIdx(null);
    dragRef.current = {
      mode: 'draw',
      startPctX: pct.x,
      startPctY: pct.y,
      curPctX: pct.x,
      curPctY: pct.y,
    };
    e.preventDefault();
  }, [annotations, selectedIdx, getWrapperRect, pxToPercent, hitTestHandle, hitTestBox]);

  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = getWrapperRect();
    if (!rect) return;

    const rawX = clamp(e.clientX - rect.left, 0, rect.width);
    const rawY = clamp(e.clientY - rect.top, 0, rect.height);
    const pct = pxToPercent(rawX, rawY, rect);

    if (drag.mode === 'draw') {
      drag.curPctX = pct.x;
      drag.curPctY = pct.y;
      setDragRender(r => r + 1);
      return;
    }

    if (drag.mode === 'move') {
      const dx = pct.x - drag.startPctX;
      const dy = pct.y - drag.startPctY;
      const orig = drag.origAnn;
      const halfW = orig.w / 2;
      const halfH = orig.h / 2;

      // Clamp so box stays within image
      let newX = orig.x + dx;
      let newY = orig.y + dy;
      newX = clamp(newX, halfW, 100 - halfW);
      newY = clamp(newY, halfH, 100 - halfH);

      drag.currentAnn = { ...orig, x: newX, y: newY };
      setDragRender(r => r + 1);
      return;
    }

    if (drag.mode === 'resize') {
      const dx = pct.x - drag.startPctX;
      const dy = pct.y - drag.startPctY;
      const o = drag.origRect; // { left, top, width, height }
      let left = o.left, top = o.top, right = o.left + o.width, bottom = o.top + o.height;

      const h = drag.handle;
      if (h.includes('w')) left = clamp(o.left + dx, 0, right - MIN_BOX_PCT);
      if (h.includes('e')) right = clamp(o.left + o.width + dx, left + MIN_BOX_PCT, 100);
      if (h.includes('n')) top = clamp(o.top + dy, 0, bottom - MIN_BOX_PCT);
      if (h.includes('s')) bottom = clamp(o.top + o.height + dy, top + MIN_BOX_PCT, 100);

      const width = right - left;
      const height = bottom - top;
      const ann = annotations[drag.idx];
      drag.currentAnn = rectToAnn(left, top, width, height, ann.fixture_type);
      setDragRender(r => r + 1);
      return;
    }
  }, [getWrapperRect, pxToPercent, annotations]);

  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    if (drag.mode === 'draw') {
      const minX = Math.min(drag.startPctX, drag.curPctX);
      const minY = Math.min(drag.startPctY, drag.curPctY);
      const w = Math.abs(drag.curPctX - drag.startPctX);
      const h = Math.abs(drag.curPctY - drag.startPctY);

      if (w >= MIN_BOX_PCT && h >= MIN_BOX_PCT) {
        const newAnn = rectToAnn(minX, minY, w, h, selectedType);
        setAnnotations(prev => {
          const next = [...prev, newAnn];
          setSelectedIdx(next.length - 1);
          return next;
        });
      }
    } else if (drag.mode === 'move' || drag.mode === 'resize') {
      const ann = drag.currentAnn;
      setAnnotations(prev => {
        const next = [...prev];
        next[drag.idx] = {
          ...ann,
          x: Math.round(ann.x * 10) / 10,
          y: Math.round(ann.y * 10) / 10,
          w: Math.round(ann.w * 10) / 10,
          h: Math.round(ann.h * 10) / 10,
        };
        return next;
      });
    }

    setDragRender(r => r + 1);
  }, [selectedType]);

  // --- Cursor management ---
  const handleMouseMovePassive = useCallback((e) => {
    if (dragRef.current) return; // during drag, cursor set by drag mode
    const rect = getWrapperRect();
    if (!rect || !wrapperRef.current) return;

    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    if (rawX < 0 || rawY < 0 || rawX > rect.width || rawY > rect.height) {
      wrapperRef.current.style.cursor = 'crosshair';
      return;
    }
    const pct = pxToPercent(rawX, rawY, rect);

    // Check handles on selected box
    if (selectedIdx !== null && annotations[selectedIdx]) {
      const handle = hitTestHandle(annotations[selectedIdx], pct.x, pct.y, rect);
      if (handle) {
        wrapperRef.current.style.cursor = CURSOR_MAP[handle];
        return;
      }
    }

    // Check any box
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (hitTestBox(annotations[i], pct.x, pct.y)) {
        // Also check handle of this box
        const handle = hitTestHandle(annotations[i], pct.x, pct.y, rect);
        if (handle) {
          wrapperRef.current.style.cursor = CURSOR_MAP[handle];
          return;
        }
        wrapperRef.current.style.cursor = 'move';
        return;
      }
    }

    wrapperRef.current.style.cursor = 'crosshair';
  }, [annotations, selectedIdx, getWrapperRect, pxToPercent, hitTestHandle, hitTestBox]);

  // --- Keyboard ---
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
      if (dragRef.current) {
        dragRef.current = null;
        setDragRender(r => r + 1);
      } else {
        onClose();
      }
    }
  }, [selectedIdx, deleteAnnotation, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // --- Change type of selected box ---
  const handleTypeClick = useCallback((typeName) => {
    if (selectedIdx !== null && annotations[selectedIdx]) {
      setAnnotations(prev => {
        const next = [...prev];
        next[selectedIdx] = { ...next[selectedIdx], fixture_type: typeName };
        return next;
      });
    }
    setSelectedType(typeName);
  }, [selectedIdx, annotations]);

  // --- Save ---
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(annotations.map(a => ({
        fixture_type: a.fixture_type,
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
      })));
    } finally {
      setSaving(false);
    }
  };

  // --- Determine what to display for each annotation during drag ---
  const getDisplayAnn = (ann, idx) => {
    const drag = dragRef.current;
    if (drag && (drag.mode === 'move' || drag.mode === 'resize') && drag.idx === idx) {
      return drag.currentAnn;
    }
    return ann;
  };

  // --- Drawing preview box ---
  const getDrawingPreview = () => {
    const drag = dragRef.current;
    if (!drag || drag.mode !== 'draw') return null;
    const minX = Math.min(drag.startPctX, drag.curPctX);
    const minY = Math.min(drag.startPctY, drag.curPctY);
    const w = Math.abs(drag.curPctX - drag.startPctX);
    const h = Math.abs(drag.curPctY - drag.startPctY);
    if (w < 0.5 && h < 0.5) return null;
    return { left: minX, top: minY, width: w, height: h };
  };

  // --- Render ---
  const drawingPreview = getDrawingPreview();
  const drawColor = typeColorMap[selectedType] || '#888';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="annotation-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="annotation-editor-header">
          <h3>Anotacao de Imagem</h3>
          <button className="btn-icon" onClick={onClose} title="Fechar">&#x2715;</button>
        </div>

        <div className="annotation-editor-body">
          {/* Canvas area */}
          <div className="annotation-canvas-area">
            <div
              className="annotation-canvas-wrapper"
              ref={wrapperRef}
              onMouseDown={handleMouseDown}
              onMouseMove={(e) => { handleMouseMove(e); handleMouseMovePassive(e); }}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: 'crosshair' }}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Imagem para anotacao"
                className="annotation-canvas-img"
                draggable={false}
              />

              {/* Existing annotations */}
              {annotations.map((rawAnn, idx) => {
                const ann = getDisplayAnn(rawAnn, idx);
                const color = typeColorMap[ann.fixture_type] || '#888';
                const r = annToRect(ann);
                const isSelected = idx === selectedIdx;
                const isDragging = dragRef.current && (dragRef.current.mode === 'move' || dragRef.current.mode === 'resize') && dragRef.current.idx === idx;

                return (
                  <div
                    key={idx}
                    className={`annotation-box ${isSelected ? 'annotation-box-selected' : ''}`}
                    style={{
                      left: `${r.left}%`,
                      top: `${r.top}%`,
                      width: `${r.width}%`,
                      height: `${r.height}%`,
                      borderColor: color,
                      opacity: isDragging ? 0.8 : 1,
                      zIndex: isSelected ? 10 : 1,
                      pointerEvents: 'none', // let wrapper handle all mouse events
                    }}
                  >
                    <span
                      className="annotation-label"
                      style={{ background: color }}
                    >
                      {ann.fixture_type}
                    </span>

                    {/* Resize handles (only when selected) */}
                    {isSelected && HANDLE_DEFS.map(([name, fx, fy]) => (
                      <div
                        key={name}
                        style={{
                          position: 'absolute',
                          left: `calc(${fx * 100}% - ${HANDLE_SIZE / 2}px)`,
                          top: `calc(${fy * 100}% - ${HANDLE_SIZE / 2}px)`,
                          width: `${HANDLE_SIZE}px`,
                          height: `${HANDLE_SIZE}px`,
                          background: color,
                          border: '1px solid #fff',
                          borderRadius: '1px',
                          pointerEvents: 'none',
                          zIndex: 20,
                        }}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Drawing preview rectangle */}
              {drawingPreview && (
                <div
                  className="annotation-box annotation-box-drawing"
                  style={{
                    left: `${drawingPreview.left}%`,
                    top: `${drawingPreview.top}%`,
                    width: `${drawingPreview.width}%`,
                    height: `${drawingPreview.height}%`,
                    borderColor: drawColor,
                    pointerEvents: 'none',
                  }}
                />
              )}
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
                    onClick={() => handleTypeClick(ft.name)}
                  >
                    {ft.display_name || ft.name}
                  </button>
                ))}
              </div>
              {selectedIdx !== null && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
                  Clique um tipo para alterar a anotacao selecionada
                </div>
              )}
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
                        &#x1F5D1;
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
