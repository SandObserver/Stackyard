/* Every catalogue value should be a translation, not the English left in place.

   The Persian catalogue had four keys whose values were still the English
   words, and asking the question properly turned up the same in all five: ten
   in Chinese, seven each in Spanish and French, five in German. None of it
   failed anything, because a value identical to English renders perfectly well.

   Some values are identical on purpose: "Color" is Spanish, "Secret" is French,
   "Name" is German, and several product words like Dock, Ping and Widget are
   used untranslated in these languages. Those are listed per language, so
   adding one is a deliberate act rather than a silent gap. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n');
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[p + k, v]]));

/* Keys whose English value is correct in that language too. */
const SAME_ON_PURPOSE = {
  'de.json': new Set([
    /* Debug, Info and the version line are written the same way in German. */
    'general.logDebug',
    'general.logInfo',
    'about.version',
    'appearance.sourceUnsplash',
    'nav.dashboard',
    'about.support',
    'dashboard.filterApps',
    'dashboard.filterWidgets',
    'type.app',
    'type.widget',
    'app.name',
    'app.url',
    /* "Optional" is the German word too. */
    'app.optional',
    'app.badge',
    'app.container',
    'app.ping',
    'app.dockPill',
    'app.badgePill',
    'home.dock',
    'status.containerState',
    'widgetCfg.name',
    'general.importExport',
  ]),
  'es.json': new Set([
    'appearance.sourceUnsplash',
    'nav.general',
    'common.color',
    'appearance.color',
    'dashboard.filterWidgets',
    'type.widget',
    'app.url',
    'app.ping',
    'app.dockPill',
    'home.dock',
  ]),
  'fr.json': new Set([
    /* Info and the version line are written the same way in French. */
    'general.logInfo',
    /* "Image" is the French word too. */
    'appearance.image',
    'appearance.sourceUrl',
    'about.version',
    'appearance.sourceUnsplash',
    'general.description',
    'appearance.source',
    'about.documentation',
    'dashboard.filterWidgets',
    'type.widget',
    'app.url',
    'app.type',
    'app.ping',
    'app.badge',
    'app.secret',
    'app.dockPill',
    'app.badgePill',
    'home.dock',
  ]),
  'fa.json': new Set(['appearance.sourceUnsplash']),
  'zh-Hans.json': new Set(['app.ping', 'appearance.sourceUnsplash']),
};

const en = Object.fromEntries(flat(read('en.json')));

for (const [file, allowed] of Object.entries(SAME_ON_PURPOSE)) {
  test(`${file} translates every value that is not deliberately shared`, () => {
    const other = Object.fromEntries(flat(read(file)));
    const untranslated = Object.keys(en).filter(
      k =>
        !k.startsWith('_meta.') &&
        !/Ph$/.test(k) /* placeholders are examples */ &&
        /[A-Za-z]{3}/.test(String(en[k])) /* something translatable */ &&
        other[k] === en[k] &&
        !allowed.has(k),
    );
    assert.deepEqual(untranslated, [], `${file}: still English. Translate, or add to SAME_ON_PURPOSE with a reason.`);
  });
}

/* ── one word per concept ─────────────────────────────────────────────────── */

/* A machine translates each string on its own, so the same concept comes back
   under a different word in each. The Persian catalogue named a widget both
   ابزارک and ویجت, and a file both فایل and پرونده, in one interface.

   It also reached for فرهنگستان coinages that correct Persian dictionaries
   carry but shipped software does not use. درون‌ریزی and برون‌بری for import and
   export appear in none of Immich, Jellyfin or Uptime Kuma, all of which build
   import on وارد کردن; Immich, the closest of the three to this project, ships
   وارد کردن پیکربندی for "Import configuration" and خروجی for "Export".

   Each entry is the rejected term and what to write instead. Adding one is how
   a terminology decision is recorded, so it survives the next bulk retranslation.
   The glossary in docs/i18n.md carries the same list in prose. */
const REJECTED = {
  'fa.json': [
    ['درون‌ریزی', 'وارد کردن'],
    ['برون‌بری', 'خروجی'],
    ['ابزارک', 'ویجت'],
    ['پرونده', 'فایل'],
  ],
  /* Abzeichen is a pinned badge or a medal. The reference locales use Badge 26
     times and Abzeichen never. Bezeichnung is what the rest of the catalogue
     calls a label. */
  'de.json': [
    ['Abzeichen', 'Badge'],
    ['Beschriftung', 'Bezeichnung'],
  ],
  /* 标记 is a mark or a verb. 徽章 is the status readout, which is what Uptime
     Kuma, a monitoring dashboard, uses throughout. 挂件 is an ornament. */
  'zh-Hans.json': [
    ['标记', '徽章'],
    ['挂件', '小组件'],
    ['仪表盘', '仪表板'],
  ],
};

const widgetCatalogues = locale => {
  const dir = path.join(DIR, '..', 'widgets');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'i18n', locale)))
    .map(e => [
      `widgets/${e.name}/i18n/${locale}`,
      JSON.parse(fs.readFileSync(path.join(dir, e.name, 'i18n', locale), 'utf8')),
    ]);
};

for (const [file, pairs] of Object.entries(REJECTED)) {
  test(`${file} uses one agreed word per concept`, () => {
    const catalogues = [[file, read(file)], ...widgetCatalogues(file)];
    const found = [];
    for (const [name, catalogue] of catalogues) {
      for (const [key, value] of flat(catalogue)) {
        for (const [rejected, instead] of pairs) {
          if (String(value).includes(rejected)) found.push(`${name} ${key}: ${rejected} -> ${instead}`);
        }
      }
    }
    assert.deepEqual(found, [], `A term the glossary rules out. See docs/i18n.md:\n  ${found.join('\n  ')}`);
  });
}

/* ── English left inside a non-Latin catalogue ────────────────────────────── */

/* A machine translation that skips a word leaves it in English, and in a
   non-Latin script that is visible to a scan even though the value as a whole
   differs from the source. Persian rendered "چیزی برای Import نیست", and Chinese
   had "Import 失败", "Logging 级别" and "添加到 Header".

   Only the catalogues written in another script can be checked this way. In
   German, Spanish and French an English word is not distinguishable from the
   language around it.

   ALLOWED is the vocabulary that stays in Latin script on purpose: brands,
   protocols, formats, and identifiers a reader types or sees in a config file.
   Everything is matched whole-word and case-insensitively. */
const LATIN_OK = [
  'Stackyard',
  'Docker',
  'Unsplash',
  'GitHub',
  'Plex',
  'Homepage',
  'Dashy',
  'gethomepage',
  'JSON',
  'YAML',
  'CSS',
  'SVG',
  'PNG',
  'HTML',
  'URL',
  'URLs',
  'IP',
  'API',
  'ICMP',
  'DNS',
  'HTTP',
  'HTTPS',
  'SSL',
  'TLS',
  'PWA',
  'UI',
  'ID',
  'CPU',
  'RAM',
  'SMART',
  'RSS',
  'VPN',
  'PAT',
  'SSO',
  'Ping',
  'Dock',
  'Iframe',
  'Referrer',
  'Socket',
  'Widget',
  'http',
  'https',
  'repo',
  'ltr',
  'rtl',
  'px',
  'ms',
  'container',
  'name',
  'port',
  'server',
  'your',
  'example',
  'com',
  'app',
  'api',
  'read',
  'user',
  'min',
  'max',
  'chars',
  'rrggbb',
  'autoplay',
  'fullscreen',
];
const ALLOWED = new Set(LATIN_OK.map(w => w.toLowerCase()));

for (const file of ['fa.json', 'zh-Hans.json']) {
  test(`${file} leaves no English word untranslated`, () => {
    const stray = [];
    for (const [key, value] of flat(read(file))) {
      if (key.startsWith('_meta') || /Ph$/.test(key)) continue; /* examples are literal */
      /* Markup tag names and placeholder names are not prose. */
      const prose = String(value)
        .replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\s*\/?>/g, ' ')
        .replace(/\{\w+\}/g, ' ')
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ') /* a URL is typed, not read */;
      for (const word of prose.match(/[A-Za-z][A-Za-z']+/g) || []) {
        if (!ALLOWED.has(word.toLowerCase())) stray.push(`${key}: ${word}`);
      }
    }
    assert.deepEqual(
      stray,
      [],
      `English left in the translation. Translate it, or add the token to LATIN_OK:\n  ${stray.join('\n  ')}`,
    );
  });
}
