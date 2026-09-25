import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { ICONS, STYLES, symbol } = await import('../js/icon-set.js');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');

function segments(d) {
  const out = [];
  const re = /([MLHVAZmlhvaz])([^MLHVAZmlhvaz]*)/g;
  const arity = { m: 2, l: 2, h: 1, v: 1, a: 7, z: 0 };
  let [x, y, sx, sy] = [0, 0, 0, 0];
  for (const [, c, args] of d.matchAll(re)) {
    const lc = c.toLowerCase();
    const rel = c !== c.toUpperCase();
    const nums = (args.match(/-?(\d+\.?\d*|\.\d+)(e-?\d+)?/g) || []).map(Number);
    if (lc === 'z') {
      out.push({ c: 'L', p: [sx, sy], from: [x, y] });
      [x, y] = [sx, sy];
      continue;
    }
    for (let i = 0; i < nums.length; i += arity[lc]) {
      const a = nums.slice(i, i + arity[lc]);
      const from = [x, y];
      if (lc === 'h') x = rel ? x + a[0] : a[0];
      else if (lc === 'v') y = rel ? y + a[0] : a[0];
      else [x, y] = rel ? [x + a.at(-2), y + a.at(-1)] : [a.at(-2), a.at(-1)];
      const move = lc === 'm' && i === 0;
      if (move) [sx, sy] = [x, y];
      out.push({ c: lc === 'a' ? 'A' : move ? 'M' : 'L', a, p: [x, y], from });
    }
  }
  return out;
}

/** Points along an arc, from the endpoint form in SVG 1.1 appendix F.6.5. */
function arcPoints([x1, y1], s) {
  const [rx0, ry0, rot, large, sweep] = s.a;
  const [x2, y2] = s.p;
  const phi = (rot * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const k = Math.max(1, Math.sqrt((xp * xp) / (rx0 * rx0) + (yp * yp) / (ry0 * ry0)));
  const [rx, ry] = [rx0 * k, ry0 * k];
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (co * rx * yp) / ry;
  const cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const t1 = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let dt = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const t = t1 + (dt * i) / 64;
    pts.push([
      cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    ]);
  }
  return pts;
}

function pathPoints(d) {
  return segments(d).flatMap(s => (s.c === 'A' ? arcPoints(s.from, s) : s.c === 'M' ? [s.p] : [s.from, s.p]));
}

function extent(p) {
  if (p.t === 'rect') return [p.x, p.y, p.x + p.w, p.y + p.h];
  if (p.t === 'circle') return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
  const pts = pathPoints(p.d);
  const xs = pts.map(q => q[0]);
  const ys = pts.map(q => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* Filled parts must paint inside 2 to 22, round ends included. A stroked line
   keeps its centreline there, as every line in the set does. */
function assertInsideGrid(id) {
  for (const styleId of Object.keys(STYLES)) {
    const st = STYLES[styleId];
    for (const p0 of ICONS[id].shapes) {
      const p = st.line && p0.lineAlt ? { ...p0, ...p0.lineAlt } : p0;
      const [x0, y0, x1, y1] = extent(p);
      const eps = 1e-6;
      assert.ok(
        x0 >= 2 - eps && y0 >= 2 - eps && x1 <= 22 + eps && y1 <= 22 + eps,
        `${id} in ${styleId}: a part spans ${[x0, y0, x1, y1].map(n => n.toFixed(2))}`,
      );
    }
  }
}

test('the logo draws one accent arc and three ink strokes inside the grid', () => {
  const { sym } = symbol('logo', ICONS.logo);
  assert.equal((sym.match(/class="sy-a"/g) || []).length, 1);
  assert.equal((sym.match(/class="sy-i"/g) || []).length, 3);
  assertInsideGrid('logo');
});

test('line styles draw the logo as strokes, not outlined areas', () => {
  const { sym } = symbol('logo', ICONS.logo, 'stroke');
  assert.equal((sym.match(/fill="none"/g) || []).length, 4);
});

test('the docs section icons have one accent part and stay inside the grid', () => {
  for (const id of ['start', 'run', 'create']) {
    assert.equal(ICONS[id].shapes.filter(p => p.role === 'a').length, 1, id);
    assertInsideGrid(id);
    for (const styleId of Object.keys(STYLES)) assert.match(symbol(id, ICONS[id], styleId).sym, /<path|<rect/);
  }
});

/* ── the standalone logo files ────────────────────────────────────────────── */

const pathsOf = svg => [...svg.matchAll(/<path fill="[^"]+" d="([^"]+)"/g)].map(m => m[1]);

test('the favicon draws the same geometry as the logo icon', () => {
  const sym = symbol('logo', ICONS.logo).sym;
  const ink = [...sym.matchAll(/<path d="([^"]+)" class="sy-i"/g)].map(m => m[1]).join('');
  const accent = /<path d="([^"]+)" class="sy-a"/.exec(sym)[1];
  const [favArc, favInk] = pathsOf(read('ui/icons/favicon.svg'));
  const scale = 1024 / 24;
  for (const [file, icon] of [
    [favArc, accent],
    [favInk, ink],
  ]) {
    const a = segments(file);
    const b = segments(icon);
    assert.equal(a.length, b.length, 'the favicon and the logo icon have different outlines');
    a.forEach((s, i) => {
      assert.equal(s.c, b[i].c);
      const want = b[i].p.map(n => n * scale);
      assert.ok(Math.hypot(s.p[0] - want[0], s.p[1] - want[1]) < 0.1, `point ${i} is ${s.p}, the icon has ${want}`);
      if (s.c === 'A') {
        assert.ok(Math.abs(s.a[0] - b[i].a[0] * scale) < 0.1, `radius ${i} differs`);
        assert.deepEqual(s.a.slice(3, 5), b[i].a.slice(3, 5), `arc flags ${i} differ`);
      }
    });
  }
});

test('the Unraid icons use the favicon geometry', () => {
  const fav = pathsOf(read('ui/icons/favicon.svg'));
  for (const f of ['templates/icon.svg', 'templates/icon-light.svg', 'templates/icon-dark.svg']) {
    assert.deepEqual(pathsOf(read(f)), fav, f);
  }
});
