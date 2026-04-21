import React, { useState, useEffect } from 'react';
import { fetchConfigs, updateConfig, fetchBranding, updateBranding, uploadLogo, clearAllData, fetchConfigFixtureTypes, createFixtureType, updateFixtureType, deleteFixtureType } from '../api';

const CONFIG_HELP = {
  fmapi_model: 'O nome do Serving Endpoint que sera usado para analisar os frames do video. Pode ser um modelo padrao da Databricks (ex: databricks-llama-4-maverick) ou um modelo treinado por voce e publicado como endpoint.',
  scan_fps: 'Quantos frames por segundo serao extraidos do video para analise. Exemplo: 0.5 = 1 frame a cada 2 segundos. Valores maiores dao mais precisao mas custam mais tokens.',
  confidence_threshold: 'Nivel minimo de certeza (0 a 1) para considerar uma deteccao valida. Se a IA detectar um expositor com confianca abaixo desse valor, ele sera ignorado. Valor recomendado: 0.5 a 0.7.',
  dedup_position_threshold: 'Distancia maxima (em % do frame) para considerar que duas deteccoes em frames diferentes sao o mesmo expositor. Valores menores = mais sensivel (pode contar duplicado). Valores maiores = mais agressivo na dedup.',
  anomaly_std_threshold: 'Quantos desvios padrao acima ou abaixo da media da UF para gerar um alerta de anomalia. Exemplo: 1.5 = alerta se a loja tiver 1.5x mais ou menos expositores que a media.',
  timezone: 'Fuso horario usado para datas e horarios no sistema.',
};

function Settings() {
  const [configs, setConfigs] = useState([]);
  const [branding, setBranding] = useState({});
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [msg, setMsg] = useState('');
  const [fixtureTypes, setFixtureTypes] = useState([]);
  const [editFT, setEditFT] = useState(null);
  const [newFT, setNewFT] = useState({ name: '', display_name: '', description: '', color: '#666666' });
  const [showAddFT, setShowAddFT] = useState(false);
  const [showHelp, setShowHelp] = useState(null);

  useEffect(() => {
    fetchConfigs().then(setConfigs).catch(() => {});
    fetchBranding().then(setBranding).catch(() => {});
    fetchConfigFixtureTypes().then(setFixtureTypes).catch(() => {});
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

  async function handleAddFT() {
    if (!newFT.name || !newFT.display_name) return;
    try {
      await createFixtureType(newFT);
      const updated = await fetchConfigFixtureTypes();
      setFixtureTypes(updated);
      setNewFT({ name: '', display_name: '', description: '', color: '#666666' });
      setShowAddFT(false);
      flash(`Tipo "${newFT.name}" criado!`);
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleUpdateFT(name) {
    try {
      await updateFixtureType(name, editFT);
      const updated = await fetchConfigFixtureTypes();
      setFixtureTypes(updated);
      setEditFT(null);
      flash(`Tipo "${name}" atualizado!`);
    } catch (e) { flash(`Erro: ${e.message}`); }
  }

  async function handleDeleteFT(name) {
    if (!confirm(`Excluir o tipo "${name}"?`)) return;
    await deleteFixtureType(name);
    setFixtureTypes(ft => ft.filter(t => t.name !== name));
    flash(`Tipo "${name}" excluido!`);
  }

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  const CONFIG_LABELS = {
    scan_fps: 'Frames/segundo para analise',
    confidence_threshold: 'Confianca minima (0-1)',
    dedup_position_threshold: 'Distancia dedup (%)',
    anomaly_std_threshold: 'Desvios padrao para anomalia',
    timezone: 'Timezone',
  };

  // Filter out configs managed by Upload wizard
  const otherConfigs = configs.filter(c => !['fmapi_model', 'detection_mode'].includes(c.config_key));

  return (
    <div className="page">
      <div className="page-header"><h1>Configuracoes</h1></div>

      {msg && <div className="toast">{msg}</div>}

      {/* Fixture Types */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Tipos de Expositores</h3>
          <button className="btn btn-primary" onClick={() => setShowAddFT(!showAddFT)}>
            {showAddFT ? 'Cancelar' : '+ Novo Tipo'}
          </button>
        </div>

        {showAddFT && (
          <div className="ft-add-row">
            <input className="inline-input" placeholder="NOME (ex: VITRINE)" value={newFT.name}
              onChange={e => setNewFT({ ...newFT, name: e.target.value.toUpperCase().replace(/\s/g, '_') })} />
            <input className="inline-input" placeholder="Nome exibicao" value={newFT.display_name}
              onChange={e => setNewFT({ ...newFT, display_name: e.target.value })} />
            <input className="inline-input" placeholder="Descricao para a IA" value={newFT.description}
              onChange={e => setNewFT({ ...newFT, description: e.target.value })} style={{ flex: 2 }} />
            <input type="color" value={newFT.color} onChange={e => setNewFT({ ...newFT, color: e.target.value })} />
            <button className="btn btn-sm btn-primary" onClick={handleAddFT}>Salvar</button>
          </div>
        )}

        <table className="data-table">
          <thead><tr><th>Cor</th><th>Codigo</th><th>Nome Exibicao</th><th>Descricao (usada no prompt IA)</th><th></th></tr></thead>
          <tbody>
            {fixtureTypes.map(ft => {
              const isEditing = editFT && editFT._name === ft.name;
              return (
                <tr key={ft.name}>
                  <td>
                    {isEditing ? (
                      <input type="color" value={editFT.color || '#666'} onChange={e => setEditFT({ ...editFT, color: e.target.value })} />
                    ) : (
                      <span className="ft-color-dot" style={{ background: ft.color || '#666' }} />
                    )}
                  </td>
                  <td><code>{ft.name}</code></td>
                  <td>
                    {isEditing ? (
                      <input className="inline-input" value={editFT.display_name} onChange={e => setEditFT({ ...editFT, display_name: e.target.value })} />
                    ) : ft.display_name}
                  </td>
                  <td>
                    {isEditing ? (
                      <input className="inline-input" value={editFT.description || ''} style={{ width: '100%' }}
                        onChange={e => setEditFT({ ...editFT, description: e.target.value })} />
                    ) : <span className="desc-cell">{ft.description || '-'}</span>}
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleUpdateFT(ft.name)}>Salvar</button>
                        <button className="btn btn-sm" onClick={() => setEditFT(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setEditFT({ _name: ft.name, name: ft.name, display_name: ft.display_name, description: ft.description || '', color: ft.color || '#666' })}>Editar</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteFT(ft.name)}>Excluir</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#999', marginTop: 12 }}>
          A descricao de cada tipo e enviada ao modelo de IA para orientar a deteccao. Seja especifico.
        </p>
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
