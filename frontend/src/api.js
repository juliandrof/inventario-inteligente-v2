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
export const fetchRecentVideos = (f = {}) => request('/dashboard/recent' + qs(f));
export const fetchFilters = () => request('/dashboard/filters');

// Videos
export const fetchVideos = (f = {}) => request('/videos' + qs(f));
export const fetchVideo = (id) => request(`/videos/${id}`);
export const fetchVideoFixtures = (id) => request(`/videos/${id}/fixtures`);
export const fetchVideoDetections = (id) => request(`/videos/${id}/detections`);
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' });
export const reprocessVideo = (id) => request(`/videos/reprocess/${id}`, { method: 'POST' });
export const uploadVideo = async (file, contextId) => {
  const formData = new FormData();
  formData.append('file', file);
  if (contextId) formData.append('context_id', contextId);
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
export const fetchTrainingGroups = (contextId) => request('/training/groups' + (contextId ? `?context_id=${contextId}` : ''));
export const fetchGroupFrames = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/frames`);
export const deleteTrainingGroup = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}`, { method: 'DELETE' });
export const autoAnnotateGroup = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/auto-annotate-all`, { method: 'POST' });
export const autoAnnotateGroupStatus = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/auto-annotate-status`);
export const fetchActiveAutoAnnotations = () => request('/training/auto-annotate-active');
export const fetchGroupAnnotations = (sourceName) => request(`/training/groups/${encodeURIComponent(sourceName)}/all-annotations`);

// Training - Images
export const fetchTrainingImages = () => request('/training/images');
export const uploadTrainingImage = async (file, contextId, frameInterval) => {
  const formData = new FormData();
  formData.append('file', file);
  const params = [];
  if (contextId) params.push(`context_id=${contextId}`);
  if (frameInterval) params.push(`frame_interval=${frameInterval}`);
  const qs = params.length ? '?' + params.join('&') : '';
  const res = await fetch(`${BASE_URL}/training/images/upload${qs}`, { method: 'POST', body: formData });
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
export const deleteTrainingJob = (id) => request(`/training/jobs/${id}`, { method: 'DELETE' });
export const pollJobStatus = (id) => request(`/training/jobs/${id}/status`);
export const fetchTrainedModels = () => request('/training/models');
export const activateModel = (id) => request(`/training/models/${id}/activate`, { method: 'POST' });
export const publishJobModel = (jobId, ucModelName) => request(`/training/jobs/${jobId}/publish`, { method: 'POST', body: JSON.stringify({ uc_model_name: ucModelName || null }) });
export const deleteModel = (id) => request(`/training/models/${id}`, { method: 'DELETE' });
export const fetchDetectionMode = () => request('/training/detection-mode');
export const setDetectionMode = (mode) => request('/training/detection-mode', { method: 'PUT', body: JSON.stringify({ mode }) });
export const fetchTrainingStats = () => request('/training/stats');

// Training - UC Models
export const fetchUCModels = () => request('/training/uc-models');
export const activateUCModel = (modelName) => request(`/training/uc-models/${encodeURIComponent(modelName)}/activate`, { method: 'POST' });
export const deleteUCModel = (modelName) => request(`/training/uc-models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });

// Contexts
export const fetchContexts = () => request('/contexts');
export const fetchContext = (id) => request(`/contexts/${id}`);
export const createContext = (data) => request('/contexts', { method: 'POST', body: JSON.stringify(data) });
export const updateContextApi = (id, data) => request(`/contexts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteContextApi = (id) => request(`/contexts/${id}`, { method: 'DELETE' });
export const fetchContextObjectTypes = (contextId) => request(`/contexts/${contextId}/object-types`);
export const createContextObjectType = (contextId, data) => request(`/contexts/${contextId}/object-types`, { method: 'POST', body: JSON.stringify(data) });
export const updateContextObjectType = (contextId, name, data) => request(`/contexts/${contextId}/object-types/${name}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteContextObjectType = (contextId, name) => request(`/contexts/${contextId}/object-types/${name}`, { method: 'DELETE' });
