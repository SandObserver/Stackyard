import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { installDom, pageBody } from './fake-dom.mjs';

/* The eleven text styles, at every Dynamic Type step the project declares.

   The reference publishes each style as an absolute pair. The stylesheet stores
   a unitless ratio and an em instead, so a size scaled by --sc or by browser
   zoom carries its leading and tracking with it. A ratio rounded too hard stops
   reproducing the pair it came from, so the pairs are checked rather than the
   ratios. */

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');
const tokens = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf8');

/* Tracking is one absolute value per style, the same at every step. An em that
   reproduces -0.43px at 17 does not reproduce it at 15, so each step stores its
   own em and each is checked against the same published tracking.

   [style, size, leading, tracking] */
const STEPS = {
  'Large (Default)': [
    ['large-title', 34, 41, 0.4],
    ['title-1', 28, 34, 0.38],
    ['title-2', 22, 28, -0.26],
    ['title-3', 20, 25, -0.45],
    ['headline', 17, 22, -0.43],
    ['body', 17, 22, -0.43],
    ['callout', 16, 21, -0.31],
    ['subheadline', 15, 20, -0.23],
    ['footnote', 13, 18, -0.08],
    ['caption-1', 12, 16, 0],
    ['caption-2', 11, 13, 0.06],
  ],
  Small: [
    ['large-title', 32, 39, 0.4],
    ['title-1', 26, 32, 0.38],
    ['title-2', 20, 24, -0.26],
    ['title-3', 18, 23, -0.45],
    ['headline', 15, 20, -0.43],
    ['body', 15, 20, -0.43],
    ['callout', 14, 19, -0.31],
    ['subheadline', 13, 18, -0.23],
    ['footnote', 12, 16, -0.08],
    ['caption-1', 11, 13, 0],
    ['caption-2', 11, 13, 0.06],
  ],
};

/* The two blocks are read separately. Scanning the whole file would let the step
   block overwrite the default one and the check would pass against itself. */
const bare = tokens.replace(/\/\*[\s\S]*?\*\//g, '');

/* Located by a declaration the block contains, then bounded by the braces
   either side of it. */
function block(marker) {
  const at = bare.indexOf(marker);
  assert.ok(at >= 0, `${marker} is not in tokens.css`);
  const open = bare.lastIndexOf('{', at);
  const close = bare.indexOf('}', at);
  const out = new Map();
  for (const m of bare.slice(open, close).matchAll(/(--(?:fs|lh|tr)-[\w-]+)\s*:\s*([^;{}]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/* The dashboard takes the default step in px. Settings takes it in rem, and the
   small step is only in rem. 16px is the browser default, so rem is size / 16. */
const BLOCKS = {
  'Large (Default)': block('--fs-large-title:34px'),
  Small: block('--fs-large-title:2rem'),
};
const UNIT = { 'Large (Default)': 'px', Small: 'rem' };
const DEFAULT_REM = block('--fs-large-title:2.125rem');
const sizeIn = (size, unit) => (unit === 'px' ? `${size}px` : `${size / 16}rem`);

for (const [step, scale] of Object.entries(STEPS)) {
  const declared = BLOCKS[step];

  test(`${step}: every style declares all three tokens`, () => {
    const missing = [];
    for (const [name] of scale) {
      for (const p of ['fs', 'lh', 'tr']) {
        if (!declared.has(`--${p}-${name}`)) missing.push(`--${p}-${name}`);
      }
    }
    assert.deepEqual(missing, [], `A style is only part applied without all three:\n  ${missing.join('\n  ')}`);
  });

  test(`${step}: each size is the published size`, () => {
    const wrong = [];
    for (const [name, size] of scale) {
      const actual = declared.get(`--fs-${name}`);
      const expected = sizeIn(size, UNIT[step]);
      if (actual !== expected) wrong.push(`--fs-${name}: ${actual}, expected ${expected}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });

  /* Half a pixel: the ratio is stored to four places, and the point of the check
     is that it still lands on the published leading, not that it is exact. */
  test(`${step}: each ratio multiplies back out to the published leading`, () => {
    const wrong = [];
    for (const [name, size, leading] of scale) {
      const ratio = Number(declared.get(`--lh-${name}`));
      assert.ok(Number.isFinite(ratio), `--lh-${name} is not a unitless number: ${declared.get(`--lh-${name}`)}`);
      const got = ratio * size;
      if (Math.abs(got - leading) > 0.5)
        wrong.push(`--lh-${name}: ${got.toFixed(2)}px, published leading is ${leading}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });

  test(`${step}: each tracking multiplies back out to the published tracking`, () => {
    const wrong = [];
    for (const [name, size, , tracking] of scale) {
      const raw = declared.get(`--tr-${name}`);
      const em = raw === '0' ? 0 : Number(/^(-?[\d.]+)em$/.exec(raw)?.[1]);
      assert.ok(Number.isFinite(em), `--tr-${name} is not 0 or an em value: ${raw}`);
      const got = em * size;
      if (Math.abs(got - tracking) > 0.02)
        wrong.push(`--tr-${name}: ${got.toFixed(3)}px, published tracking is ${tracking}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });
}

test('Large (Default): the rem sizes are the px sizes at a 16px root', () => {
  const expected = new Map(STEPS['Large (Default)'].map(([name, size]) => [`--fs-${name}`, sizeIn(size, 'rem')]));
  assert.deepEqual(DEFAULT_REM, expected);
});

/* The dashboard tiles are px, so its text must not follow the browser text size.
   Settings must, so it takes both classes. */
test('Settings text follows the browser text size and the dashboard text does not', () => {
  const htmlClass = file => {
    const page = fs.readFileSync(path.join(cssDir, '..', file), 'utf8');
    return (/<html[^>]*\bclass="([^"]*)"/.exec(page)?.[1] ?? '').split(/\s+/).filter(Boolean);
  };
  assert.deepEqual(htmlClass('admin/index.html').sort(), ['type-rem', 'type-small']);
  assert.deepEqual(htmlClass('index.html'), []);
});

/* A glyph drawn inside a fixed px box keeps a px size, or a larger text setting
   pushes it out of the box. */
const PX_GLYPH = new Set(['.rico', '.kv-box::after', '.icon-prev', '.fp-ic', '.ipv']);
/* Tab bar labels keep a px size. A larger size overflows the four tabs in the
   phone bar. */
const PX_FIXED = new Set(['html.is-mobile .mtab']);

test('Settings sets no text size in px outside a fixed glyph box', () => {
  const src = fs.readFileSync(path.join(cssDir, 'admin.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [];
  for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, sel, body] = m;
    if (!/(^|;)\s*(font-size\s*:\s*[\d.]+px|line-height\s*:\s*[\d.]+px)/.test(body)) continue;
    const name = sel.trim().split('\n').pop().trim();
    if (!PX_GLYPH.has(name) && !PX_FIXED.has(name)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `px text size in Settings:\n  ${offenders.join('\n  ')}`);
  const list = fs.readFileSync(path.join(cssDir, '..', 'js', 'admin-list.js'), 'utf8');
  assert.doesNotMatch(list, /font-size:\d+px/, 'the folder chevron is text and follows the text size');
});

test('Settings leaves the root font size at the browser default', () => {
  const settingsCss = ['tokens.css', 'admin.css', 'widget-config-form.css', 'config-recovery.css'];
  const rootSelector = /^(html|:root)(?![^\s>+~]*::)[^\s>+~]*$/;
  const offenders = [];
  for (const file of settingsCss) {
    const src = fs.readFileSync(path.join(cssDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const [, sel, body] = m;
      if (!/(^|;)\s*font(-size)?\s*:/.test(body)) continue;
      const roots = sel
        .split(',')
        .map(s => s.trim())
        .filter(s => rootSelector.test(s));
      if (roots.length) offenders.push(`${file}: ${roots.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], `font size on the root:\n  ${offenders.join('\n  ')}`);
  const page = fs.readFileSync(path.join(cssDir, '..', 'admin', 'index.html'), 'utf8');
  assert.doesNotMatch(/<html[^>]*>/.exec(page)?.[0] ?? '', /style=/);
});

test('the phone tab labels keep a fixed size', () => {
  const src = fs.readFileSync(path.join(cssDir, 'admin.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tab = [...src.matchAll(/([^{}]*)\{([^{}]*)\}/g)].find(m => m[1].trim() === 'html.is-mobile .mtab')?.[2] ?? '';
  assert.match(tab, /(^|;)font-size:10px(;|$)/);
  assert.match(tab, /(^|;)line-height:12px(;|$)/);
});

/* balance on short centred headings, pretty on hint prose. Never on every
   element: balance is limited to a few lines and costs layout time on long text. */
const WRAP = {
  'admin.css': { '.login-sub': 'balance', '.hint': 'pretty', '.grp-tip': 'pretty' },
  'dashboard.css': {
    '.empty-state-title': 'balance',
    '.empty-state-sub': 'balance',
    '.api-error-title': 'balance',
    '.folder-title-desktop': 'balance',
    '.api-error-sub': 'pretty',
    '.setup-sub': 'pretty',
  },
};

test('centred headings balance and hints wrap pretty, and nothing else', () => {
  for (const [file, want] of Object.entries(WRAP)) {
    const src = fs.readFileSync(path.join(cssDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const got = {};
    for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const wrap = /text-wrap\s*:\s*(\w+)/.exec(m[2]);
      if (wrap) got[m[1].trim().split('\n').pop().trim()] = wrap[1];
    }
    assert.deepEqual(got, want, file);
  }
  const tokensBare = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(tokensBare, /text-wrap/);
});

/* A rule that sets a size from the scale and takes its leading from somewhere
   else looks applied and is not. Rules that set their own line-height on
   purpose are listed, with the reason. */
const OWN_LINE_HEIGHT = new Set([
  '.badge', // a count in a fixed circle
  'body:not(.is-mob) .badge',
  '#mob-search-pill .msp-icon',
  '.setup-sub',
  '.grp-tip', // prose, deliberately looser than the style
  '.hint',
]);

test('a rule using a size token takes its leading from the scale', () => {
  const offenders = [];
  for (const file of ['admin.css', 'dashboard.css']) {
    const src = fs.readFileSync(path.join(cssDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const [, sel, body] = m;
      if (!/font-size:\s*(calc\()?var\(--fs-/.test(body)) continue;
      const name = sel.trim().split('\n').pop().trim();
      if (OWN_LINE_HEIGHT.has(name)) continue;
      if (!/line-height:\s*var\(--lh-/.test(body)) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `Size from the scale, leading from elsewhere:\n  ${offenders.join('\n  ')}`);
});

/* Radii that have to follow the thing they round.

   An app icon's corner is 26% of its width, the kit's icon grid, and the grid
   draws two widths: 72 with a label under it and 78 without. A fixed radius
   lands on the ratio at one of them and is wrong at the other.

   A widget tile's corner is 28 at design size, and WIDGET_DESIGN's small is 170
   square against the reference's 165, so it is the reference value unchanged.
   Desktop tiles keep one size at every width, so the corner does too. */
test('icon and tile radii are derived, not literal', async () => {
  register('./js-root-hooks.mjs', import.meta.url);
  const dom = installDom({ markup: pageBody('index.html') });
  const { ICON_R } = await import('../js/utils.js');
  const { createDashboardState } = await import('../js/dashboard-state.js');
  const { createBadges } = await import('../js/dashboard-badges.js');
  const { createDesktopGrid } = await import('../js/dashboard-grid.js');
  const { initUI } = await import('../js/ui.js');
  assert.equal(ICON_R, 0.26);
  const ui = fs.readFileSync(path.join(cssDir, '..', 'js', 'ui.js'), 'utf8');
  assert.doesNotMatch(ui, /\* 0\.22\d?\)/, 'a phone icon corner is a literal again');
  const dash = createDashboardState();
  dash.items = [
    { id: 'a', type: 'app', label: 'A', href: 'http://a.local' },
    { id: 'd', type: 'app', label: 'D', href: 'http://d.local', dock: true },
    { id: 'w', type: 'widget', label: 'W', widgetType: 'clock', widgetSize: 'small' },
  ];
  const badges = createBadges(dash);
  initUI({ items: dash.items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  const grid = createDesktopGrid({ dash, badges, goTo() {} });
  const radius = sel => dom.document.querySelector(sel).style.cssText.match(/border-radius:(\d+)px/)?.[1];
  const corners = () => ({
    grid: radius('#pages .iwrap'),
    dock: radius('#dock .dwrap'),
    widget: dom.document.querySelector('#pages .widget').style.borderRadius,
  });
  grid.buildDesktop();
  assert.deepEqual(corners(), {
    grid: String(Math.round(72 * ICON_R)),
    dock: String(Math.round(78 * ICON_R)),
    widget: '28px',
  });
  dash.S = { showLabels: { desktop: false } };
  globalThis.innerWidth = 2560;
  globalThis.innerHeight = 1440;
  grid.buildDesktop();
  assert.deepEqual(
    corners(),
    { grid: String(Math.round(78 * ICON_R)), dock: String(Math.round(78 * ICON_R)), widget: '28px' },
    'desktop tiles must not scale with the window',
  );
  dom.restore();
});
