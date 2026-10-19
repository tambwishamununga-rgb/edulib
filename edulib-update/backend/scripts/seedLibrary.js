'use strict';
/**
 * Bulk-adds every supported file in a folder to the library as shared resources.
 *   npm run seed -- ..\sample-library
 * Uses the dev login token, so it only works with the dev auth stub.
 */
const fs = require('fs/promises');
const path = require('path');

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.SEED_TOKEN || 'dev';
const EXT = new Set(['.pdf', '.pptx', '.docx', '.txt', '.md', '.mp4', '.webm', '.mov', '.mkv']);

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: npm run seed -- <folder>'); process.exit(1); }
  const files = (await fs.readdir(dir)).filter((f) => EXT.has(path.extname(f).toLowerCase()));
  console.log(`Uploading ${files.length} file(s) from ${dir} as shared resources...`);
  for (const f of files) {
    const form = new FormData();
    form.append('file', new Blob([await fs.readFile(path.join(dir, f))]), f);
    form.append('visibility', 'public');
    const res = await fetch(`${API}/api/resources`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
    const body = await res.json().catch(() => ({}));
    console.log(res.ok ? `OK    ${f} -> ${body.course_code || '-'} ${body.subject}` : `FAIL  ${f}: ${body.error || res.status}`);
  }
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
