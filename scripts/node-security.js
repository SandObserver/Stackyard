#!/usr/bin/env node
/* Fails when a newer Node.js security release exists on the image's major line.
   Trivy does not report the Node runtime in the image. */

const INDEX_URL = 'https://nodejs.org/dist/index.json';

/** @param {unknown} v @returns {[number, number, number]|null} */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @param {[number, number, number]} a @param {[number, number, number]} b */
function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The newest security release on the same major line that is newer than
    `installed`, or null when there is none.

    @param {string} installed
    @param {Array<{ version: string, security?: boolean }>} releases
    @returns {string|null} */
function missingSecurityRelease(installed, releases) {
  const have = parseVersion(installed);
  if (!have) throw new Error(`not a Node.js version: ${installed}`);
  let newest = null;
  for (const r of releases) {
    const v = parseVersion(r.version);
    if (!r.security || !v || v[0] !== have[0] || compare(v, have) <= 0) continue;
    if (!newest || compare(v, newest.v) > 0) newest = { v, version: r.version };
  }
  return newest ? newest.version : null;
}

module.exports = { parseVersion, missingSecurityRelease };

if (require.main === module) {
  const installed = process.argv[2] ?? '';
  (async () => {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`${INDEX_URL}: HTTP ${res.status}`);
    const missing = missingSecurityRelease(installed, await res.json());
    if (missing) {
      console.error(`node-security: image has Node.js ${installed}, security release ${missing} is out`);
      process.exit(1);
    }
    console.error(`node-security: Node.js ${installed} has every security release on its line`);
  })().catch(err => {
    console.error(`node-security: ${err.message}`);
    process.exit(1);
  });
}
