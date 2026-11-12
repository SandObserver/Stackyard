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
  assert.match(body, /rethemeFrames\(\)/);
  assert.match(dashboard, /const rethemeFrames = \(\) => \{[\s\S]{0,200}__applyHostTheme/);
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

test('a badge scales in only on a live change, scales out and crossfades its colour', () => {
  assert.doesNotMatch(css, /animation:badge-in/, 'every rebuild would pop every badge');
  assert.match(dashboard, /const entering = !_firstPolls && painted && !badge\.classList\.contains\('on'\)/);
  assert.match(dashboard, /transform: 'translateZ\(0\) scale\(\.8\)'/);
  assert.match(css, /\.badge \{[^}]*transition:background-color \.2s ease;/);
  assert.match(dashboard, /BEXIT\.get\(badge\)\?\.cancel\(\);/, 'a late exit would paint over a newer value');
});

test('the wallpaper appears with the first view, and fades in only when it arrives late', () => {
  const tokens = fs.readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /html\.wall-in::before \{ animation:wall-in \.4s ease-out \}/);
  assert.match(css, /html\.wall-swap::after \{[^}]*background-image:var\(--bg-prev-image,none\)/);
  const show = dashboard.slice(dashboard.indexOf('async function showWallpaper('));
  const decode = show.indexOf('await decoded(bg.url)');
  const paint = show.indexOf('applyBackground(root, bg)');
  const veil = show.indexOf("if (!prev && !document.body.classList.contains('ready')) return;");
  const fade = show.indexOf("const cls = prev ? 'wall-swap' : 'wall-in';");
  assert.ok(decode > 0 && decode < paint && paint < veil && veil < fade, 'a fade under the veil is never seen');
  assert.match(dashboard, /await within\(\s*firstBuild\.then[\s\S]{0,160}firstViewWait\(\),\s*\);\s*liftVeil\(\);/);
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
  assert.match(read('widgets/system-summary/index.html'), /rollText\(r\.val, r\.latest, /);
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

test('a Persian figure rolls in the direction its digits moved', () => {
  assert.equal(rollDirection('۴۱٪', '۴۲٪'), true);
  assert.equal(rollDirection('۴۲٪', '۴۱٪'), false);
  assert.equal(rollDirection('٤٢٪', '٤١٪'), false, 'Arabic-Indic digits read the same');
  assert.equal(rollDirection('۴۲٫۵', '۴۲٫۱'), false, 'the Persian decimal separator keeps the fraction');
});

const { formatNumber, setNumberLanguage } = await import('../js/format-number.js');

/** @param {string} tag the reader's locale @param {string} language the interface language */
function inLocale(tag, language, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  setNumberLanguage(language);
  try {
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
    setNumberLanguage('en');
  }
}

test('a Persian negative figure keeps its sign', () => {
  inLocale('fa', 'fa', () => {
    const [cold, milder] = [formatNumber(-5), formatNumber(-3)];
    assert.match(cold, /\u2212/, 'this locale no longer writes U+2212');
    assert.equal(rollDirection(cold + '°', milder + '°'), true, '-5 to -3 rose');
    assert.equal(rollDirection(milder + '°', cold + '°'), false, '-3 to -5 fell');
  });
});

test('a grouped figure reads by the separators it was written with', () => {
  inLocale('de-DE', 'de', () => {
    assert.equal(formatNumber(1000), '1.000');
    assert.equal(rollDirection('999', '1.000'), true, '999 to 1.000 rose');
    assert.equal(rollDirection('1.000', '999'), false);
    assert.equal(rollDirection('1,5', '1,25'), false, 'the comma is the decimal point');
  });
  inLocale('fr-FR', 'fr', () => {
    const written = formatNumber(1000.5);
    assert.equal(rollDirection(written, formatNumber(1000.4)), false, '1 000,5 read as 1000.5');
    assert.equal(rollDirection(written, formatNumber(1000.6)), true);
    assert.equal(rollDirection(written, '999'), false);
    assert.equal(rollDirection('1 000,5', '1 000,4'), false, 'a plain space groups too');
  });
  inLocale('en-US', 'en', () => {
    assert.equal(rollDirection('999', '1,000'), true);
    assert.equal(rollDirection('1.5', '1.25'), false);
    assert.equal(rollDirection('-5', '-3'), true);
    assert.equal(rollDirection('n/a', '3'), true, 'an unreadable value rolls up');
    assert.equal(rollDirection('3', 'n/a'), true);
  });
});

test('an instant write leaves the next large change able to roll', () => {
  const el = { textContent: '', firstElementChild: null, childNodes: [], animate() {} };
  rollText(el, '41%', { instant: true });
  rollText(el, '42%', { instant: true });
  assert.equal(el.textContent, '42%');
  let rolled = 0;
  const replaceChildren = () => {
    rolled++;
  };
  Object.assign(el, { replaceChildren, querySelectorAll: () => [] });
  try {
    rollText(el, '60%');
  } catch {
    /* The fake has no rolled glyphs to animate. */
  }
  assert.equal(rolled, 1, 'the value already shown was recorded');
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

test('the shared curve, the page curve and the release slope agree', async () => {
  const { EASE_IOS } = await import('../js/motion-curve.js');
  const { PAGE_EASE_SLOPE } = await import('../js/dashboard-logic.js');
  const [x1, y1, x2, y2] = EASE_IOS.match(/[\d.]+/g).map(Number);
  assert.deepEqual([x2, y2], [0, 1]);
  assert.equal(PAGE_EASE_SLOPE, y1 / x1, 'a flick would no longer leave at finger speed');
  assert.ok(css.includes(`--page-ease:        ${EASE_IOS}`));
});

test('a tile settles without overshoot', () => {
  assert.doesNotMatch(css, /bounce-spring|1\.56/);
});

test('the home strip keeps vertical pan and pinch zoom', () => {
  assert.match(css, /#pages \{[^}]*touch-action:pan-y pinch-zoom/);
});

test('the phone search pill answers a press without touching its inline transform', () => {
  assert.match(css, /#mob-search-pill:active \{ scale:\.96;/);
});

test('folder pages are reachable without touch', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const d = mk\('button'\);\s*d\.type = 'button';\s*d\.className = 'folder-dot dyn-dot';/);
  assert.match(ui, /e\.key !== 'ArrowRight' && e\.key !== 'ArrowLeft'/);
  assert.match(ui, /focus\(\{ preventScroll: true \}\)/, 'a focus scroll knocks the clipped strip off its page');
  assert.match(
    dashboard,
    /if \(document\.querySelector\('\.folder-overlay\[open\], \.folder-overlay-mobile\[open\]'\)\) return;\s*if \(e\.key === 'ArrowRight'\)/,
  );
});

test('a page turn closes the badge popover', () => {
  assert.match(dashboard, /if \(pg !== was\) closeBadgePopover\(\);/);
});

test('a widget frame follows the dashboard and the system for reduced transparency', async () => {
  const { runInNewContext } = await import('node:vm');
  const src = read('js/widget-theme.js');
  /** @param {{ parentAttr?: string|null, queries?: string[], card?: string }} o */
  const run = ({ parentAttr = null, queries = [], card = '' } = {}) => {
    const attrs = new Map();
    const style = { backgroundColor: '' };
    const frameRoot = {
      style,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: k => attrs.delete(k),
      getAttribute: k => attrs.get(k) ?? null,
      toggleAttribute: (k, on) => (on ? attrs.set(k, '') : attrs.delete(k)),
    };
    const parentRoot = { getAttribute: k => (k === 'data-transparency' ? parentAttr : 'dark') };
    const frameElement = {
      closest: sel => (sel === '[data-card="translucent"]' && card === 'translucent' ? {} : null),
      getAttribute: () => null,
    };
    const window = {
      frameElement,
      parent: { document: { documentElement: parentRoot } },
      matchMedia: q => ({ matches: queries.some(x => q.includes(x)), addEventListener() {} }),
    };
    runInNewContext(src, {
      window,
      document: { documentElement: frameRoot },
      location: { search: '' },
      URLSearchParams,
      getComputedStyle: () => ({ backgroundColor: style.backgroundColor || 'rgba(0, 0, 0, 0)' }),
    });
    return {
      reduce: attrs.get('data-transparency') ?? null,
      glass: attrs.has('data-glass'),
      bg: style.backgroundColor,
    };
  };
  assert.equal(run({ parentAttr: 'reduce' }).reduce, 'reduce', 'the switch on this device');
  assert.equal(run({ queries: ['reduced-transparency'] }).reduce, 'reduce', 'the system setting');
  assert.equal(run().reduce, null);

  assert.deepEqual(run({ card: 'translucent' }), { reduce: null, glass: true, bg: '' }, 'glass shows the card');
  assert.deepEqual(run(), { reduce: null, glass: false, bg: '#1C1C1E' }, 'a solid card is painted under the page');
  for (const o of [
    { card: 'translucent', parentAttr: 'reduce' },
    { card: 'translucent', queries: ['prefers-contrast'] },
    { card: 'translucent', queries: ['forced-colors'] },
  ]) {
    const r = run(o);
    assert.equal(r.glass, false, JSON.stringify(o));
    assert.equal(r.bg, '#1C1C1E', JSON.stringify(o));
  }
});

test('widget styles key reduced transparency on the attribute the frame copies', () => {
  const dir = path.join(root, 'widgets');
  for (const name of fs.readdirSync(dir)) {
    for (const file of fs.readdirSync(path.join(dir, name)).filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, name, file), 'utf8');
      assert.doesNotMatch(html, /prefers-reduced-transparency/, `${name}/${file}`);
      if (/data-transparency/.test(html)) assert.match(html, /widget-theme\.js/, `${name}/${file}`);
    }
  }
});
