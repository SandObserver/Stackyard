const fs = require('node:fs');

/** A config write body with the stored `_rev` added, unless it names its own.
    @param {any} body @param {string} [file] */
function withRev(body, file = process.env.CONFIG_PATH) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, '_rev')) return body;
  let rev = 0;
  try {
    rev = Number(JSON.parse(fs.readFileSync(/** @type {string} */ (file), 'utf8'))._rev) || 0;
  } catch {}
  return { ...body, _rev: rev };
}

module.exports = { withRev };
