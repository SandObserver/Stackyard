#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { listFiles, writeRoutes } = require('./source');

const STEP_MS = 5000;
/* A valid address, so routes that call out reach the demo-mode refusal, not input validation. */
const PROBE_BODY = JSON.stringify({ url: 'https://example.com', name: 'demo' });

/** @param {string} origin @param {string} target */
async function headersOf(origin, target) {
  const r = await fetch(origin + target, { method: 'HEAD', redirect: 'manual' });
  return r.status === 200 ? Object.fromEntries(r.headers) : null;
}

/** @param {string} origin @param {string} method @param {string} target @param {string|null} body */
async function exchange(origin, method, target, body = null) {
  const r = await fetch(origin + target, {
    method,
    headers: method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : (body ?? '{}'),
  });
  return [r.status, await r.text()];
}

async function record({ origin, tour, webroot, minutes, apiSource }) {
  /* Do not remove. The write probes below change the config of a container that
     is not in demo mode. */
  const [, local] = await exchange(origin, 'GET', '/api/icons/local');
  if (JSON.parse(local).demo !== true) throw new Error(`${origin} is not in demo mode`);
  const files = {};
  for (const f of listFiles(webroot)) {
    files[f] = await headersOf(origin, f);
    if (!files[f]) throw new Error(`${f} is in the web root but the image does not serve it`);
  }
  const routes = {};
  for (const f of Object.keys(files).filter(p => p.endsWith('/index.html'))) {
    const dir = f.slice(0, -'index.html'.length);
    for (const r of dir === '/' ? ['/'] : [dir, dir.slice(0, -1)]) {
      const h = await headersOf(origin, r);
      if (h) routes[r] = h;
    }
  }

  const gets = [...new Set(tour.filter(e => e.method === 'GET').map(e => e.path))].sort();
  const once = {};
  const writes = [];
  const known = writeRoutes(apiSource);
  for (const e of tour.filter(x => x.method !== 'GET')) {
    const route = known.find(w => w.method === e.method && new RegExp(w.pattern).test(e.path.split('?')[0]));
    if (!route) throw new Error(`${e.method} ${e.path} matches no route in the API source`);
    once[`${e.method} ${e.path}`] = [e.status, e.body];
    if (!writes.some(w => w.route === route.route && w.method === e.method)) {
      writes.push({ method: e.method, route: route.route, answer: [e.status, e.body] });
    }
  }
  const widgetId = gets.map(g => /^\/api\/widget-config\/([^/?]+)/.exec(g)?.[1]).find(Boolean) || 'demo';
  for (const w of known) {
    if (writes.some(x => x.route === w.route && x.method === w.method)) continue;
    writes.push({
      method: w.method,
      route: w.route,
      answer: await exchange(origin, w.method, w.route.replace(/:[a-z]+/gi, widgetId), PROBE_BODY),
    });
  }

  const count = Math.round((minutes * 60_000) / STEP_MS);
  const start = Math.ceil(Date.now() / STEP_MS) * STEP_MS;
  const frames = [];
  for (let i = 0; i < count; i++) {
    await new Promise(r => setTimeout(r, Math.max(0, start + i * STEP_MS - Date.now())));
    const frame = {};
    await Promise.all(
      gets.map(async g => {
        frame[`GET ${g}`] = await exchange(origin, 'GET', g);
      }),
    );
    frames.push(frame);
  }
  return { start, step: STEP_MS, frames, once, writes, headers: { files, routes } };
}

module.exports = { record };

if (require.main === module) {
  const [origin, tourFile, webroot, out, minutes = '10'] = process.argv.slice(2);
  if (!out) {
    console.error('usage: node scripts/demo/record.js <origin> <tour.json> <webroot> <out.json> [minutes]');
    process.exit(2);
  }
  record({
    origin,
    tour: JSON.parse(fs.readFileSync(tourFile, 'utf8')).exchanges,
    webroot,
    minutes: Number(minutes),
    apiSource: path.join(__dirname, '..', '..', 'api', 'src'),
  }).then(rec => {
    fs.writeFileSync(out, JSON.stringify(rec));
    console.log(
      `${rec.frames.length} frames of ${Object.keys(rec.frames[0]).length} addresses, ${rec.writes.length} write routes`,
    );
  });
}
