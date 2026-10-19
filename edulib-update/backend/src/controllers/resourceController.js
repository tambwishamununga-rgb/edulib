'use strict';
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');                       // exports { query } wrapping the pg Pool (Objective 1)
const { UPLOAD_DIR, MIME_BY_EXT } = require('../config/upload');
const { matchesSignature } = require('../utils/fileSignature');
const { analyzeFile, getSubjects, recommend, similar } = require('../services/aiClient');
const { sign, verify } = require('../utils/signedLink');

// Formats a browser can display itself. PPTX/DOCX cannot be shown without conversion.
const INLINE_EXTS = new Set(['.pdf', '.txt', '.md', '.mp4', '.webm']);
const LINK_TTL_MS = 10 * 60 * 1000;

const TYPES = ['pdf', 'slides', 'notes', 'video', 'other'];
const typeFromExt = (ext) =>
  ({ '.pdf': 'pdf', '.pptx': 'slides', '.docx': 'notes', '.txt': 'notes', '.md': 'notes' }[ext] || 'video');

const cleanName = (name) =>
  path.basename(name).replace(/[\u0000-\u001f<>:"|?*\\/]/g, '_').slice(0, 255);

const removeQuietly = (p) => fs.unlink(p).catch(() => {});

// Hide internal columns from API responses.
const publicView = ({ search_vector, stored_name, total, ...rest }) => rest;

// Records what a student does; the recommender learns from this. Never blocks the request.
const logInteraction = (userId, resourceId, action) =>
  db.query('INSERT INTO interactions (user_id, resource_id, action) VALUES ($1, $2, $3)',
    [userId, resourceId, action]).catch((e) => console.error('interaction log failed:', e.message));

const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const toItem = (r, weight) => ({
  id: r.id, title: r.title, keywords: r.keywords || [], subject: r.subject, topics: r.topics || [],
  ...(weight ? { weight } : {}),
});

// Everything this user is allowed to see, newest first (the recommender's candidate pool).
async function visibleCandidates(userId, excludeId = null) {
  const { rows } = await db.query(
    `SELECT * FROM resources
     WHERE (user_id = $1 OR visibility = 'public') AND extraction_status <> 'pending'
       AND ($2::uuid IS NULL OR id <> $2)
     ORDER BY created_at DESC LIMIT 300`, [userId, excludeId]);
  return rows;
}

// Applies an AI analysis to a resource row. Skips subject if the user already set it by hand.
async function applyAnalysis(id, a) {
  const { rows } = await db.query(
    `UPDATE resources SET
        title = CASE WHEN metadata_edited THEN title ELSE $2 END,
        author = COALESCE(author, $11),
        summary = $12,
        subject = CASE WHEN subject_overridden THEN subject ELSE $3 END,
        subject_confidence = CASE WHEN subject_overridden THEN subject_confidence ELSE $4 END,
        course_code = CASE WHEN subject_overridden THEN course_code ELSE $9 END,
        classified_by = CASE WHEN subject_overridden THEN classified_by ELSE $10 END,
        topics = $5, keywords = $6, page_count = $7, extraction_status = $8
     WHERE id = $1 RETURNING *`,
    [id, a.title, a.subject, a.subject_confidence, a.topics, a.keywords, a.page_count,
     a.extraction_status, a.course_code, a.classified_by, a.author || null, a.summary || null]
  );
  return rows[0];
}

/** POST /api/resources  (multipart field name: "file") */
exports.upload = async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'No file received (field name must be "file")' });

    const ext = path.extname(file.filename).toLowerCase();
    if (!(await matchesSignature(file.path, ext))) {
      await removeQuietly(file.path);
      return res.status(415).json({ error: 'File content does not match its extension' });
    }

    const rtype = typeFromExt(ext);
    const original = cleanName(file.originalname);
    const visibility = req.body.visibility === 'public' ? 'public' : 'private';

    // 1. Save immediately so an AI outage never loses the upload.
    const { rows } = await db.query(
      `INSERT INTO resources
         (user_id, original_name, stored_name, mime_type, size_bytes, resource_type, title, visibility, author, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, original, file.filename, MIME_BY_EXT[ext], file.size, rtype,
       original.replace(/\.[^.]+$/, ''), visibility, clean(req.body.author, 120), clean(req.body.description, 2000)]
    );
    let resource = rows[0];
    logInteraction(req.user.id, resource.id, 'upload');

    // 2. Try to enrich it. Failure degrades gracefully to 'failed' + Uncategorized.
    try {
      const analysis = await analyzeFile({
        filePath: file.path, originalName: original, resourceType: rtype, sizeBytes: file.size,
      });
      resource = await applyAnalysis(resource.id, analysis);
    } catch (err) {
      console.error('Analysis failed for', resource.id, err.message);
      const r = await db.query(
        `UPDATE resources SET extraction_status = 'failed' WHERE id = $1 RETURNING *`, [resource.id]);
      resource = r.rows[0];
    }
    res.status(201).json(publicView(resource));
  } catch (err) {
    if (file) await removeQuietly(file.path);
    next(err);
  }
};

/** GET /api/resources?subject=&type=&q=&sort=&page=&limit= */
exports.list = async (req, res, next) => {
  try {
    const { subject, type, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = (Math.max(Number(req.query.page) || 1, 1) - 1) * limit;

    const params = [req.user.id];
    const where = [`(user_id = $1 OR visibility = 'public')`];
    if (subject) { params.push(subject); where.push(`subject = $${params.length}`); }
    if (type && TYPES.includes(type)) { params.push(type); where.push(`resource_type = $${params.length}`); }

    let order = 'created_at DESC';
    if (q) {
      params.push(q);
      where.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
      order = `ts_rank(search_vector, plainto_tsquery('english', $${params.length})) DESC, created_at DESC`;
    } else if (req.query.sort === 'title') {
      order = 'title ASC';
    }

    params.push(limit, offset);
    const { rows } = await db.query(
      `SELECT *, COUNT(*) OVER() AS total FROM resources
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

    res.json({ total: rows[0] ? Number(rows[0].total) : 0, items: rows.map(publicView) });
  } catch (err) { next(err); }
};

/** GET /api/resources/facets - counts for the library sidebar and type filter tabs */
exports.facets = async (req, res, next) => {
  try {
    const base = `FROM resources WHERE user_id = $1 OR visibility = 'public'`;
    const [subjects, types] = await Promise.all([
      db.query(`SELECT subject, MAX(course_code) AS course_code, COUNT(*)::int AS count ${base} GROUP BY subject ORDER BY count DESC`, [req.user.id]),
      db.query(`SELECT resource_type AS type, COUNT(*)::int AS count ${base} GROUP BY resource_type`, [req.user.id]),
    ]);
    res.json({ subjects: subjects.rows, types: types.rows });
  } catch (err) { next(err); }
};

async function findVisible(id, userId) {
  const { rows } = await db.query(
    `SELECT * FROM resources WHERE id = $1 AND (user_id = $2 OR visibility = 'public')`, [id, userId]);
  return rows[0];
}

/** GET /api/resources/:id */
exports.getOne = async (req, res, next) => {
  try {
    const r = await findVisible(req.params.id, req.user.id);
    if (!r) return res.status(404).json({ error: 'Resource not found' });
    res.json(publicView(r));
  } catch (err) { next(err); }
};

/** POST /api/resources/:id/view-link - logged-in users get a short-lived link for reading or downloading */
exports.viewLink = async (req, res, next) => {
  try {
    const r = await findVisible(req.params.id, req.user.id);
    if (!r) return res.status(404).json({ error: 'Resource not found' });
    const ext = path.extname(r.stored_name).toLowerCase();
    const exp = Date.now() + LINK_TTL_MS;
    logInteraction(req.user.id, r.id, req.body?.purpose === 'download' ? 'download' : 'view');
    res.json({
      url: `/api/resources/${r.id}/stream?exp=${exp}&sig=${sign(r.id, exp)}`,
      inline: INLINE_EXTS.has(ext),     // false -> the UI offers download only
      type: r.resource_type,
      ext,
      name: r.original_name,
    });
  } catch (err) { next(err); }
};

/** GET /api/resources/:id/stream?exp=&sig=[&dl=1] - signed link, no Authorization header needed */
exports.stream = async (req, res, next) => {
  try {
    const { exp, sig, dl } = req.query;
    if (!verify(req.params.id, exp, sig)) return res.status(403).json({ error: 'Link expired or invalid' });

    const { rows } = await db.query(
      'SELECT stored_name, original_name FROM resources WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Resource not found' });

    const ext = path.extname(rows[0].stored_name).toLowerCase();
    const inline = INLINE_EXTS.has(ext) && dl !== '1';
    // Text is always served as text/plain so an uploaded .md or .txt can never run as HTML.
    const mime = ext === '.txt' || ext === '.md'
      ? 'text/plain; charset=utf-8'
      : MIME_BY_EXT[ext] || 'application/octet-stream';

    res.set({
      'Content-Type': mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(rows[0].original_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0',
    });
    // sendFile also supports HTTP range requests, so video seeking works.
    res.sendFile(path.resolve(UPLOAD_DIR, rows[0].stored_name), (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) { next(err); }
};

/** GET /api/resources/subjects - the UNZA course list (single source: the AI service taxonomy) */
exports.subjects = async (req, res, next) => {
  try { res.json(await getSubjects()); } catch (err) { next(err); }
};

/** PATCH /api/resources/:id - owner edits title/author/description/subject/visibility.
 *  Hand-edited metadata and subject are never overwritten by a later AI re-analysis. */
exports.update = async (req, res, next) => {
  try {
    const { title, author, description, subject, visibility } = req.body;
    let courseCode = null;
    if (subject) {
      // Only accept subjects from the UNZA list so the library stays consistent.
      const match = (await getSubjects()).find((s) => s.title === subject);
      if (!match) return res.status(400).json({ error: 'Unknown subject' });
      courseCode = match.code;
    }
    const t = clean(title, 200);
    const a = typeof author === 'string' ? author.trim().slice(0, 120) : null;       // '' clears it
    const d = typeof description === 'string' ? description.trim().slice(0, 2000) : null;
    const { rows } = await db.query(
      `UPDATE resources SET
          title = COALESCE($3, title),
          author = COALESCE($7, author),
          description = COALESCE($8, description),
          metadata_edited = metadata_edited OR ($3::text IS NOT NULL OR $7::text IS NOT NULL),
          subject = COALESCE($4, subject),
          course_code = CASE WHEN $4::text IS NOT NULL THEN $6 ELSE course_code END,
          classified_by = CASE WHEN $4::text IS NOT NULL THEN 'manual' ELSE classified_by END,
          subject_overridden = subject_overridden OR ($4::text IS NOT NULL),
          visibility = COALESCE($5::visibility, visibility)
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id, t, subject || null,
       ['private', 'public'].includes(visibility) ? visibility : null, courseCode, a, d]);
    if (!rows[0]) return res.status(404).json({ error: 'Resource not found' });
    res.json(publicView(rows[0]));
  } catch (err) { next(err); }
};

/** POST /api/resources/:id/reanalyze - retry after an AI outage */
exports.reanalyze = async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM resources WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Resource not found' });
    const analysis = await analyzeFile({
      filePath: path.join(UPLOAD_DIR, r.stored_name), originalName: r.original_name,
      resourceType: r.resource_type, sizeBytes: Number(r.size_bytes),
    });
    res.json(publicView(await applyAnalysis(r.id, analysis)));
  } catch (err) { next(err); }
};

/** DELETE /api/resources/:id */
exports.remove = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `DELETE FROM resources WHERE id = $1 AND user_id = $2 RETURNING stored_name`,
      [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Resource not found' });
    await removeQuietly(path.join(UPLOAD_DIR, rows[0].stored_name));
    res.status(204).end();
  } catch (err) { next(err); }
};

/** GET /api/resources/recommended - personalised shelf; falls back to "new in the library" for new users */
exports.recommended = async (req, res, next) => {
  try {
    const hist = await db.query(
      `SELECT r.*, SUM(CASE i.action WHEN 'download' THEN 2 WHEN 'upload' THEN 1.5 ELSE 1 END)::float AS weight
       FROM interactions i JOIN resources r ON r.id = i.resource_id
       WHERE i.user_id = $1 AND i.created_at > now() - interval '90 days'
         AND (r.user_id = $1 OR r.visibility = 'public')
       GROUP BY r.id ORDER BY MAX(i.created_at) DESC LIMIT 20`, [req.user.id]);
    const cands = await visibleCandidates(req.user.id);

    let ranked = [];
    if (hist.rows.length) {
      try {
        ranked = await recommend(hist.rows.map((r) => toItem(r, r.weight)), cands.map((r) => toItem(r)), 8);
      } catch (e) { console.error('Recommendation failed, using fallback:', e.message); }
    }
    const byId = new Map(cands.map((r) => [r.id, r]));
    let items = ranked.filter((x) => byId.has(x.id))
      .map((x) => ({ ...publicView(byId.get(x.id)), reason: x.reason, score: x.score }));
    const personalised = items.length > 0;
    if (!personalised) {
      const seen = new Set(hist.rows.map((r) => r.id));
      items = cands.filter((r) => !seen.has(r.id)).slice(0, 8)
        .map((r) => ({ ...publicView(r), reason: 'New in the library' }));
    }
    res.json({ personalised, items });
  } catch (err) { next(err); }
};

/** GET /api/resources/:id/related - "more like this" */
exports.related = async (req, res, next) => {
  try {
    const r = await findVisible(req.params.id, req.user.id);
    if (!r) return res.status(404).json({ error: 'Resource not found' });
    const cands = await visibleCandidates(req.user.id, r.id);
    let ranked = [];
    try { ranked = await similar(toItem(r), cands.map((x) => toItem(x)), 5); }
    catch (e) { console.error('Similarity failed:', e.message); }
    const byId = new Map(cands.map((x) => [x.id, x]));
    res.json({ items: ranked.filter((x) => byId.has(x.id))
      .map((x) => ({ ...publicView(byId.get(x.id)), reason: x.reason, score: x.score })) });
  } catch (err) { next(err); }
};

/** GET /api/resources/recent - "continue reading" */
exports.recent = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, MAX(i.created_at) AS last_viewed
       FROM interactions i JOIN resources r ON r.id = i.resource_id
       WHERE i.user_id = $1 AND i.action = 'view' AND (r.user_id = $1 OR r.visibility = 'public')
       GROUP BY r.id ORDER BY last_viewed DESC LIMIT 8`, [req.user.id]);
    res.json({ items: rows.map(publicView) });
  } catch (err) { next(err); }
};
