import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import {
  DAMAGE_CODES,
  fillNames,
  pickLanguage,
  readConfigDamage,
  recoverySteps,
  screenFor,
} from '../js/config-recovery-logic.js';

const en = JSON.parse(fs.readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8'));

test('reads the damage the API reports', () => {
  assert.deepEqual(
    readConfigDamage({
      code: DAMAGE_CODES.corrupt,
      detail: { file: 'apps.json', backup: 'apps.json.corrupt-2026-09-30T10-00-00-000Z' },
    }),
    { reason: 'corrupt', file: 'apps.json', backup: 'apps.json.corrupt-2026-09-30T10-00-00-000Z' },
  );
  assert.deepEqual(readConfigDamage({ code: DAMAGE_CODES.unreadable, detail: { file: 'config.json' } }), {
    reason: 'unreadable',
    file: 'config.json',
    backup: null,
  });
});

test('ignores any other error', () => {
  for (const body of [null, 'x', {}, { code: 'internal' }, { code: 'blocked.private-address' }])
    assert.equal(readConfigDamage(body), null);
});

test('keeps any plain file name, and drops one with a path or control character', () => {
  assert.equal(readConfigDamage({ code: DAMAGE_CODES.corrupt, detail: { file: 'my apps.json' } }).file, 'my apps.json');
  for (const file of ['../etc/passwd', 'a\\b', 'a\u0001b', '', 'x'.repeat(256)])
    assert.equal(readConfigDamage({ code: DAMAGE_CODES.corrupt, detail: { file } }).file, 'apps.json', file);
});

test('names are escaped once and can never add a tag', () => {
  const escapeName = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sanitize = s => s.replace(/<(?!\/?code>)/g, '&lt;');
  const out = fillNames(
    v => `Open <code>${v.backup}</code> as <code>${v.file}</code>`,
    { file: 'a&b.json', backup: '<img src=x onerror=alert(1)></code>' },
    sanitize,
    escapeName,
  );
  assert.equal(out, 'Open <code>&lt;img src=x onerror=alert(1)&gt;&lt;/code&gt;</code> as <code>a&amp;b.json</code>');
});

test('the steps name the backup when one was written', () => {
  const keys = recoverySteps({ reason: 'corrupt', file: 'apps.json', backup: 'b' }).map(s => s.key);
  assert.deepEqual(keys, [
    'configRecovery.stepRepairBackup',
    'configRecovery.stepExport',
    'configRecovery.stepStartOver',
    'configRecovery.stepCheck',
  ]);
  const noBackup = recoverySteps({ reason: 'corrupt', file: 'apps.json', backup: null }).map(s => s.key);
  assert.equal(noBackup[0], 'configRecovery.stepRepair');
  const unreadable = recoverySteps({ reason: 'unreadable', file: 'apps.json', backup: null }).map(s => s.key);
  assert.deepEqual(unreadable, [
    'configRecovery.stepPermissions',
    'configRecovery.stepStartOver',
    'configRecovery.stepCheck',
  ]);
});

test('every placeholder a step fills is in its English text', () => {
  for (const reason of ['corrupt', 'unreadable']) {
    for (const backup of ['b', null]) {
      for (const { key, vars } of recoverySteps({ reason, file: 'f', backup })) {
        const text = en.configRecovery[key.split('.')[1]];
        assert.ok(text, key);
        for (const name of Object.keys(vars || {})) assert.match(text, new RegExp(`\\{${name}\\}`), key);
      }
    }
  }
});

test('picks the browser language Stackyard ships, else English', async () => {
  register('./js-root-hooks.mjs', import.meta.url);
  const supported = (await import('../js/i18n.js')).LANGUAGES.map(l => l.code);
  assert.equal(pickLanguage(['de-AT', 'en'], supported), 'de');
  assert.equal(pickLanguage(['zh-CN'], supported), 'zh-Hans');
  assert.equal(pickLanguage(['ja', 'fr-CA'], supported), 'fr');
  assert.equal(pickLanguage(['ja'], supported), 'en');
  assert.equal(pickLanguage([], supported), 'en');
});

test('the refused-address and damaged-password screens offer the setup form, each with its own help', () => {
  const host = screenFor({ code: 'blocked.host', detail: { host: 'x.example' } });
  const damaged = screenFor({ code: 'auth.password-damaged', kind: 'auth' });
  assert.equal(host.setup, true);
  assert.equal(damaged.setup, true);
  assert.equal(screenFor({ code: DAMAGE_CODES.corrupt, detail: { file: 'apps.json' } }).setup, false);
  assert.notEqual(host.setupHelp, damaged.setupHelp);
  const has = key => key.split('.').reduce((o, k) => o?.[k], en) !== undefined;
  for (const key of [
    damaged.title,
    damaged.why.key,
    damaged.safe,
    damaged.still,
    damaged.setupHelp,
    damaged.stepsTitle,
  ])
    assert.ok(has(key), key);
  assert.equal(screenFor({ code: 'auth', kind: 'auth' }), null);
});

test('a refused request that came through a proxy says so, and names the same host', () => {
  const direct = screenFor({ code: 'blocked.host', detail: { host: '10.0.0.5' } });
  const proxied = screenFor({ code: 'blocked.host', detail: { host: '10.0.0.5', proxied: true } });
  assert.equal(direct.why.key, 'hostBlock.why');
  assert.equal(proxied.why.key, 'hostBlock.whyProxied');
  assert.deepEqual(proxied.why.vars, { host: '10.0.0.5' });
  assert.equal(screenFor({ code: 'blocked.host', detail: { host: 'x', proxied: 'yes' } }).why.key, 'hostBlock.why');
});

function fakePage() {
  const written = [];
  class El {
    children = [];
    classList = { add() {} };
    elements = { namedItem: () => new El() };
    set innerHTML(v) {
      written.push(v);
    }
    querySelector() {
      return new El();
    }
    querySelectorAll() {
      return [];
    }
    addEventListener() {}
    setAttribute() {}
    focus() {}
  }
  const body = new El();
  body.replaceChildren = (...nodes) => {
    body.children = nodes;
  };
  body.prepend = node => body.children.unshift(node);
  globalThis.document = {
    body,
    title: '',
    documentElement: { setAttribute() {} },
    createElement: () => new El(),
    getElementById: id => body.children.find(c => c.id === id) || null,
    importNode: n => n,
  };
  globalThis.DOMParser = class {
    parseFromString(src) {
      return { documentElement: { id: src.match(/ id="([^"]+)"/)[1], src } };
    }
  };
  globalThis.location = { host: 'x.example', hostname: 'x.example', search: '' };
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'] }, configurable: true });
  globalThis.fetch = async () => ({ ok: true, json: async () => en });
  return { body, written };
}

test('every icon on the setup screen, and the one the reveal swaps to, is in the page after it shows', async () => {
  register('./js-root-hooks.mjs', import.meta.url);
  const page = fakePage();
  const { ensureSprite } = await import('../js/icon-set.js');
  const { showBlockingScreen } = await import('../js/config-recovery.js');
  ensureSprite();
  await showBlockingScreen(screenFor({ code: 'blocked.host', detail: { host: 'x.example' } }));
  const refs = [...page.written.join('').matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.includes('sy-solid-eye'), 'the setup form draws no eye');
  const defined = page.body.children.map(c => c.src || '').join('');
  for (const id of [...refs, 'sy-solid-eye-slash'])
    assert.ok(defined.includes(` id="${id}"`), `#${id} points at nothing`);
});
