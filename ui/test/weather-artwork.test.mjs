import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../widgets/weather/index.html', import.meta.url), 'utf8');
const art = /\/\* ---- artwork[\s\S]*?\nfunction buildIcon\([\s\S]*?\n\}/.exec(page)?.[0];
const { buildIcon, cloudPath } = new Function(`${art}; return { buildIcon, cloudPath };`)();

const CONDITIONS = [
  'clear',
  'few',
  'scattered',
  'broken',
  'mist',
  'shower',
  'rain',
  'thunder',
  'snow',
  'drizzle',
  'fdrizzle',
  'frain',
  'sleet',
  'rainsnow',
  'grains',
  'hail',
  'thinmist',
  'rime',
  'haze',
  'smoke',
  'dust',
  'ash',
  'squall',
  'tornado',
];

test('every condition draws by day and by night', () => {
  assert.ok(art, 'the artwork block is not in the weather page');
  for (const cond of CONDITIONS)
    for (const day of [true, false]) {
      const svg = buildIcon(cond, day);
      assert.ok(svg.length > 100, `${cond} drew nothing`);
      assert.doesNotMatch(svg, /NaN|undefined/, `${cond} ${day ? 'day' : 'night'} has a broken value`);
    }
});

const mapSource = /\nfunction mapCode\([\s\S]*?\n\}/.exec(page)?.[0];
const mapCode = new Function('wt', `${mapSource}; return mapCode;`)((_key, fallback) => fallback);

test('every weather code the providers send has its own artwork', () => {
  const codes = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 18, 19, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 68, 69, 71, 73, 75, 77, 79,
    80, 81, 82, 85, 86, 95, 96, 99,
  ];
  for (const code of codes) assert.ok(CONDITIONS.includes(mapCode(code).cond), `code ${code}`);
  assert.deepEqual(mapCode(56), { cond: 'fdrizzle', label: 'Freezing Drizzle' });
  assert.deepEqual(mapCode(79), { cond: 'sleet', label: 'Sleet' });
  assert.deepEqual(mapCode(96), { cond: 'hail', label: 'Hailstorm' });
  assert.deepEqual(mapCode(4, 'ash'), { cond: 'ash', label: 'Volcanic Ash' });
  assert.deepEqual(mapCode(7, 'sand'), { cond: 'dust', label: 'Sand' });
  assert.deepEqual(mapCode(19), { cond: 'tornado', label: 'Tornado' });
});

test('the cloud rests both puffs on a flat base', () => {
  const d = cloudPath(2, 14, 96);
  const [, sx, base, bx] = /^M([\d.]+) ([\d.]+)H([\d.]+)A/.exec(d).map(Number);
  assert.ok(bx > sx, 'the base runs left to right');
  assert.ok(Math.abs(base - (14 + 0.702 * 96)) < 0.01);
  assert.match(d, /z$/);
});

const ORIGIN_RULE = /\.ico (\.wx-[\w-]+(?:,\.ico \.wx-[\w-]+)*)\{transform-box:fill-box;transform-origin:center\}/;

test('no part with its own transform gets a centred transform origin', () => {
  const classes = ORIGIN_RULE.exec(page)?.[1]
    .split(',.ico .')
    .map(c => c.replace(/^\./, ''));
  assert.ok(classes?.length, 'the transform-origin rule is gone');
  for (const cond of CONDITIONS)
    for (const day of [true, false])
      for (const [tag] of buildIcon(cond, day).matchAll(/<[a-z]+\b[^>]*>/g)) {
        const cls = /class="([^"]+)"/.exec(tag)?.[1].split(' ') ?? [];
        if (cls.some(c => classes.includes(c)))
          assert.doesNotMatch(tag, /\stransform=/, `${cond}: ${tag} would move off its place`);
      }
});

test('css motion stops for reduced motion and while the card is off screen', () => {
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)\{\.ico \*\{animation:none\}/);
  assert.match(page, /\.ico\.off \*\{animation-play-state:paused\}/);
  assert.match(
    page,
    /whileOnScreen\(icoEl,\s*v\s*=>\s*\{onScreen=v;icoEl\.classList\.toggle\('off',!v\);runAmbient\(\);\}\)/,
  );
});

test('nothing blurred is moved by a frame-rate css animation', () => {
  for (const cls of ['wx-front', 'wx-back', 'wx-mist', 'wx-orb', 'wx-cloud'])
    assert.doesNotMatch(page, new RegExp(`\\.${cls}[^{]*\\{[^}]*animation`), `.${cls} has a css animation`);
  for (const cond of CONDITIONS)
    for (const day of [true, false])
      for (const [part] of buildIcon(cond, day).matchAll(/<g class="wx-(?:drop|flake)[^>]*>[\s\S]*?<\/g>/g))
        assert.doesNotMatch(part, /filter=/, `${cond}: falling parts carry a filter`);
});

const ambientSource = /const still=[\s\S]*?\nstill\.addEventListener\('change',runAmbient\);/.exec(page)?.[0];

function ambientHarness(reduced) {
  const styled = [];
  const el = { style: {}, removeAttribute: n => styled.push(n) };
  const icoEl = { querySelectorAll: () => [el] };
  const timers = [];
  const env = {
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    setInterval: (fn, ms) => timers.push(ms),
    clearInterval: () => {},
    performance: { now: () => 1000 },
  };
  const run = new Function(
    'icoEl',
    'matchMedia',
    'setInterval',
    'clearInterval',
    'performance',
    `${ambientSource.replace(/\nwhileOnScreen[^\n]*/, '')}; return v => { onScreen = v; runAmbient(); };`,
  )(icoEl, env.matchMedia, env.setInterval, env.clearInterval, env.performance);
  return { run, timers, el, styled };
}

test('slow motion runs on a timer only while the card is on screen', () => {
  assert.ok(ambientSource, 'the ambient motion block is gone');
  const h = ambientHarness(false);
  h.run(false);
  assert.deepEqual(h.timers, []);
  h.run(true);
  assert.deepEqual(h.timers, [500]);
  assert.match(h.el.style.transform, /^translateX\(-?[\d.]+px\)$/);
});

test('slow motion stays still for reduced motion', () => {
  const h = ambientHarness(true);
  h.run(true);
  assert.deepEqual(h.timers, []);
  assert.ok(h.styled.includes('style'), 'moved parts are put back');
});

test('every falling part starts inside its lane', () => {
  for (const cond of ['shower', 'rain', 'snow', 'thunder'])
    for (const day of [true, false]) {
      const svg = buildIcon(cond, day);
      const parts = [
        ...svg.matchAll(
          /<g class="wx-pos[^"]*" data-lo="([\d.]+)" data-hi="([\d.]+)" transform="translate\(([\d.]+) 0\)"(?: opacity="[\d.]+")?><g class="wx-(?:drop|flake|bolt)/g,
        ),
      ];
      assert.ok(parts.length, `${cond} has no falling parts`);
      assert.equal(
        parts.length,
        svg.match(/class="wx-(?:drop|flake|bolt)/g).length,
        `${cond}: a falling part has no lane`,
      );
      for (const [, lo, hi, x] of parts) assert.ok(+lo <= +x && +x <= +hi, `${cond}: ${x} is outside ${lo} to ${hi}`);
    }
});

test('a falling part restarts at a new spot inside its lane', () => {
  const handler = /icoEl\.addEventListener\('animationiteration',(e=>\{[\s\S]*?\n\})\);/.exec(page)?.[1];
  assert.ok(handler, 'the restart handler is gone');
  const restart = new Function(`return ${handler}`)();
  const seen = new Set();
  let transform;
  let strikes = 0;
  const lane = (flip = false) => ({
    classList: { contains: c => c === 'wx-pos' || (flip && c === 'wx-flip') },
    dataset: { lo: '30', hi: '64' },
    setAttribute: (_, v) => {
      transform = v;
    },
    querySelector: () => ({
      animate: () => {
        strikes++;
      },
    }),
  });
  for (let i = 0; i < 40; i++) {
    restart({ target: { parentNode: lane(i % 2 === 1) } });
    const x = +/^translate\(([\d.]+) 0\)/.exec(transform)[1];
    assert.ok(x >= 30 && x <= 64, `${x} left the lane`);
    seen.add(x);
    if (i % 2 === 0) assert.doesNotMatch(transform, /scale/);
  }
  assert.ok(seen.size > 1, 'the spot never changes');
  assert.equal(strikes, 20, 'each new strike draws the bolt');
  transform = undefined;
  restart({ target: { parentNode: { classList: { contains: () => false } } } });
  assert.equal(transform, undefined);
});

test('the lightning flash is hidden at rest', () => {
  for (const day of [true, false])
    assert.match(buildIcon('thunder', day), /<path class="wx-flash[^"]*"[^>]*opacity="0"/);
});

test('the lightning flash drifts with the cloud it lights', () => {
  for (const day of [true, false]) assert.match(buildIcon('thunder', day), /<path class="wx-flash wx-front"/);
});

test('a faint far layer keeps its opacity off the animated element', () => {
  for (const cond of ['shower', 'rain', 'snow'])
    for (const day of [true, false]) {
      const svg = buildIcon(cond, day);
      assert.match(svg, /<g class="wx-pos"[^>]*opacity="0\.5+"/, `${cond} has no faint far layer`);
      assert.doesNotMatch(
        svg,
        /<g class="wx-(?:drop|flake)"[^>]*opacity=/,
        `${cond}: the animation overrides the faint layer`,
      );
    }
});

test('falling parts start in separate lanes, so a still picture shows each one', () => {
  const still = { 'wx-drop': -6, 'wx-flake': 1, 'wx-pellet': -1.5, 'wx-bolt': -2 };
  for (const cond of ['shower', 'rain', 'snow', 'fdrizzle', 'frain', 'sleet', 'rainsnow', 'hail'])
    for (const day of [true, false]) {
      const near = [
        ...buildIcon(cond, day).matchAll(/<g class="wx-pos[^"]*" [^>]*translate\(([\d.]+) 0\)"><g class="([\w-]+)/g),
      ].map(m => +m[1] + still[m[2]]);
      const gaps = near
        .sort((a, b) => a - b)
        .slice(1)
        .map((x, i) => x - near[i]);
      assert.ok(Math.min(...gaps) >= 8, `${cond}: two parts start ${Math.min(...gaps)} apart`);
    }
});

test('reduced motion shows rain and snow below the cloud, not behind it', () => {
  const still = /@media\(prefers-reduced-motion:reduce\)\{([^@]*?)\}\s*\n/.exec(page)?.[1];
  assert.match(still, /\.ico \.wx-drop\{transform:translate\(-?[\d.]+px,[\d.]+px\)\}/);
  assert.match(still, /\.ico \.wx-flake\{transform:translate\(-?[\d.]+px,[\d.]+px\)\}/);
});
