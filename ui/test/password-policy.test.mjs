import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  PASSWORD_MIN,
  PASSWORD_MAX,
  REFUSAL_KEYS,
  contextWords,
  meterColor,
  passwordLength,
  passwordMeter,
  passwordMismatch,
  passwordProblem,
} from '../js/password-policy.js';

test('the minimum is 15 characters and the maximum 1024', () => {
  assert.equal(PASSWORD_MIN, 15);
  assert.equal(PASSWORD_MAX, 1024);
  assert.equal(passwordProblem('a'.repeat(14) + 'b'), '');
  assert.equal(passwordProblem('a'.repeat(13) + 'b'), 'short');
  assert.equal(passwordProblem('ab'.repeat(512)), '');
  assert.equal(passwordProblem('ab'.repeat(512) + 'c'), 'long');
});

test('length counts code points with accents composed', () => {
  assert.equal(passwordLength('\u{1F600}'.repeat(8)), 8);
  assert.equal(passwordProblem('\u{1F600}'.repeat(8)), 'short');
  assert.equal(passwordLength('café'), 4);
});

test('no character-type rule: long lowercase passes, short mixed fails', () => {
  assert.equal(passwordProblem('bluewhalesswimfar'), '');
  assert.equal(passwordProblem('P@ssw0rd1!'), 'short');
});

test('a password made only of the service or host words is too easy to guess', () => {
  const words = contextWords('dash.example.com');
  assert.ok(words.includes('stackyard') && words.includes('example') && words.includes('dash'));
  assert.equal(passwordProblem('Stackyard-Homelab-2025!', words), 'guessable');
  assert.equal(passwordProblem('DashExample-DashExample', words), 'guessable');
  assert.equal(passwordProblem('my stackyard garden shed', words), '');
  assert.equal(passwordProblem('483920175639201', words), '');
});

test('the meter fills toward the minimum and names the problem', () => {
  assert.deepEqual(
    { ...passwordMeter(''), refusalKey: undefined },
    { ok: false, lit: 0, tone: '', key: 'pwStrength.tip', vars: {}, refusalKey: undefined },
  );
  const half = passwordMeter('abcdefgh');
  assert.equal(half.key, 'pwStrength.count');
  assert.deepEqual(half.vars, { count: 8 });
  assert.equal(half.lit, 2);
  assert.equal(half.refusalKey, REFUSAL_KEYS.short);
  const ok = passwordMeter('correct horse battery');
  assert.equal(ok.ok, true);
  assert.equal(ok.lit, 5);
  assert.equal(ok.key, 'pwStrength.enough');
  assert.equal(passwordMeter('stackyardstackyard').key, REFUSAL_KEYS.guessable);
});

test('a meter colour is a theme token or nothing', () => {
  assert.equal(meterColor(''), '');
  for (const tone of ['short', 'bad', 'ok']) assert.match(meterColor(tone), /^var\(--[\w-]+\)$/);
});

test('every key the rules return exists in all locales', async () => {
  const keys = new Set(Object.values(REFUSAL_KEYS));
  for (const pw of ['', 'abc', 'correct horse battery', 'stackyardstackyard']) {
    const { key, vars } = passwordMeter(pw);
    keys.add(vars.count === undefined ? key : `${key}_other`);
  }
  const locales = (await readdir(new URL('../i18n/', import.meta.url))).filter(f => f.endsWith('.json'));
  assert.ok(locales.length >= 6);
  for (const file of locales) {
    const cat = JSON.parse(await readFile(new URL(`../i18n/${file}`, import.meta.url), 'utf8'));
    for (const key of keys) {
      const value = key.split('.').reduce((o, part) => (o == null ? o : o[part]), cat);
      assert.equal(typeof value, 'string', `${file} is missing ${key}`);
    }
  }
});

test('every password screen uses the shared rules', async () => {
  for (const file of ['dashboard.js', 'admin-auth.js', 'admin-settings.js', 'config-recovery.js']) {
    const src = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    assert.match(src, /password-policy\.js/, file);
    assert.doesNotMatch(src, /\.length\s*<\s*8\b/, `${file} keeps its own length rule`);
    assert.doesNotMatch(src, /hint\.style\.color/, `${file} colours the hint inline`);
  }
});

test('passwordMismatch compares exactly and ignores an empty new password', () => {
  assert.equal(passwordMismatch('correct-horse', 'correct-horse'), false);
  assert.equal(passwordMismatch('correct-horse', 'correct-hors'), true);
  assert.equal(passwordMismatch('', 'anything'), false);
  assert.equal(passwordMismatch('correct-horse', undefined), true);
  assert.equal(passwordMismatch('correct-horse', 'correct-horse '), true);
});

test('every catalog states the same minimum the rules enforce', async () => {
  const digits = { fa: '۱۵' };
  for (const file of (await readdir(new URL('../i18n/', import.meta.url))).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(await readFile(new URL(`../i18n/${file}`, import.meta.url), 'utf8'));
    const min = digits[file.replace('.json', '')] ?? String(PASSWORD_MIN);
    for (const v of [cat.pwStrength.tip, cat.pwStrength.count_other, cat.hostBlock.tooShort, cat.general.passwordPh]) {
      assert.ok(v.includes(min), `${file}: "${v}" must state ${min}`);
    }
  }
});

test('every meter draws as many bars as the rules fill, and its hint is announced', async () => {
  const full = passwordMeter('quiet otter lantern 42').lit;
  const admin = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../js/dashboard.js', import.meta.url), 'utf8');
  const meters = [
    [admin, 'sec-pw-bars', 'sec-pw-hint', 'id="sec-pw"'],
    [dashboard, 'setup-bars', 'setup-hint', 'id="setup-pw"'],
  ];
  for (const [src, bars, hint, field] of meters) {
    const row = src.match(new RegExp(`id="${bars}"[^>]*>((?:<(div|span) class="pwbar"></\\2>)*)`));
    assert.ok(row, bars);
    assert.equal(row[1].match(/pwbar/g).length, full, `${bars} must have ${full} bars`);
    assert.match(src, new RegExp(`id="${hint}"[^>]*role="status"`), `${hint} must be a status`);
    assert.match(src, new RegExp(`${field}[^>]*aria-describedby="${hint}"`), `${field} must point at ${hint}`);
  }
});
