const fs = require('node:fs');
const path = require('node:path');

/** @param {string} dir @returns {string[]} paths below dir, each starting with / */
function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = `${prefix}/${e.name}`;
    return e.isDirectory() ? listFiles(path.join(dir, e.name), rel) : [rel];
  });
}

/** @param {string} route @returns {string} */
function routePattern(route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-z]+/gi, '[^/]+');
  return `^${escaped}$`;
}

/** @param {string} apiSrc @returns {Array<{ method: string, route: string, pattern: string }>} */
function writeRoutes(apiSrc) {
  const out = [];
  for (const f of listFiles(apiSrc).filter(p => p.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(apiSrc, f), 'utf8');
    for (const m of src.matchAll(/\bon\(\s*'(POST|PUT|PATCH|DELETE)',\s*'(\/api\/[^']+)'/g)) {
      out.push({ method: m[1], route: m[2], pattern: routePattern(m[2]) });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

module.exports = { listFiles, routePattern, writeRoutes };
