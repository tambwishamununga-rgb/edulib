'use strict';
const crypto = require('crypto');

/**
 * Short-lived signed links for viewing files.
 * A browser cannot attach an Authorization header when an <iframe>, <video> or
 * download link loads a URL, so the logged-in app first asks the API for a link
 * that proves "this user was allowed to see this file until time X".
 * The signature is an HMAC of the file id + expiry, so it cannot be forged or
 * reused for another file.
 */
const SECRET = process.env.FILE_LINK_SECRET || 'dev-only-secret-change-me';

const sign = (id, exp) =>
  crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('hex');

function verify(id, exp, sig) {
  if (!id || !exp || typeof sig !== 'string') return false;
  if (!(Number(exp) > Date.now())) return false;           // expired (or not a number)
  const a = Buffer.from(sign(id, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sign, verify };
