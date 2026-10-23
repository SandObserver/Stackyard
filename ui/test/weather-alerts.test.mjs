import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ICONS } from '../js/icon-set.js';

const page = fs.readFileSync(new URL('../widgets/weather/index.html', import.meta.url), 'utf8');
const data = fs.readFileSync(new URL('../widgets/weather/data.js', import.meta.url), 'utf8');
const dir = new URL('../widgets/weather/i18n/', import.meta.url);

const section = /\/\* ---- UV and air quality alerts ---- \*\/[\s\S]*?\nfunction alertText\([\s\S]*?\n\}/.exec(
  page,
)?.[0];
const wt = (key, fallback, vars = {}) => fallback.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const { BAND, LEVEL_INK, LEVEL_INK_DAY, validAlert, alertText } = new Function(
  'wt',
  'formatNumber',
  `${section}; return { BAND, LEVEL_INK, LEVEL_INK_DAY, validAlert, alertText };`,
)(wt, String);

const served = [...data.matchAll(/\[\d+, '(\w+)', (\d)\]/g)].map(([, band, level]) => ({ band, level: +level }));

test('every band the data function sends has a label, a colour and a string in every language', () => {
  assert.ok(served.length >= 11);
  for (const { band, level } of served) {
    assert.ok(Object.hasOwn(BAND, band), band);
    assert.ok(LEVEL_INK[level], `${band} level ${level}`);
  }
  for (const file of fs.readdirSync(dir)) {
    const strings = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'));
    for (const key of ['ui.uvShort', 'ui.airShort', 'ui.uvAlert', 'ui.airAlert', 'ui.withAlert'])
      assert.ok(strings[key], `${file} has no ${key}`);
    for (const { band } of served) assert.ok(strings[`ui.${band}`], `${file} has no ui.${band}`);
  }
});

const luminance = hex =>
  [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every severity colour keeps 3:1 against the card it is drawn on', () => {
  for (const { band, level } of served) {
    assert.ok(contrast(LEVEL_INK_DAY[level], '#ffffff') >= 3, `${band} on the day card`);
    assert.ok(contrast(LEVEL_INK[level], '#1c1c1e') >= 3, `${band} on the night card`);
  }
});

test('the spoken alert names the value and its band', () => {
  assert.equal(alertText({ kind: 'uv', value: 8, band: 'veryHigh', level: 3 }), 'UV index 8, very high');
  assert.equal(
    alertText({ kind: 'air', scale: 'us', value: 130, band: 'sensitive', level: 2 }),
    'Air quality index 130, unhealthy for sensitive groups',
  );
});

test('an alert the page cannot draw is dropped', () => {
  assert.ok(validAlert({ kind: 'uv', value: 3, band: 'moderate', level: 1 }));
  assert.ok(!validAlert({ kind: 'pollen', value: 3, band: 'moderate', level: 1 }));
  assert.ok(!validAlert({ kind: 'uv', value: 3, band: 'toString', level: 1 }));
  assert.ok(!validAlert({ kind: 'uv', value: 3, band: 'moderate', level: 9 }));
  assert.ok(!validAlert({ kind: 'air', value: '3', band: 'poor', level: 2 }));
});

test('the label shows on hover only where the pointer can hover', () => {
  assert.match(page, /@media\(hover:hover\)\{\.widget:hover \.aq-cap\{/);
  assert.doesNotMatch(page.replace(/@media\(hover:hover\)\{[^}]*\}\}/, ''), /:hover \.aq-cap/);
});

test('the alert icons exist in the set with one accent part each', () => {
  for (const id of ['uv', 'air']) {
    assert.ok(ICONS[id], id);
    assert.equal(ICONS[id].shapes.filter(p => p.role === 'a').length, 1, id);
  }
});
