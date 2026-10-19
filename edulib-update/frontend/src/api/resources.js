// API client for the resource endpoints. The JWT comes from the login flow (Objective 1).
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api/resources${path}`, {
    ...options,
    headers: { ...authHeader(), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const listResources = (params) =>
  request(`?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`);
export const getFacets = () => request('/facets');
export const getSubjects = () => request('/subjects');
export const updateResource = (id, data) =>
  request(`/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const reanalyzeResource = (id) => request(`/${id}/reanalyze`, { method: 'POST' });
export const deleteResource = (id) => request(`/${id}`, { method: 'DELETE' });
export const getViewLink = (id, purpose = 'view') =>
  request(`/${id}/view-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose }) });
export const getRecommended = () => request('/recommended');
export const getRecent = () => request('/recent');
export const getRelated = (id) => request(`/${id}/related`);
export const absoluteUrl = (path) => `${BASE}${path}`;

// Starts a browser download via a short-lived signed link.
export async function downloadResource(id) {
  const { url } = await getViewLink(id, 'download');
  const a = document.createElement('a');
  a.href = `${BASE}${url}&dl=1`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// fetch() cannot report upload progress, so uploads use XMLHttpRequest.
export function uploadResource(file, visibility, onProgress, extra = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('visibility', visibility);
    if (extra.author) form.append('author', extra.author);
    if (extra.description) form.append('description', extra.description);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/resources`);
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error */ }
      xhr.status >= 200 && xhr.status < 300 ? resolve(body) : reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  });
}
