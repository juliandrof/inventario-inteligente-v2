const BASE_URL = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || `HTTP ${res.status}`);
  }
  return res.json();
}

function qs(params) {
  const s = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
}

// Dashboard
export const fetchDashboardSummary = (f = {}) => request('/dashboard/summary' + qs(f));
export const fetchDashboardByType = (f = {}) => request('/dashboard/by-type' + qs(f));
export const fetchDashboardByUF = () => request('/dashboard/by-uf');
export const fetchDashboardByStore = (f = {}) => request('/dashboard/by-store' + qs(f));
export const fetchOccupancy = (f = {}) => request('/dashboard/occupancy' + qs(f));
export const fetchAnomalies = (f = {}) => request('/dashboard/anomalies' + qs(f));
export const fetchTemporal = (storeId) => request(`/dashboard/temporal?store_id=${storeId}`);
export const fetchRecentVideos = (f = {}) => request('/dashboard/recent' + qs(f));
export const fetchFilters = () => request('/dashboard/filters');

// Videos
export const fetchVideos = (f = {}) => request('/videos' + qs(f));
export const fetchVideo = (id) => request(`/videos/${id}`);
export const fetchVideoFixtures = (id) => request(`/videos/${id}/fixtures`);
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' });
export const reprocessVideo = (id) => request(`/videos/reprocess/${id}`, { method: 'POST' });
export const uploadVideo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/videos/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
export const startBatch = (volumePath) => request(`/videos/batch?volume_path=${encodeURIComponent(volumePath)}`, { method: 'POST' });

// Analysis
export const fetchFixtures = (f = {}) => request('/analysis/fixtures' + qs(f));
export const fetchStores = (f = {}) => request('/analysis/stores' + qs(f));
export const fetchStoreDetail = (id) => request(`/analysis/stores/${id}`);
export const fetchFixtureTypes = () => request('/analysis/fixture-types');

// Review
export const fetchReviewVideos = (f = {}) => request('/review/videos' + qs(f));
export const fetchReviewFixtures = (videoId) => request(`/review/fixtures/${videoId}`);
export const fetchFixtureFrames = (videoId, trackingId) => request(`/review/fixture-frames/${videoId}/${trackingId}`);

// Fixture Types CRUD
export const fetchConfigFixtureTypes = () => request('/config/fixture-types');
export const createFixtureType = (data) => request('/config/fixture-types', { method: 'POST', body: JSON.stringify(data) });
export const updateFixtureType = (name, data) => request(`/config/fixture-types/${name}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteFixtureType = (name) => request(`/config/fixture-types/${name}`, { method: 'DELETE' });

// Reports
export const fetchReportSummary = (f = {}) => request('/reports/summary' + qs(f));
export const fetchComparison = (f = {}) => request('/reports/comparison' + qs(f));

// Config
export const fetchConfigs = () => request('/config');
export const updateConfig = (key, value, description) => request(`/config/${key}`, {
  method: 'PUT', body: JSON.stringify({ value, description }),
});
export const clearAllData = () => request('/config/clear-all', { method: 'POST' });
export const fetchServingEndpoints = () => request('/config/serving-endpoints');

// Branding
export const fetchBranding = () => request('/branding');
export const updateBranding = (key, value) => request(`/branding/${key}`, {
  method: 'PUT', body: JSON.stringify({ value }),
});
export const uploadLogo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/branding/logo`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Training - Groups (video/image sources)
export const fetchTrainingGroups = () => request('/training/groups');
export const fetchGroupFrames = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/frames`);
export const autoAnnotateGroup = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/auto-annotate-all`, { method: 'POST' });
export const autoAnnotateGroupStatus = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/auto-annotate-status`);
export const fetchGroupAnnotations = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/all-annotations`);

// Training - Images
export const fetchTrainingImages = () => request('/training/images');
export const uploadTrainingImage = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/training/images/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
export const deleteTrainingImage = (id) => request(`/training/images/${id}`, { method: 'DELETE' });
export const fetchImageAnnotations = (id) => request(`/training/images/${id}/annotations`);
export const saveAnnotations = (id, annotations) => request(`/training/images/${id}/annotations`, { method: 'POST', body: JSON.stringify({ annotations }) });
export const autoAnnotate = (id) => request(`/training/images/${id}/auto-annotate`, { method: 'POST' });
export const startTrainingJob = (params) => request('/training/jobs/start', { method: 'POST', body: JSON.stringify(params) });
export const fetchTrainingJobs = () => request('/training/jobs');
export const fetchJobDetail = (id) => request(`/training/jobs/${id}`);
export const pollJobStatus = (id) => request(`/training/jobs/${id}/status`);
export const fetchTrainedModels = () => request('/training/models');
export const activateModel = (id) => request(`/training/models/${id}/activate`, { method: 'POST' });
export const publishJobModel = (jobId) => request(`/training/jobs/${jobId}/publish`, { method: 'POST' });
export const deleteModel = (id) => request(`/training/models/${id}`, { method: 'DELETE' });
export const fetchDetectionMode = () => request('/training/detection-mode');
export const setDetectionMode = (mode) => request('/training/detection-mode', { method: 'PUT', body: JSON.stringify({ mode }) });
export const fetchTrainingStats = () => request('/training/stats');
