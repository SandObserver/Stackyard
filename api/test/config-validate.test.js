const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { firstBadItemField, takesReservedId, firstBadFolderChild, firstBadSetting } = require('../src/config-validate');

test('item fields of the wrong type are named', () => {
  const cases = [
    [{ label: 7 }, 'label'],
    [{ href: 5 }, 'href'],
    [{ iconUrl: 5 }, 'iconUrl'],
    [{ iconUrl: {} }, 'iconUrl'],
    [{ color: [] }, 'color'],
    [{ widgetType: { a: 1 } }, 'widgetType'],
    [{ widgetSize: 'huge' }, 'widgetSize'],
    [{ widgetSize: 9 }, 'widgetSize'],
    [{ widgetConfig: 'x' }, 'widgetConfig'],
    [{ widgetConfig: [1] }, 'widgetConfig'],
    [{ badge: 7 }, 'badge'],
    [{ monitoring: 'x' }, 'monitoring'],
    [{ monitoring: { healthcheck: 7 } }, 'monitoring.healthcheck'],
    [{ monitoring: { activity: 'x' } }, 'monitoring.activity'],
    [{ monitoring: { staticBadge: 's' } }, 'monitoring.staticBadge'],
    [{ monitoring: { staticBadge: { enabled: true, label: 5 } } }, 'monitoring.staticBadge.label'],
    [{ monitoring: { activity: { custom: 'x' } } }, 'monitoring.activity.custom'],
    [{ monitoring: { activity: { custom: { unit: 5 } } } }, 'monitoring.activity.custom.unit'],
  ];
  for (const [item, field] of cases) assert.equal(firstBadItemField(item), field, JSON.stringify(item));
});

test('items the editor writes pass', () => {
  const app = {
    id: 'a',
    type: 'app',
    label: 'A',
    href: 'https://a.invalid',
    iconUrl: undefined,
    color: 'dark',
    monitoring: {
      healthcheck: { enabled: false },
      activity: { enabled: false, custom: undefined },
      staticBadge: { enabled: true, label: 'New', color: 'blue' },
    },
  };
  assert.equal(firstBadItemField(app), null);
  for (const widgetSize of ['small', 'medium', 'large', 'xlarge', undefined, null])
    assert.equal(firstBadItemField({ type: 'widget', widgetType: 'clock', widgetSize, widgetConfig: {} }), null);
});

test('the shipped demo config passes every rule', () => {
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-config.json'), 'utf8'));
  const byId = new Map(demo.items.map(i => [i.id, i]));
  for (const item of demo.items) {
    assert.equal(firstBadItemField(item), null, item.id);
    assert.equal(takesReservedId(item), false, item.id);
    if (item.children) assert.equal(firstBadFolderChild(item, byId), null, item.id);
  }
  assert.equal(firstBadSetting(demo.settings), null);
});

test('only the Settings tile may take the id settings', () => {
  assert.equal(takesReservedId({ id: 'settings', type: 'app' }), true);
  assert.equal(takesReservedId({ id: 'settings', type: 'app', system: 'settings' }), false);
  assert.equal(takesReservedId({ id: 'other', type: 'app' }), false);
});

test('a folder holds apps only', () => {
  const byId = new Map([
    ['a', { id: 'a', type: 'app' }],
    ['settings', { id: 'settings', type: 'app', system: 'settings' }],
    ['w', { id: 'w', type: 'widget' }],
    ['f', { id: 'f', type: 'folder', children: ['f'] }],
    ['g', { id: 'g', type: 'folder', children: ['h'] }],
    ['h', { id: 'h', type: 'folder', children: ['g'] }],
  ]);
  assert.equal(firstBadFolderChild({ children: ['a', 'settings'] }, byId), null);
  assert.equal(firstBadFolderChild({ children: ['w'] }, byId), 'w');
  assert.equal(firstBadFolderChild(byId.get('f'), byId), 'f');
  assert.equal(firstBadFolderChild(byId.get('g'), byId), 'h');
});

test('settings blocks of the wrong type are named', () => {
  assert.equal(firstBadSetting({ background: 'x' }), 'background');
  assert.equal(firstBadSetting({ background: [] }), 'background');
  assert.equal(firstBadSetting({ background: { url: {} } }), 'background.url');
  assert.equal(firstBadSetting({ server: 'z' }), 'server');
  assert.equal(firstBadSetting({ server: { proxmox: 'x' } }), 'server.proxmox');
  assert.equal(firstBadSetting({ background: { type: 'url', url: '/x' }, server: { proxmox: {} } }), null);
  assert.equal(firstBadSetting(undefined), null);
});
