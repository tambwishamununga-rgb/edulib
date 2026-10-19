import { useCallback, useEffect, useState } from 'react';
import { getFacets, getRecent, getRecommended, getSubjects, listResources } from '../api/resources';
import ResourceCard from '../components/ResourceCard';
import UploadResource from '../components/UploadResource';

const TYPES = [['', 'All'], ['pdf', 'PDFs'], ['slides', 'Slides'], ['notes', 'Notes'], ['video', 'Videos']];

// A horizontally scrolling row of compact book cards.
function Shelf({ title, subtitle, items, currentUserId }) {
  if (!items.length) return null;
  return (
    <section className="mb-4">
      <h5 className="mb-0">{title}</h5>
      {subtitle && <p className="small text-muted mb-2">{subtitle}</p>}
      <div className="d-flex gap-3 overflow-auto pb-2">
        {items.map((r) => (
          <div key={r.id} style={{ minWidth: 220, maxWidth: 220 }}>
            <ResourceCard compact resource={r} reason={r.reason} currentUserId={currentUserId} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Library({ currentUserId }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ subjects: [], types: [] });
  const [subjects, setSubjects] = useState([]);
  const [recommended, setRecommended] = useState({ personalised: false, items: [] });
  const [recent, setRecent] = useState([]);
  const [filters, setFilters] = useState({ type: '', subject: '', q: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const limit = 12;

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadShelves = useCallback(() => {
    getRecommended().then((r) => setRecommended({ personalised: !!r.personalised, items: r.items || [] })).catch(() => {});
    getRecent().then((r) => setRecent(r.items || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, fct] = await Promise.all([listResources({ ...filters, page, limit }), getFacets()]);
      setItems(list.items || []); setTotal(list.total || 0);
      setFacets({ subjects: fct.subjects || [], types: fct.types || [] });
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadShelves(); }, [loadShelves]);
  useEffect(() => { getSubjects().then(setSubjects).catch(() => {}); }, []);

  const countFor = (type) => type
    ? facets.types.find((t) => t.type === type)?.count || 0
    : facets.types.reduce((n, t) => n + t.count, 0);
  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const replaceItem = (u) => { setItems((prev) => prev.map((r) => (r.id === u.id ? u : r))); getFacets().then((f) => setFacets({ subjects: f.subjects || [], types: f.types || [] })); };
  const pages = Math.max(1, Math.ceil(total / limit));
  const browsing = filters.q || filters.subject || filters.type;   // hide shelves while searching/filtering

  return (
    <div className="container-fluid py-4">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h4 className="mb-0">UNZA Digital Library</h4>
          <small className="text-muted">{countFor('')} resources, organised automatically by course</small>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload((v) => !v)}>
          {showUpload ? 'Close' : '+ Add to library'}
        </button>
      </div>

      {showUpload && (
        <UploadResource onClose={() => setShowUpload(false)}
                        onUploaded={() => { setPage(1); load(); loadShelves(); }} />
      )}

      <input className="form-control form-control-lg mb-4" placeholder="Search by title, author, keyword or course code"
             value={search} onChange={(e) => setSearch(e.target.value)} />

      {!browsing && (
        <>
          <Shelf title="Continue reading" items={recent} currentUserId={currentUserId} />
          <Shelf
            title={recommended.personalised ? 'Recommended for you' : 'New in the library'}
            subtitle={recommended.personalised
              ? 'Based on what you have read, downloaded and uploaded'
              : 'Read a few resources and this shelf will start to follow your interests'}
            items={recommended.items} currentUserId={currentUserId} />
        </>
      )}

      <div className="row">
        <div className="col-lg-9">
          <h5 className="mb-2">{browsing ? `${total} result${total === 1 ? '' : 's'}` : 'Catalogue'}</h5>
          <ul className="nav nav-pills mb-3">
            {TYPES.map(([value, label]) => (
              <li className="nav-item" key={label}>
                <button className={`nav-link ${filters.type === value ? 'active' : ''}`} onClick={() => setFilter('type', value)}>
                  {label} ({countFor(value)})
                </button>
              </li>
            ))}
          </ul>

          {error && <div className="alert alert-danger">{error}</div>}
          {loading ? <p>Loading...</p> : items.length === 0 ? (
            <p className="text-muted">Nothing here yet. Add books and notes with the button above, or clear a filter.</p>
          ) : (
            <div className="row g-3">
              {items.map((r) => (
                <div className="col-md-6 col-xl-4" key={r.id}>
                  <ResourceCard resource={r} subjects={subjects} currentUserId={currentUserId}
                                onChanged={replaceItem} onDeleted={() => { load(); loadShelves(); }} />
                </div>
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="d-flex justify-content-center align-items-center gap-3 mt-4">
              <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="small">Page {page} of {pages}</span>
              <button className="btn btn-outline-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>

        <div className="col-lg-3">
          <div className="card">
            <div className="card-header">Courses</div>
            <div className="list-group list-group-flush">
              <button className={`list-group-item list-group-item-action ${!filters.subject ? 'active' : ''}`}
                      onClick={() => setFilter('subject', '')}>All courses</button>
              {facets.subjects.map((s) => (
                <button key={s.subject}
                        className={`list-group-item list-group-item-action d-flex justify-content-between ${filters.subject === s.subject ? 'active' : ''}`}
                        onClick={() => setFilter('subject', s.subject)}>
                  <span>{s.course_code ? `${s.course_code} ` : ''}{s.subject}</span>
                  <span className="badge text-bg-secondary">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
