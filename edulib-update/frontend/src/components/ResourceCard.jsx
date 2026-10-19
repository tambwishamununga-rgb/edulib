import { useState } from 'react';
import { deleteResource, downloadResource, reanalyzeResource, updateResource } from '../api/resources';
import Reader from './Reader';

const TYPE_LABEL = { pdf: 'PDF', slides: 'Slides', notes: 'Notes', video: 'Video', other: 'File' };
const COVERS = [
  ['#4f46e5', '#7c3aed'], ['#0f766e', '#14b8a6'], ['#b45309', '#f59e0b'], ['#1d4ed8', '#38bdf8'],
  ['#be123c', '#fb7185'], ['#4d7c0f', '#a3e635'], ['#6d28d9', '#c084fc'], ['#334155', '#94a3b8'],
];
// The same course always gets the same cover colour, so shelves read at a glance.
const coverFor = (key = '') => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = COVERS[h % COVERS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
};
const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const clamp = (lines) => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' });

export default function ResourceCard({ resource, subjects = [], currentUserId, onChanged, onDeleted, compact = false, reason }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: resource.title, author: resource.author || '', description: resource.description || '' });
  const mine = resource.user_id === currentUserId;

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const save = () => run(async () => { onChanged(await updateResource(resource.id, form)); setEditing(false); });

  return (
    <div className="card h-100 shadow-sm">
      <div className="d-flex flex-column justify-content-between text-white p-3"
           style={{ background: coverFor(resource.subject), minHeight: compact ? 90 : 120, borderRadius: '6px 6px 0 0' }}>
        <div className="d-flex justify-content-between">
          <span className="badge text-bg-light">{TYPE_LABEL[resource.resource_type]}</span>
          {resource.visibility === 'public' && <span className="badge bg-dark bg-opacity-50">Shared</span>}
        </div>
        <div className="fw-bold">{resource.course_code || resource.subject}</div>
      </div>

      <div className="card-body d-flex flex-column">
        {editing ? (
          <div className="mb-2">
            <input className="form-control form-control-sm mb-1" placeholder="Title" value={form.title}
                   onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="form-control form-control-sm mb-1" placeholder="Author" value={form.author}
                   onChange={(e) => setForm({ ...form, author: e.target.value })} />
            <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Description" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button className="btn btn-success btn-sm me-1" disabled={busy || !form.title.trim()} onClick={save}>Save</button>
            <button className="btn btn-light btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <h6 className="card-title mb-1" style={clamp(2)}>{resource.title}</h6>
            <div className="small text-muted mb-1">
              {resource.author ? `by ${resource.author}` : 'Author unknown'}
              {resource.page_count ? ` · ${resource.page_count} ${resource.resource_type === 'slides' ? 'slides' : 'pages'}` : ''}
              {!compact && ` · ${fmtSize(Number(resource.size_bytes))}`}
            </div>
            {compact && <div className="small text-muted mb-1" style={clamp(1)}>{resource.subject}</div>}
            {reason && <div className="small text-primary fst-italic mb-1" style={clamp(2)}>{reason}</div>}
            {!compact && (resource.description || resource.summary) && (
              <p className="small mb-2" style={clamp(3)} title={resource.description || resource.summary}>
                {resource.description || resource.summary}
              </p>
            )}
            {!compact && (
              <div className="mb-2">
                {resource.keywords?.slice(0, 4).map((k) => (
                  <span key={k} className="badge rounded-pill text-bg-light border me-1 mb-1">{k}</span>
                ))}
              </div>
            )}
          </>
        )}

        {!compact && resource.extraction_status === 'failed' && (
          <div className="alert alert-warning py-1 small">
            Analysis failed.{' '}
            {mine && <button className="btn btn-link btn-sm p-0" disabled={busy}
              onClick={() => run(async () => onChanged(await reanalyzeResource(resource.id)))}>Retry</button>}
          </div>
        )}
        {!compact && resource.extraction_status === 'no_text' && (
          <div className="alert alert-secondary py-1 small">No readable text found (scanned file?).</div>
        )}

        {!compact && mine && !editing && (
          <select className="form-select form-select-sm mb-2" disabled={busy} value={resource.subject}
                  onChange={(e) => run(async () => onChanged(await updateResource(resource.id, { subject: e.target.value })))}>
            {subjects.map((s) => (
              <option key={s.title} value={s.title}>{s.code ? `${s.code} ${s.title}` : s.title}</option>
            ))}
          </select>
        )}
        {error && <div className="text-danger small">{error}</div>}

        <div className="mt-auto d-flex gap-2">
          <button className="btn btn-primary btn-sm flex-grow-1" onClick={() => setReading(true)}>Read</button>
          {!compact && (
            <button className="btn btn-outline-secondary btn-sm" disabled={busy}
                    onClick={() => run(() => downloadResource(resource.id))}>Download</button>
          )}
          {!compact && mine && !editing && (
            <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
          )}
          {!compact && mine && (
            <button className="btn btn-outline-danger btn-sm" disabled={busy}
                    onClick={() => window.confirm('Delete this resource?') &&
                      run(async () => { await deleteResource(resource.id); onDeleted(resource.id); })}>
              Delete
            </button>
          )}
        </div>
      </div>

      {reading && <Reader resource={resource} onClose={() => { setReading(false); }} />}
    </div>
  );
}
