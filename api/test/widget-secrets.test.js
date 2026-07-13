const { test } = require('node:test');
const assert = require('node:assert/strict');
const { secretSpec, scrubWidgetSecrets, preserveWidgetSecrets } = require('../src/widget-secrets');

const ENTRY = {
  manifest: {
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'host', type: 'text', label: 'Host' },
      { key: 'accounts', type: 'group', label: 'Accounts', fields: [
        { key: 'token', type: 'secret', label: 'Token' },
        { key: 'label', type: 'text', label: 'Label' },
      ] },
    ],
  },
};

test('secretSpec collects top-level and group secret keys', () => {
  const spec = secretSpec(ENTRY);
  assert.deepEqual(spec.topLevel, ['apiKey']);
  assert.deepEqual(spec.groups, { accounts: ['token'] });
});

test('scrubWidgetSecrets replaces a top-level secret with a Set flag', () => {
  const item = { widgetType: 'x', widgetConfig: { apiKey: 'super-secret', host: 'example.com' } };
  scrubWidgetSecrets(item, ENTRY);
  assert.equal(item.widgetConfig.apiKey, undefined);
  assert.equal(item.widgetConfig.apiKeySet, true);
  assert.equal(item.widgetConfig.host, 'example.com');
});

test('scrubWidgetSecrets scrubs secrets inside group rows', () => {
  const item = { widgetType: 'x', widgetConfig: { accounts: [
    { token: 'tok-1', label: 'Primary' },
    { token: 'tok-2', label: 'Backup' },
  ] } };
  scrubWidgetSecrets(item, ENTRY);
  for (const row of item.widgetConfig.accounts) {
    assert.equal(row.token, undefined);
    assert.equal(row.tokenSet, true);
  }
  assert.equal(item.widgetConfig.accounts[0].label, 'Primary');
});

test('scrubWidgetSecrets is a no-op for items without widgetConfig', () => {
  const item = { widgetType: 'x' };
  assert.doesNotThrow(() => scrubWidgetSecrets(item, ENTRY));
});

test('preserveWidgetSecrets restores a secret omitted by the browser', () => {
  const oldItem = { widgetConfig: { apiKey: 'super-secret', host: 'old.example.com' } };
  const newItem = { widgetConfig: { host: 'new.example.com' } };
  preserveWidgetSecrets(newItem, oldItem, ENTRY);
  assert.equal(newItem.widgetConfig.apiKey, 'super-secret');
  assert.equal(newItem.widgetConfig.apiKeySet, true);
  assert.equal(newItem.widgetConfig.host, 'new.example.com');
});

test('preserveWidgetSecrets keeps a newly submitted secret instead of the old one', () => {
  const oldItem = { widgetConfig: { apiKey: 'old-secret' } };
  const newItem = { widgetConfig: { apiKey: 'new-secret' } };
  preserveWidgetSecrets(newItem, oldItem, ENTRY);
  assert.equal(newItem.widgetConfig.apiKey, 'new-secret');
  assert.equal(newItem.widgetConfig.apiKeySet, true);
});

test('preserveWidgetSecrets matches group rows by position', () => {
  const oldItem = { widgetConfig: { accounts: [
    { token: 'tok-1', label: 'Primary' },
    { token: 'tok-2', label: 'Backup' },
  ] } };
  const newItem = { widgetConfig: { accounts: [
    { label: 'Primary renamed' },
    { token: 'tok-2-new', label: 'Backup' },
  ] } };
  preserveWidgetSecrets(newItem, oldItem, ENTRY);
  assert.equal(newItem.widgetConfig.accounts[0].token, 'tok-1');
  assert.equal(newItem.widgetConfig.accounts[0].tokenSet, true);
  assert.equal(newItem.widgetConfig.accounts[1].token, 'tok-2-new');
  assert.equal(newItem.widgetConfig.accounts[1].tokenSet, true);
});

test('preserveWidgetSecrets is a no-op for items without widgetConfig', () => {
  const newItem = { widgetType: 'x' };
  assert.doesNotThrow(() => preserveWidgetSecrets(newItem, { widgetConfig: { apiKey: 'x' } }, ENTRY));
  assert.equal(newItem.widgetConfig, undefined);
});

/* Entry exercising an object field (secret nested one level) and a group whose
   rows carry ids (so preserve matches by id, not position). */
const ENTRY2 = {
  manifest: {
    fields: [
      { key: 'network', type: 'object', label: 'Network', fields: [
        { key: 'pass', type: 'secret', label: 'Password' },
      ] },
      { key: 'services', type: 'group', label: 'Services', fields: [
        { key: 'token', type: 'secret', label: 'Token' },
      ] },
    ],
  },
};

test('secretSpec collects object secret keys', () => {
  const spec = secretSpec(ENTRY2);
  assert.deepEqual(spec.objects, { network: ['pass'] });
  assert.deepEqual(spec.groups, { services: ['token'] });
});

test('scrubWidgetSecrets scrubs a secret nested in an object field', () => {
  const item = { widgetType: 'x', widgetConfig: { network: { pass: 'hunter2', enabled: true } } };
  scrubWidgetSecrets(item, ENTRY2);
  assert.equal(item.widgetConfig.network.pass, undefined);
  assert.equal(item.widgetConfig.network.passSet, true);
  assert.equal(item.widgetConfig.network.enabled, true);
});

test('preserveWidgetSecrets restores an object secret omitted by the browser', () => {
  const oldItem = { widgetConfig: { network: { pass: 'hunter2', enabled: true } } };
  const newItem = { widgetConfig: { network: { enabled: false } } };
  preserveWidgetSecrets(newItem, oldItem, ENTRY2);
  assert.equal(newItem.widgetConfig.network.pass, 'hunter2');
  assert.equal(newItem.widgetConfig.network.passSet, true);
  assert.equal(newItem.widgetConfig.network.enabled, false);
});

test('preserveWidgetSecrets matches group rows by id regardless of order', () => {
  const oldItem = { widgetConfig: { services: [
    { id: 'a', token: 'tok-a' },
    { id: 'b', token: 'tok-b' },
  ] } };
  /* Rows reordered and one omits its token; id matching must still restore the
     right secret to each row rather than lining them up by position. */
  const newItem = { widgetConfig: { services: [
    { id: 'b', token: 'tok-b-new' },
    { id: 'a' },
  ] } };
  preserveWidgetSecrets(newItem, oldItem, ENTRY2);
  assert.equal(newItem.widgetConfig.services[0].token, 'tok-b-new');
  assert.equal(newItem.widgetConfig.services[1].token, 'tok-a');
  assert.equal(newItem.widgetConfig.services[1].tokenSet, true);
});
