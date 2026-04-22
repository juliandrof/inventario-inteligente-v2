import React, { useState, useEffect } from 'react';
import { fetchConfigs, updateConfig, fetchBranding, updateBranding, uploadLogo, clearAllData, fetchContexts, createContext, updateContextApi, deleteContextApi, fetchContextObjectTypes, createContextObjectType, updateContextObjectType, deleteContextObjectType } from '../api';

const CONFIG_HELP = {
  fmapi_model: 'O nome do Serving Endpoint que sera usado para analisar os frames do video. Pode ser um modelo padrao da Databricks (ex: databricks-llama-4-maverick) ou um modelo treinado por voce e publicado como endpoint.',
  scan_fps: 'Quantos frames por segundo serao extraidos do video para analise. Exemplo: 0.5 = 1 frame a cada 2 segundos. Valores maiores dao mais precisao mas custam mais tokens.',
  confidence_threshold: 'Nivel minimo de certeza (0 a 1) para considerar uma deteccao valida. Se a IA detectar um objeto com confianca abaixo desse valor, ele sera ignorado. Valor recomendado: 0.5 a 0.7.',
  dedup_position_threshold: 'Distancia maxima (em % do frame) para considerar que duas deteccoes em frames diferentes sao o mesmo objeto. Valores menores = mais sensivel (pode contar duplicado). Valores maiores = mais agressivo na dedup.',
  anomaly_std_threshold: 'Quantos desvios padrao acima ou abaixo da media da UF para gerar um alerta de anomalia. Exemplo: 1.5 = alerta se a loja tiver 1.5x mais ou menos objetos que a media.',
  timezone: 'Fuso horario usado para datas e horarios no sistema.',
};

function Settings() {
  const [configs, setConfigs] = useState([]);
  const [branding, setBranding] = useState({});
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [msg, setMsg] = useState('');
  const [showHelp, setShowHelp] = useState(null);

  // Contexts state
  const [contexts, setContexts] = useState([]);
  const [expandedCtx, setExpandedCtx] = useState(null);
  const [ctxObjectTypes, setCtxObjectTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [showAddCtx, setShowAddCtx] = useState(false);
  const [newCtx, setNewCtx] = useState({ name: '', display_name: '', description: '', icon: '🎯' });
  const [showAddType, setShowAddType] = useState(false);
  const [newType, setNewType] = useState({ name: '', display_name: '', description: '', color: '#666666' });
  const [editType, setEditType] = useState(null);

  useEffect(() => {
    fetchConfigs().then(setConfigs).catch(() => {});
    fetchBranding().then(setBranding).catch(() => {});
    fetchContexts().then(ctxs => setContexts(Array.isArray(ctxs) ? ctxs : [])).catch(() => {});
  }, []);

  async function saveConfig(key) {
    await updateConfig(key, editVal);
    setConfigs(c => c.map(x => x.config_key === key ? { ...x, config_value: editVal } : x));
    setEditKey(null);
    flash(`Configuracao "${key}" atualizada!`);
  }

  async function saveBranding(key, val) {
    await updateBranding(key, val);
    setBranding(b => ({ ...b, [key]: val }));
    flash('Branding atualizado!');
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadLogo(file);
    flash('Logo atualizado!');
  }

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  // Context CRUD
  async function handleAddContext() {
    if (!newCtx.name) return;
    try {
      await createContext({
        name: newCtx.name.toUpperCase().replace(/\s+/g, '_'),
        display_name: newCtx.display_name || newCtx.name,
        description: newCtx.description,
        icon: newCtx.icon,
      });
      const updated = await fetchContexts();
      setContexts(Array.isArray(updated) ? updated : []);
      setNewCtx({ name: '', display_name: '', description: '', icon: '🎯' });
      setShowAddCtx(false);
      flash('Contexto criado!');
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleDeleteContext(ctxId) {
    if (!confirm('Excluir este contexto e todos os tipos associados?')) return;
    try {
      await deleteContextApi(ctxId);
      setContexts(c => c.filter(x => (x.context_id || x.id) !== ctxId));
      if (expandedCtx === ctxId) { setExpandedCtx(null); setCtxObjectTypes([]); }
      flash('Contexto excluido!');
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleExpandContext(ctxId) {
    if (expandedCtx === ctxId) { setExpandedCtx(null); setCtxObjectTypes([]); return; }
    setExpandedCtx(ctxId);
    setLoadingTypes(true);
    setShowAddType(false);
    setEditType(null);
    try {
      const types = await fetchContextObjectTypes(ctxId);
      setCtxObjectTypes(Array.isArray(types) ? types : []);
    } catch (e) { setCtxObjectTypes([]); }
    setLoadingTypes(false);
  }

  async function handleAddObjectType() {
    if (!newType.name || !expandedCtx) return;
    try {
      await createContextObjectType(expandedCtx, {
        name: newType.name.toUpperCase().replace(/\s+/g, '_'),
        display_name: newType.display_name || newType.name,
        description: newType.description,
        color: newType.color,
      });
      const updated = await fetchContextObjectTypes(expandedCtx);
      setCtxObjectTypes(Array.isArray(updated) ? updated : []);
      setNewType({ name: '', display_name: '', description: '', color: '#666666' });
      setShowAddType(false);
      flash('Tipo de objeto criado!');
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleUpdateObjectType(name) {
    if (!expandedCtx) return;
    try {
      await updateContextObjectType(expandedCtx, name, editType);
      const updated = await fetchContextObjectTypes(expandedCtx);
      setCtxObjectTypes(Array.isArray(updated) ? updated : []);
      setEditType(null);
      flash(`Tipo "${name}" atualizado!`);
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleDeleteObjectType(name) {
    if (!confirm(`Excluir o tipo "${name}"?`)) return;
    if (!expandedCtx) return;
    try {
      await deleteContextObjectType(expandedCtx, name);
      setCtxObjectTypes(t => t.filter(x => x.name !== name));
      flash(`Tipo "${name}" excluido!`);
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  const CONFIG_LABELS = {
    scan_fps: 'Frames/segundo para analise',
    confidence_threshold: 'Confianca minima (0-1)',
    dedup_position_threshold: 'Distancia dedup (%)',
    anomaly_std_threshold: 'Desvios padrao para anomalia',
    timezone: 'Timezone',
  };

  // Filter out configs managed by Upload wizard
  const otherConfigs = configs.filter(c => !['fmapi_model', 'detection_mode'].includes(c.config_key));

  const CONTEXT_ICONS = ['🏪','🔧','🚗','📦','🏭','🏗️','🛒','🔬','🏥','📷','🎯','🔍'];

  return (
    <div className="page">
      <div className="page-header"><h1>Configuracoes</h1></div>

      {msg && <div className="toast">{msg}</div>}

      {/* Contexts & Object Types */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Contextos & Tipos de Objetos</h3>
          <button className="btn btn-primary" onClick={() => setShowAddCtx(!showAddCtx)}>
            {showAddCtx ? 'Cancelar' : '+ Novo Contexto'}
          </button>
        </div>

        {showAddCtx && (
          <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Icone</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {CONTEXT_ICONS.map(icon => (
                    <span key={icon} onClick={() => setNewCtx({ ...newCtx, icon })}
                      style={{ fontSize: 20, cursor: 'pointer', padding: '2px 6px', borderRadius: 6,
                        border: newCtx.icon === icon ? '2px solid var(--app-primary)' : '1px solid #E5E7EB',
                        background: newCtx.icon === icon ? '#FFF1F2' : '#fff',
                      }}>{icon}</span>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Codigo</label>
                <input className="inline-input" placeholder="EX: SEGURANCA" value={newCtx.name}
                  onChange={e => setNewCtx({ ...newCtx, name: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome</label>
                <input className="inline-input" placeholder="Equipamentos de Seguranca" value={newCtx.display_name}
                  onChange={e => setNewCtx({ ...newCtx, display_name: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descricao</label>
                <input className="inline-input" placeholder="O que detectar neste contexto" value={newCtx.description}
                  onChange={e => setNewCtx({ ...newCtx, description: e.target.value })} style={{ width: '100%' }} />
              </div>
              <button className="btn btn-sm btn-primary" onClick={handleAddContext} disabled={!newCtx.name}>Salvar</button>
            </div>
          </div>
        )}

        {contexts.length === 0 ? (
          <div className="empty-state">Nenhum contexto criado. Clique em "+ Novo Contexto" para comecar.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contexts.map(ctx => {
              const ctxId = ctx.context_id || ctx.id;
              const isExpanded = expandedCtx === ctxId;
              return (
                <div key={ctxId} style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Context header */}
                  <div
                    onClick={() => handleExpandContext(ctxId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
                      background: isExpanded ? '#F9FAFB' : '#fff',
                    }}
                  >
                    <span style={{ fontSize: 24 }}>{ctx.icon || '🎯'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{ctx.display_name || ctx.name}</div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>{ctx.description || ''}</div>
                    </div>
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>{isExpanded ? '▼' : '▶'}</span>
                    <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDeleteContext(ctxId); }}>
                      Excluir
                    </button>
                  </div>

                  {/* Object types (expanded) */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 16px', background: '#F9FAFB' }}>
                      {loadingTypes ? (
                        <div className="empty-state">Carregando tipos...</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 8px' }}>
                            <h4 style={{ margin: 0, fontSize: 13 }}>Tipos de Objeto</h4>
                            <button className="btn btn-sm btn-primary" onClick={() => setShowAddType(!showAddType)}>
                              {showAddType ? 'Cancelar' : '+ Novo Tipo'}
                            </button>
                          </div>

                          {showAddType && (
                            <div className="ft-add-row" style={{ marginBottom: 12 }}>
                              <input className="inline-input" placeholder="CODIGO (ex: CAMERA)" value={newType.name}
                                onChange={e => setNewType({ ...newType, name: e.target.value.toUpperCase().replace(/\s/g, '_') })} />
                              <input className="inline-input" placeholder="Nome exibicao" value={newType.display_name}
                                onChange={e => setNewType({ ...newType, display_name: e.target.value })} />
                              <input className="inline-input" placeholder="Descricao para a IA" value={newType.description}
                                onChange={e => setNewType({ ...newType, description: e.target.value })} style={{ flex: 2 }} />
                              <input type="color" value={newType.color} onChange={e => setNewType({ ...newType, color: e.target.value })} />
                              <button className="btn btn-sm btn-primary" onClick={handleAddObjectType}>Salvar</button>
                            </div>
                          )}

                          <table className="data-table">
                            <thead><tr><th>Cor</th><th>Codigo</th><th>Nome Exibicao</th><th>Descricao (usada no prompt IA)</th><th></th></tr></thead>
                            <tbody>
                              {ctxObjectTypes.map(ft => {
                                const isEditing = editType && editType._name === ft.name;
                                return (
                                  <tr key={ft.name}>
                                    <td>
                                      {isEditing ? (
                                        <input type="color" value={editType.color || '#666'} onChange={e => setEditType({ ...editType, color: e.target.value })} />
                                      ) : (
                                        <span className="ft-color-dot" style={{ background: ft.color || '#666' }} />
                                      )}
                                    </td>
                                    <td><code>{ft.name}</code></td>
                                    <td>
                                      {isEditing ? (
                                        <input className="inline-input" value={editType.display_name} onChange={e => setEditType({ ...editType, display_name: e.target.value })} />
                                      ) : ft.display_name}
                                    </td>
                                    <td>
                                      {isEditing ? (
                                        <input className="inline-input" value={editType.description || ''} style={{ width: '100%' }}
                                          onChange={e => setEditType({ ...editType, description: e.target.value })} />
                                      ) : <span className="desc-cell">{ft.description || '-'}</span>}
                                    </td>
                                    <td>
                                      {isEditing ? (
                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <button className="btn btn-sm btn-primary" onClick={() => handleUpdateObjectType(ft.name)}>Salvar</button>
                                          <button className="btn btn-sm" onClick={() => setEditType(null)}>Cancelar</button>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <button className="btn btn-sm" onClick={() => setEditType({ _name: ft.name, name: ft.name, display_name: ft.display_name, description: ft.description || '', color: ft.color || '#666' })}>Editar</button>
                                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteObjectType(ft.name)}>Excluir</button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {ctxObjectTypes.length === 0 && (
                            <div className="empty-state" style={{ padding: '12px 0' }}>Nenhum tipo de objeto. Clique em "+ Novo Tipo" para adicionar.</div>
                          )}
                        </>
                      )}
                      <p style={{ fontSize: 11, color: '#999', marginTop: 12 }}>
                        A descricao de cada tipo e enviada ao modelo de IA para orientar a deteccao. Seja especifico.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Analysis Config */}
      <div className="card">
        <h3>Parametros de Analise</h3>
        <table className="data-table">
          <thead><tr><th>Parametro</th><th>Valor</th><th>Descricao</th><th></th></tr></thead>
          <tbody>
            {otherConfigs.map(c => (
              <tr key={c.config_key}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong>{CONFIG_LABELS[c.config_key] || c.config_key}</strong>
                    {CONFIG_HELP[c.config_key] && (
                      <InfoIcon text={CONFIG_HELP[c.config_key]} show={showHelp === c.config_key}
                        onToggle={() => setShowHelp(showHelp === c.config_key ? null : c.config_key)} />
                    )}
                  </div>
                </td>
                <td>
                  {editKey === c.config_key ? (
                    <input className="inline-input" value={editVal} onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveConfig(c.config_key)} />
                  ) : <code>{c.config_value}</code>}
                </td>
                <td className="desc-cell">{c.description || '-'}</td>
                <td>
                  {editKey === c.config_key ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => saveConfig(c.config_key)}>Salvar</button>
                      <button className="btn btn-sm" onClick={() => setEditKey(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm" onClick={() => { setEditKey(c.config_key); setEditVal(c.config_value); }}>Editar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Branding */}
      <div className="card">
        <h3>Branding</h3>
        <div className="branding-grid">
          {['primary_color', 'secondary_color', 'accent_color', 'sidebar_color', 'header_bg_color'].map(key => (
            <div key={key} className="color-picker-row">
              <label>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
              <input type="color" value={branding[key] || '#000000'} onChange={e => saveBranding(key, e.target.value)} />
              <code>{branding[key]}</code>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Upload Logo <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogo} />
          </label>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card" style={{ borderTop: '3px solid #EF4444' }}>
        <h3>Zona de Perigo</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Apagar todos os dados de analise. Configuracoes, branding e tipos serao mantidos.
        </p>
        <button className="btn btn-danger" style={{ padding: '10px 24px', fontSize: 14 }}
          onClick={async () => {
            if (!confirm('Tem certeza? Acao irreversivel.')) return;
            if (!confirm('ULTIMA CONFIRMACAO: Continuar?')) return;
            try { await clearAllData(); flash('Base limpa!'); } catch (e) { flash(`Erro: ${e.message}`); }
          }}>
          Limpar toda a base
        </button>
      </div>
    </div>
  );
}


function InfoIcon({ text, show, onToggle }) {
  return (
    <span className="info-icon-wrapper">
      <span className="info-icon" onClick={onToggle} onMouseEnter={onToggle} onMouseLeave={() => show && onToggle()}>i</span>
      {show && <div className="info-tooltip">{text}</div>}
    </span>
  );
}


export default Settings;
