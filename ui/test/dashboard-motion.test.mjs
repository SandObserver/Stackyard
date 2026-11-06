import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const dashboard = read('js/dashboard.js');
const css = read('css/dashboard.css');

test('a theme change repaints in place and never rebuilds the widgets', () => {
  const body = dashboard.slice(
    dashboard.indexOf('const retheme = () => {'),
    dashboard.indexOf('try {\n    matchMedia'),
  );
  assert.ok(body.length > 0, 'the theme handler moved');
  assert.doesNotMatch(body, /buildLayout\(|buildDesktop\(|buildMobile\(/);
  assert.match(body, /rethemeTiles\(\)/);
  assert.match(body, /__applyHostTheme/);
  assert.match(body, /startViewTransition/);
});

/* The tile outlives a theme change now, so a colour read when it was built is stale. */
test('a letter drawn after an icon fails reads the plate colour of the current theme', () => {
  const utils = read('js/utils.js');
  const failures = utils.match(/img\.replaceWith\(letterTile\([^)]*\)+/g) ?? [];
  assert.equal(failures.length, 2, 'the icon failure paths moved');
  for (const call of failures) assert.match(call, /letterTile\(item\.label, sz, clr\(colour\)\)/);
});

test('a widget frame can take a new theme without reloading', () => {
  const src = read('js/widget-theme.js');
  assert.match(src, /\(window\)\.__applyHostTheme = apply;/);
  assert.match(src, /if \(painted\) root\.style\.backgroundColor = '';/, 'a stale card colour would stay');
  assert.match(
    src,
    /if \(fixedDark === null\) fixedDark = /,
    'a card the widget marked dark itself would keep the dark theme',
  );
});

test('a running poll draws its last data again when the theme changes', () => {
  const src = read('js/widget-toolbox.js');
  assert.match(src, /attributeFilter: \['data-theme'\]/);
  assert.match(src, /_themed\.add\(onTheme\)/);
  assert.match(src, /_themed\.delete\(onTheme\)/, 'a stopped poll would keep drawing');
});

test('a badge scales in, scales out and crossfades its colour', () => {
  assert.match(css, /\.badge\.on\s*\{[^}]*animation:badge-in \.3s/);
  assert.match(css, /@keyframes badge-in \{ from \{ opacity:0; transform:translateZ\(0\) scale\(\.5\) \} \}/);
  assert.match(css, /\.badge \{[^}]*transition:background-color \.2s ease;/);
  assert.match(dashboard, /BEXIT\.get\(badge\)\?\.cancel\(\);/, 'a late exit would paint over a newer value');
});

test('the wallpaper fades in after its image has loaded and the veil has lifted', () => {
  assert.match(css, /html\.wall-in::before \{ animation:wall-in \.4s ease-out \}/);
  assert.match(css, /html\.wall-swap::after \{[^}]*background-image:var\(--bg-prev-image,none\)/);
  const show = dashboard.slice(dashboard.indexOf('async function showWallpaper('));
  const decode = show.indexOf('await decoded(bg.url)');
  const veil = show.indexOf('if (!prev) await veilLifted;');
  const paint = show.indexOf('applyBackground(root, bg)');
  assert.ok(decode > 0 && decode < veil && veil < paint, 'the fade would run under the boot veil');
  assert.doesNotMatch(dashboard, /document\.body\.classList\.add\('ready'\);\n(?![\s\S]{0,20}_veilLifted)/);
});

test('the theme crossfade lasts 300 ms and waits for a hidden page', () => {
  assert.match(css, /::view-transition-old\(root\), ::view-transition-new\(root\) \{ animation-duration:\.3s/);
  assert.match(
    dashboard,
    /if \(document\.hidden\) \{[\s\S]{0,200}addEventListener\(\s*'visibilitychange'/,
    'a theme set from another tab would switch unseen',
  );
});

test('the phone page control is an input a screen reader can adjust', () => {
  const page = read('index.html');
  assert.match(page, /<input id="mob-pager" class="visually-hidden" type="range"[^>]*data-i18n-al="home\.pageControl"/);
  assert.match(page, /<input id="mob-pager"[^>]*tabindex="-1"/, 'Tab would land on a control no one can see');
  assert.match(
    dashboard,
    /if \(e\.key === 'ArrowRight'\) goTo\(pg \+ pageDir\(\)\);/,
    'the keyboard pages without the control',
  );
  assert.match(dashboard, /pager\.setAttribute\(\s*'aria-valuetext',\s*t\('home\.pageAnnounce'/);
  assert.match(
    dashboard,
    /pager\.addEventListener\('input', \(\) => goTo\(Number\(pager\.value\) - 1, null, false\)\)/,
  );
  assert.match(dashboard, /if \(e\.target === pager\) return;/, 'an arrow key would turn two pages');
});

test('search shows the real Settings icon', () => {
  const spot = read('js/spotlight.js');
  assert.match(spot, /app\.system === 'settings'[\s\S]{0,200}SETTINGS_ICON_LIGHT : SETTINGS_ICON/);
});

test('the analog clock redraws its face when the theme changes', () => {
  assert.match(
    read('widgets/clock/analog.html'),
    /new MutationObserver\([\s\S]{0,400}attributeFilter:\['data-theme'\]/,
  );
});

test('widgets with a large live figure roll it', () => {
  assert.match(read('widgets/system-summary/index.html'), /rollText\(r\.val, r\.latest\)/);
  assert.match(read('widgets/dns/index.html'), /rollText\(pctEl,/);
  assert.match(read('widgets/weather/index.html'), /rollText\(tempEl,/);
});

/* Enough of a DOM for rollText's first write. */
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { createElement: () => ({}), getElementById: () => null, head: { appendChild() {} } };
const { rollDirection, rollText } = await import('../js/widget-toolbox.js');

test('a figure that grows rolls up, one that shrinks rolls down', () => {
  assert.equal(rollDirection('11%', '14%'), true);
  assert.equal(rollDirection('14%', '4%'), false);
  assert.equal(rollDirection('—', '4%'), true, 'an unreadable value rolls up');
});

test('the first value is written at once, with nothing to roll from', () => {
  const el = { textContent: 'old', firstElementChild: null, animate() {} };
  rollText(el, '12%');
  assert.equal(el.textContent, '12%');
});

test('a rolled figure keeps its digit order in a right-to-left widget', () => {
  const node = tag => ({
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    childNodes: [],
    get firstElementChild() {
      return this.children[0] ?? null;
    },
    get firstChild() {
      return this.childNodes[0] ?? null;
    },
    classList: {
      contains(c) {
        return false;
      },
    },
    appendChild(c) {
      this.children.push(c);
      this.childNodes.push(c);
      return c;
    },
    replaceChildren(...c) {
      this.children = [...c];
      this.childNodes = [...c];
    },
    setAttribute() {},
    animate: () => ({ finished: new Promise(() => {}) }),
  });
  const saved = globalThis.document;
  globalThis.document = { createElement: node, getElementById: () => ({}), head: { appendChild() {} } };
  try {
    const el = node('div');
    rollText(el, '۲۱°');
    rollText(el, '۲۲°');
    assert.equal(el.children.length, 1, 'one run holds every character');
    const run = el.children[0];
    assert.equal(run.className, 'wt-run');
    assert.deepEqual(
      run.children.map(c => c.className),
      ['wt-roll', 'wt-roll', 'wt-roll'],
    );
  } finally {
    globalThis.document = saved;
  }
  assert.match(read('js/widget-toolbox.js'), /\.wt-run\{direction:ltr;unicode-bidi:isolate\}/);
});

test('a changed digit rolls its full height inside a clipped slot', () => {
  const src = read('js/widget-toolbox.js');
  assert.match(src, /\.wt-roll\{[^']*clip-path:inset\(0 -1em\)/);
  assert.match(src, /const enter = up \? '100%' : '-100%';/);
  assert.match(src, /const leave = up \? '-100%' : '100%';/);
  assert.match(src, /filter: 'blur\(2px\)'/);
});
