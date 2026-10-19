import { useEffect, useState } from 'react';
import { absoluteUrl, downloadResource, getRelated, getViewLink } from '../api/resources';

const OFFICE = { '.pptx': 'PowerPoint', '.docx': 'Word' };

export default function Reader({ resource, onClose }) {
  const [current, setCurrent] = useState(resource);   // changes when a related book is chosen
  const [link, setLink] = useState(null);
  const [related, setRelated] = useState([]);
  const [error, setError] = useState('');

  // Opening a resource also logs a "view", which is what the recommender learns from.
  useEffect(() => {
    setLink(null); setError('');
    getViewLink(current.id).then(setLink).catch((e) => setError(e.message));
    getRelated(current.id).then((r) => setRelated(r.items)).catch(() => setRelated([]));
  }, [current.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = link ? absoluteUrl(link.url) : null;
  const isVideo = link && ['.mp4', '.webm'].includes(link.ext);

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.6)', overflowY: 'auto' }} onClick={onClose}>
      <div className="modal-dialog modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <div className="me-3" style={{ minWidth: 0 }}>
              <h6 className="modal-title text-truncate mb-0">{current.title}</h6>
              <small className="text-muted">
                {current.author ? `by ${current.author} · ` : ''}{current.course_code ? `${current.course_code} ` : ''}{current.subject}
              </small>
            </div>
            <div className="d-flex gap-2 ms-auto">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => downloadResource(current.id)}>Download</button>
              <button className="btn btn-close" aria-label="Close" onClick={onClose} />
            </div>
          </div>

          <div className="modal-body p-0">
            {error && <div className="alert alert-danger m-3">{error}</div>}
            {!link && !error && <p className="p-4 mb-0">Loading...</p>}
            {link && link.inline && !isVideo && (
              <iframe title={current.title} src={url} style={{ width: '100%', height: '65vh', border: 0 }} />
            )}
            {link && link.inline && isVideo && (
              <video controls src={url} style={{ width: '100%', maxHeight: '65vh', background: '#000' }} />
            )}
            {link && !link.inline && (
              <div className="p-4 text-center">
                <p className="mb-2">Browsers cannot display {OFFICE[link.ext] || 'this type of'} files directly.</p>
                <p className="text-muted small mb-3">Download it to open in {OFFICE[link.ext] || 'the matching app'}.</p>
                <button className="btn btn-primary" onClick={() => downloadResource(current.id)}>Download file</button>
              </div>
            )}
          </div>

          <div className="modal-footer d-block">
            {(current.summary || current.description) && (
              <div className="mb-3">
                <div className="small fw-semibold">{current.description ? 'Description' : 'Auto summary'}</div>
                <div className="small text-muted">{current.description || current.summary}</div>
              </div>
            )}
            {related.length > 0 && (
              <div>
                <div className="small fw-semibold mb-2">More like this</div>
                <div className="d-flex flex-wrap gap-2">
                  {related.map((r) => (
                    <button key={r.id} className="btn btn-outline-primary btn-sm text-start" onClick={() => setCurrent(r)}>
                      {r.title}<br /><small className="text-muted">{r.reason}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
