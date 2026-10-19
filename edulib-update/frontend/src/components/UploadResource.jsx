import { useRef, useState } from 'react';
import { uploadResource } from '../api/resources';

const ACCEPT = '.pdf,.pptx,.docx,.txt,.md,.mp4,.mov,.webm,.mkv';
const MAX_MB = 100;

export default function UploadResource({ onUploaded, onClose }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [visibility, setVisibility] = useState('private');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [jobs, setJobs] = useState([]);

  const patchJob = (id, data) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...data } : j)));

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      if (file.size > MAX_MB * 1024 * 1024) {
        setJobs((p) => [...p, { id, name: file.name, status: 'error', error: `Larger than ${MAX_MB} MB` }]);
        continue;
      }
      setJobs((p) => [...p, { id, name: file.name, progress: 0, status: 'uploading' }]);
      try {
        const result = await uploadResource(
          file, visibility,
          (pct) => patchJob(id, { progress: pct, status: pct === 100 ? 'analysing' : 'uploading' }),
          { author: author.trim(), description: description.trim() });
        patchJob(id, { status: 'done', result });
        onUploaded?.(result);
      } catch (err) {
        patchJob(id, { status: 'error', error: err.message });
      }
    }
  }

  return (
    <div className="card mb-4 border-primary">
      <div className="card-header d-flex justify-content-between align-items-center">
        <strong>Add to the library</strong>
        <button className="btn-close" aria-label="Close" onClick={onClose} />
      </div>
      <div className="card-body">
        <div className="row g-2 mb-3">
          <div className="col-md-4">
            <input className="form-control form-control-sm" placeholder="Author (optional, detected if blank)"
                   value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="col-md-8">
            <input className="form-control form-control-sm" placeholder="Short description (optional)"
                   value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div
          className={`border border-2 rounded p-4 text-center ${dragging ? 'border-primary bg-light' : 'border-secondary-subtle'}`}
          style={{ borderStyle: 'dashed', cursor: 'pointer' }}
          onClick={() => inputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        >
          <p className="mb-1 fw-semibold">Drag books and notes here, or click to browse</p>
          <small className="text-muted">PDF, PPTX, DOCX, TXT, MD, MP4/WEBM/MOV/MKV, up to {MAX_MB} MB. The same author and description apply to every file in this batch.</small>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
                 onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="form-check mt-3">
          <input id="share" className="form-check-input" type="checkbox"
                 checked={visibility === 'public'}
                 onChange={(e) => setVisibility(e.target.checked ? 'public' : 'private')} />
          <label htmlFor="share" className="form-check-label">Share with other students</label>
        </div>

        {jobs.map((j) => (
          <div key={j.id} className="mt-3 small">
            <div className="d-flex justify-content-between">
              <span className="text-truncate">{j.name}</span>
              <span className="text-muted">
                {j.status === 'uploading' && `${j.progress}%`}
                {j.status === 'analysing' && 'Reading and categorising...'}
                {j.status === 'done' && 'Done'}
              </span>
            </div>
            {(j.status === 'uploading' || j.status === 'analysing') && (
              <div className="progress" style={{ height: 6 }}>
                <div className={`progress-bar ${j.status === 'analysing' ? 'progress-bar-striped progress-bar-animated' : ''}`}
                     style={{ width: `${j.progress}%` }} />
              </div>
            )}
            {j.status === 'error' && <div className="text-danger">{j.error}</div>}
            {j.status === 'done' && (
              <div className="text-muted">
                Filed under <strong>{j.result.course_code ? `${j.result.course_code} ` : ''}{j.result.subject}</strong>
                {j.result.author ? ` · by ${j.result.author}` : ''}
                {j.result.extraction_status === 'failed' && ' (analysis failed, you can retry from the library)'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
