'use strict';
const fs = require('fs/promises');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const MAX_ANALYSIS_BYTES = 50 * 1024 * 1024;

/**
 * Sends a stored file to the Python service and returns the analysis.
 * Uses Node 18+ built-in fetch/FormData/Blob, so no extra dependency is needed.
 * Videos are sent as an empty body: they are categorized from the filename
 * only, so there is no reason to push hundreds of MB across the network.
 */
async function analyzeFile({ filePath, originalName, resourceType, sizeBytes }) {
  let bytes = Buffer.alloc(0);
  if (resourceType !== 'video' && sizeBytes <= MAX_ANALYSIS_BYTES) {
    bytes = await fs.readFile(filePath);
  }
  const form = new FormData();
  form.append('file', new Blob([bytes]), originalName);

  const res = await fetch(`${AI_URL}/analyze`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI service ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

let subjectsCache = null;
/** UNZA course list from the AI service, cached because it only changes when taxonomy.py is edited. */
async function getSubjects() {
  if (subjectsCache) return subjectsCache;
  const res = await fetch(`${AI_URL}/subjects`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`AI service ${res.status} fetching subjects`);
  subjectsCache = await res.json();
  return subjectsCache;
}

async function postJson(path, body) {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI service ${res.status} on ${path}`);
  return res.json();
}

/** Personalised ranking from a student's history. */
const recommend = (history, candidates, topN = 8) => postJson('/recommend', { history, candidates, top_n: topN });
/** "More like this" for one resource. */
const similar = (target, candidates, topN = 5) => postJson('/similar', { target, candidates, top_n: topN });

module.exports = { analyzeFile, getSubjects, recommend, similar };
