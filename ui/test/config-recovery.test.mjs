import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DAMAGE_CODES, pickLanguage, readConfigDamage, recoverySteps } from '../js/config-recovery-logic.js';

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

test('drops a name that could carry markup', () => {
  const read = readConfigDamage({
    code: DAMAGE_CODES.corrupt,
    detail: { file: '<img src=x onerror=alert(1)>', backup: 'a</code><b>' },
  });
  assert.deepEqual(read, { reason: 'corrupt', file: 'apps.json', backup: null });
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
