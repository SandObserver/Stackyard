import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DAMAGE_CODES,
  fillNames,
  pickLanguage,
  readConfigDamage,
  recoverySteps,
  screenFor,
  setupCodeErrorKey,
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

test('picks the browser language Stackyard ships, else English', () => {
  const supported = ['en', 'fa', 'zh-Hans', 'es', 'de', 'fr'];
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

test('a refused setup names the right fix', () => {
  assert.equal(setupCodeErrorKey({ code: 'invalid.setup-code' }), 'hostBlock.codeWrong');
  assert.equal(setupCodeErrorKey({ code: 'invalid.password-short' }), 'hostBlock.tooShort');
  assert.equal(setupCodeErrorKey({ code: 'invalid.password-long' }), 'hostBlock.tooLong');
  assert.equal(setupCodeErrorKey({ code: 'invalid' }), 'setup.failed');
  assert.equal(setupCodeErrorKey(null), 'setup.failed');
});
