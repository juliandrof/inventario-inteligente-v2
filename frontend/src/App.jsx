import React, { useState, useCallback, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Upload from './pages/VideoUpload';
import VideoList from './pages/VideoList';
import PhotoList from './pages/PhotoList';
import FixtureView from './pages/FixtureView';
import Reports from './pages/Reports';
import Review from './pages/Review';
import Training from './pages/Training';
import Settings from './pages/Settings';
import { fetchBranding } from './api';

const PAGE_KEYS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'chart' },
  { key: 'upload', label: 'Upload', icon: 'upload' },
  { key: 'videos', label: 'Videos', icon: 'list' },
  { key: 'photos', label: 'Fotos', icon: 'photo' },
  { key: 'fixtures', label: 'Expositores', icon: 'fixture' },
  { key: 'review', label: 'Revisao IA', icon: 'review' },
  { key: 'training', label: 'Treinamento IA', icon: 'training' },
  { key: 'reports', label: 'Relatorios', icon: 'report' },
  { key: 'settings', label: 'Configuracoes', icon: 'config' },
];

const PAGE_COMPONENTS = {
  dashboard: Dashboard, upload: Upload, videos: VideoList, photos: PhotoList,
  fixtures: FixtureView, review: Review, training: Training, reports: Reports, settings: Settings,
};

const ICONS = {
  chart: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="10" width="3" height="8" rx="1" fill="currentColor"/><rect x="7" y="6" width="3" height="12" rx="1" fill="currentColor"/><rect x="12" y="3" width="3" height="15" rx="1" fill="currentColor"/></svg>,
  upload: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M10 3l-4 4M10 3l4 4M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  list: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor" opacity="0.8"/><rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor" opacity="0.6"/><rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor" opacity="0.4"/></svg>,
  photo: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="7" cy="8" r="2" fill="currentColor"/><path d="M2 14l4-4 3 3 4-5 5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  fixture: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="2" rx="0.5" fill="currentColor"/><rect x="2" y="9" width="16" height="2" rx="0.5" fill="currentColor"/><rect x="2" y="14" width="16" height="2" rx="0.5" fill="currentColor"/><rect x="3" y="4" width="2" height="12" fill="currentColor" opacity="0.5"/><rect x="15" y="4" width="2" height="12" fill="currentColor" opacity="0.5"/></svg>,
  review: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2"/><path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7 9h4M9 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  training: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 16l4-6 3 4 4-8 5 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="15" cy="5" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M15 3.5v3M13.5 5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>,
  report: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 2h8l4 4v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/><path d="M6 10h8M6 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  config: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.5 3.5l2.1 2.1M14.4 14.4l2.1 2.1M3.5 16.5l2.1-2.1M14.4 5.6l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
};

const DEFAULT_COLORS = { primary_color: '#E11D48', secondary_color: '#1E293B', accent_color: '#F43F5E', sidebar_color: '#0F172A', header_bg_color: '#E11D48' };

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pageParams, setPageParams] = useState({});
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [customLogo, setCustomLogo] = useState(null);

  useEffect(() => {
    fetchBranding().then(b => {
      const c = { ...DEFAULT_COLORS };
      Object.keys(DEFAULT_COLORS).forEach(k => { if (b[k]) c[k] = b[k]; });
      setColors(c);
      if (b.logo_path) setCustomLogo(b.logo_path);
    }).catch(() => {});
  }, []);

  const [pageKey, setPageKey] = useState(0);
  const navigate = useCallback((page, params = {}) => {
    setCurrentPage(page);
    setPageParams(params);
    if (Object.keys(params).length === 0) setPageKey(k => k + 1);
  }, []);

  const PageComponent = PAGE_COMPONENTS[currentPage] || Dashboard;

  return (
    <div className="app-layout" style={{
      '--app-primary': colors.primary_color, '--app-dark': colors.secondary_color,
      '--app-accent': colors.accent_color, '--app-sidebar': colors.sidebar_color,
      '--app-header-bg': colors.header_bg_color,
    }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            {customLogo ? <img src="/api/branding/logo" alt="Logo" className="custom-logo" /> : <AppLogo />}
          </div>
          <div className="sidebar-subtitle">Inventario Inteligente de Expositores</div>
        </div>
        <nav className="sidebar-nav">
          {PAGE_KEYS.map(page => (
            <a key={page.key} href="#" className={currentPage === page.key ? 'active' : ''}
              onClick={e => { e.preventDefault(); navigate(page.key); }}>
              <span className="nav-icon">{ICONS[page.icon]}</span>
              <span>{page.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">Powered by Databricks Lakebase</div>
      </aside>
      <main className="main-content">
        <PageComponent key={`${currentPage}-${pageKey}`} navigate={navigate} pageParams={pageParams} />
      </main>
    </div>
  );
}

function AppLogo() {
  return (
    <svg width="180" height="40" viewBox="0 0 180 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="30" height="30" rx="6" fill="var(--app-primary, #E11D48)"/>
      <rect x="8" y="12" width="18" height="2" rx="0.5" fill="white"/>
      <rect x="8" y="17" width="18" height="2" rx="0.5" fill="white" opacity="0.8"/>
      <rect x="8" y="22" width="18" height="2" rx="0.5" fill="white" opacity="0.6"/>
      <rect x="10" y="12" width="2" height="12" fill="white" opacity="0.4"/>
      <rect x="22" y="12" width="2" height="12" fill="white" opacity="0.4"/>
      <text x="38" y="16" fontFamily="Inter, sans-serif" fontSize="9" fontWeight="600" fill="white" opacity="0.7">Inventario</text>
      <text x="38" y="30" fontFamily="Inter, sans-serif" fontSize="11" fontWeight="700" fill="white">Inteligente</text>
    </svg>
  );
}

export default App;
