#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHUNK_FRAMES = 60;
const MAX_HEADER_RULES = 100;
const MISSING = [503, JSON.stringify({ error: 'Not available in the live demo.', kind: 'blocked' })];
const OUTBOUND_ROUTES = ['POST /api/widget-options/:id'];

const { listFiles, routePattern } = require('./source');

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

/** @param {Array<Record<string, [number, string]>>} frames */
function classify(frames) {
  const fixed = {};
  const varying = [];
  for (const key of Object.keys(frames[0] || {})) {
    const first = JSON.stringify(frames[0][key]);
    if (frames.every(f => JSON.stringify(f[key]) === first)) fixed[key] = frames[0][key];
    else varying.push(key);
  }
  return { fixed, varying };
}

/** @param {Array<Record<string, [number, string]>>} frames @param {string} key */
function splitSeries(frames, key, size = CHUNK_FRAMES) {
  const out = [];
  for (let c = 0; c < frames.length; c += size) {
    const json = JSON.stringify(frames.slice(c, c + size).map(f => f[key]));
    out.push({ name: `${hash(key)}.${hash(json)}.json`, json });
  }
  return out;
}

/** The replay takes the first match. Keep the most specific routes first.
    @param {{ fixed: Record<string, [number, string]>, writes: Array<{ method: string, route: string, answer: [number, string] }> }} r */
function fallbackRoutes({ fixed, writes }) {
  const routes = [];
  const byPath = new Map();
  for (const [key, answer] of Object.entries(fixed)) {
    const [method, full] = key.split(' ');
    const [pathname, query] = full.split('?');
    if (method !== 'GET' || query === undefined) continue;
    if (!byPath.has(pathname)) byPath.set(pathname, []);
    byPath.get(pathname).push(answer);
  }
  /* Only failures fall back. A result for one query is wrong for another. */
  for (const [pathname, answers] of byPath) {
    if (answers.every(a => a[0] >= 400)) routes.push([{ method: 'GET', path: routePattern(pathname) }, answers[0]]);
  }
  const ping = writes.find(w => w.method === 'POST' && w.route === '/api/ping');
  const blocked = ping && JSON.parse(ping.answer[1]);
  for (const w of writes) {
    if (OUTBOUND_ROUTES.includes(`${w.method} ${w.route}`)) {
      if (!blocked?.error) throw new Error(`no recorded outbound refusal to answer ${w.route} with`);
      const body = JSON.stringify({ error: blocked.error, kind: blocked.kind, code: blocked.code });
      routes.push([{ method: w.method, path: routePattern(w.route) }, [502, body]]);
    } else {
      routes.push([{ method: w.method, path: routePattern(w.route) }, w.answer]);
    }
  }
  return routes;
}

const RULE_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'cache-control',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];
const TITLE = {
  'content-security-policy': 'Content-Security-Policy',
  'x-frame-options': 'X-Frame-Options',
  'cache-control': 'Cache-Control',
  'x-content-type-options': 'X-Content-Type-Options',
  'referrer-policy': 'Referrer-Policy',
  'permissions-policy': 'Permissions-Policy',
};

const pick = h => Object.fromEntries(RULE_HEADERS.filter(n => h[n] !== undefined).map(n => [n, h[n]]));
const same = (a, b) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

/* Detach each changed header first. Cloudflare joins a header that two matching
   rules set, and a joined Content-Security-Policy blocks the page. */
function diffLines(base, h) {
  const lines = [];
  for (const n of RULE_HEADERS) {
    if (base[n] === h[n]) continue;
    if (base[n] !== undefined) lines.push(`! ${TITLE[n]}`);
    if (h[n] !== undefined) lines.push(`${TITLE[n]}: ${h[n]}`);
  }
  return lines;
}

/** @param {Record<string, Record<string, string>>} files headers per file path
    @param {Record<string, Record<string, string>>} routes headers per route that is not a file */
function headerRules(files, routes = {}) {
  /* The main page's headers are the base, so a path no rule names gets the
     strictest policy, not the widgets' inline-script one. */
  if (!files['/index.html']) throw new Error('the web root has no /index.html');
  const base = pick(files['/index.html']);
  const rules = [['/*', RULE_HEADERS.filter(n => base[n] !== undefined).map(n => `${TITLE[n]}: ${base[n]}`)]];
  const covered = [];

  const walk = dir => {
    const inside = Object.keys(files).filter(p => p.startsWith(dir));
    const first = files[inside[0]];
    if (dir !== '/' && inside.every(p => same(files[p], first))) {
      if (!same(first, base)) {
        rules.push([`${dir}*`, diffLines(base, first)]);
        covered.push([dir, first]);
      }
      return;
    }
    const subdirs = new Set();
    for (const p of inside) {
      const rest = p.slice(dir.length);
      if (rest.includes('/')) subdirs.add(`${dir}${rest.split('/')[0]}/`);
      else if (!same(files[p], base)) rules.push([p, diffLines(base, files[p])]);
    }
    for (const d of [...subdirs].sort()) walk(d);
  };
  walk('/');

  for (const [route, h] of Object.entries(routes)) {
    const group = covered.find(([dir]) => route.startsWith(dir));
    if (group) {
      if (!same(group[1], h)) throw new Error(`${route} needs other headers than ${group[0]}*`);
      continue;
    }
    if (!same(h, base)) rules.push([route, diffLines(base, h)]);
  }
  if (rules.length > MAX_HEADER_RULES)
    throw new Error(`${rules.length} header rules; Cloudflare allows ${MAX_HEADER_RULES}`);
  return rules.map(([p, lines]) => `${p}\n${lines.map(l => `  ${l}`).join('\n')}\n`).join('\n');
}

/** @param {string[]} routes */
function redirectRules(routes) {
  const lines = [...routes].sort().map(r => `${r} ${r.endsWith('/') ? r : `${r}/`}index.html 200`);
  return `${lines.join('\n')}\n`;
}

/** @param {string} html @param {string} src */
function injectScript(html, src) {
  const out = html.replace(/<head(\s[^>]*)?>/i, m => `${m}<script src="${src}"></script>`);
  if (out === html) throw new Error('page has no <head>');
  return out;
}

function build(webroot, recording, out) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(webroot, out, { recursive: true });
  const files = listFiles(out);

  const { fixed: still, varying } = classify(recording.frames);
  const fixed = { ...recording.once, ...still };
  const bad = Object.entries(fixed).filter(([, [status]]) => status === 429);
  if (bad.length) throw new Error(`rate limited while recording: ${bad.map(([k]) => k).join(', ')}`);

  const dir = path.join(out, 'demo-replay');
  fs.mkdirSync(dir);
  const series = {};
  for (const key of varying) {
    series[key.slice('GET '.length)] = splitSeries(recording.frames, key).map(({ name, json }) => {
      fs.writeFileSync(path.join(dir, name), json);
      return name;
    });
  }
  const index = JSON.stringify({
    start: recording.start,
    step: recording.step,
    count: recording.frames.length,
    chunk: CHUNK_FRAMES,
    fixed,
    series,
    routes: fallbackRoutes({ fixed, writes: recording.writes }),
    missing: MISSING,
  });
  const indexName = `index.${hash(index)}.json`;
  fs.writeFileSync(path.join(dir, indexName), index);
  const script = fs
    .readFileSync(path.join(__dirname, 'replay.js'), 'utf8')
    .replace('__REPLAY_INDEX__', `/demo-replay/${indexName}`);
  const scriptName = `replay.${hash(script)}.js`;
  fs.writeFileSync(path.join(dir, scriptName), script);

  for (const f of files.filter(p => p.endsWith('.html'))) {
    const file = path.join(out, f);
    fs.writeFileSync(file, injectScript(fs.readFileSync(file, 'utf8'), `/demo-replay/${scriptName}`));
  }

  const replayHeaders = { ...recording.headers.files['/index.html'] };
  replayHeaders['cache-control'] = 'public, max-age=31536000, immutable';
  const replayFiles = Object.fromEntries(listFiles(dir, '/demo-replay').map(p => [p, replayHeaders]));
  fs.writeFileSync(
    path.join(out, '_headers'),
    headerRules({ ...recording.headers.files, ...replayFiles }, recording.headers.routes),
  );
  fs.writeFileSync(path.join(out, '_redirects'), redirectRules(Object.keys(recording.headers.routes)));
  return { pages: files.filter(p => p.endsWith('.html')).length, fixed: Object.keys(fixed).length, varying };
}

module.exports = { classify, splitSeries, fallbackRoutes, headerRules, redirectRules, injectScript, build };

if (require.main === module) {
  const [webroot, recordingFile, out] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node scripts/demo/build.js <webroot> <recording.json> <out>');
    process.exit(2);
  }
  const result = build(webroot, JSON.parse(fs.readFileSync(recordingFile, 'utf8')), out);
  console.log(`${result.pages} pages, ${result.fixed} fixed answers, replaying ${result.varying.join(', ')}`);
}
