import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

async function openAdmin() {
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  const i18n = await import('../js/i18n.js');
  await i18n.initI18n('en');
  return { dom, t: i18n.t };
}

test('the app editor marks its required fields for sight and for assistive technology', async () => {
  const { dom, t } = await openAdmin();
  try {
    const { state } = await import('../js/admin-state.js');
    const { openEditor } = await import('../js/admin-editor.js');
    state.items = [];
    openEditor(null);
    const body = dom.document.getElementById('ev-body');
    for (const [rowId, inputId, label] of [
      ['ie-name', 'f-lbl', t('app.name')],
      ['ie-url', 'f-href', t('app.url')],
    ]) {
      const row = dom.document.getElementById(rowId);
      const mark = row.querySelector('.rl .req');
      assert.ok(mark, `${rowId} shows no required mark`);
      assert.equal(mark.getAttribute('aria-hidden'), 'true', 'a screen reader reads the mark as "star"');
      assert.equal(dom.document.getElementById(inputId).getAttribute('aria-required'), 'true');
      assert.equal(
        row.querySelector('.pe').getAttribute('aria-label'),
        t('common.editNamed', { name: label }),
        'the pencil name carries the mark',
      );
    }
    const legends = body.querySelectorAll('.req-legend');
    assert.equal(legends.length, 1, 'one explanation per form');
    assert.match(legends[0].textContent, new RegExp(`\\* ${t('common.required')}$`));
    assert.equal(legends[0].querySelector('.req').getAttribute('aria-hidden'), 'true');
  } finally {
    await settle(100);
    dom.restore();
  }
});

test('every required mark is hidden from assistive technology', () => {
  for (const f of ['js/widget-config-form.js', 'js/admin-app-form.js', 'js/admin-widget-form.js']) {
    assert.doesNotMatch(read(f), /<span class="req">/, f);
  }
  const form = read('js/widget-config-form.js');
  assert.match(form, /autocomplete="off"\$\{_ariaRequired\(!field\.optional\)\}/);
  assert.match(form, /autocomplete="new-password"\$\{_ariaRequired\(!field\.optional && !isSet\)\}/);
  assert.match(read('js/admin-widget-form.js'), /id="f-url"[^>]*aria-required="true"/);
  assert.match(read('js/admin-app-form.js'), /id="f-fname"[^>]*aria-required="true"/);
});

test('a field hint is read with the field, and a second description is kept', async () => {
  const { dom } = await openAdmin();
  try {
    const { renderWidgetConfigForm } = await import('../js/widget-config-form.js');
    const box = dom.document.createElement('div');
    dom.document.body.appendChild(box);
    renderWidgetConfigForm(box, [
      { key: 'host', label: 'Host', type: 'text', hint: 'The address of the server.' },
      { key: 'tls', label: 'Use TLS', type: 'toggle', hint: 'Needs a certificate.' },
    ]);
    const tips = box.querySelectorAll('.grp-tip');
    assert.equal(tips.length, 2);
    const [hostTip, tlsTip] = tips;
    assert.ok(hostTip.id && tlsTip.id);
    const input = box.querySelector('.row-inp');
    assert.deepEqual(input.getAttribute('aria-describedby').split(' '), [hostTip.id]);
    assert.deepEqual(box.querySelector('.pe').getAttribute('aria-describedby').split(' '), [hostTip.id]);
    assert.equal(box.querySelector('input[type="checkbox"]').getAttribute('aria-describedby'), tlsTip.id);

    const { setTogDisabled, showFieldError } = await import('../js/admin-shared.js');
    const sw = box.querySelector('input[type="checkbox"]');
    setTogDisabled(sw, true, 'dock-tip');
    assert.deepEqual(sw.getAttribute('aria-describedby').split(' '), [tlsTip.id, 'dock-tip']);
    setTogDisabled(sw, false, 'dock-tip');
    assert.equal(sw.getAttribute('aria-describedby'), tlsTip.id, 're-enabling dropped the hint');

    showFieldError(box.querySelector('.row'), 'Enter a value for Host.', { focus: false });
    const ids = input.getAttribute('aria-describedby').split(' ');
    assert.equal(ids[0], hostTip.id, 'the error replaced the hint');
    assert.equal(ids.length, 2);
  } finally {
    await settle(100);
    dom.restore();
  }
});

const manifest = name => JSON.parse(read(`widgets/${name}/widget.json`)).fields;

async function finishingAnimations() {
  const { FakeElement } = await import('./fake-dom.mjs');
  const animate = FakeElement.prototype.animate;
  FakeElement.prototype.animate = function () {
    const a = { cancel() {}, finish() {}, onfinish: null, oncancel: null, finished: Promise.resolve() };
    queueMicrotask(() => a.onfinish?.());
    return a;
  };
  return () => {
    FakeElement.prototype.animate = animate;
  };
}

test('a group form keeps one Required note outside its rows through Add and Remove', async () => {
  const { dom, t } = await openAdmin();
  const unpatch = await finishingAnimations();
  try {
    const { renderWidgetConfigForm } = await import('../js/widget-config-form.js');
    const { syncRequiredLegend } = await import('../js/admin-shared.js');
    const body = dom.document.createElement('div');
    const form = dom.document.createElement('div');
    body.appendChild(form);
    dom.document.body.appendChild(body);
    renderWidgetConfigForm(form, manifest('dashboard-switch'), {});
    syncRequiredLegend(body);
    const legends = () => body.querySelectorAll('.req-legend');
    const check = when => {
      assert.equal(legends().length, 1, `${when}: ${legends().length} notes`);
      assert.equal(legends()[0].textContent, `* ${t('common.required')}`);
      assert.ok(legends()[0].parentElement === form, `${when}: the note sits among the rows`);
    };
    check('first render');
    body.querySelector('.wcf-add-row').click();
    check('after Add');
    [...body.querySelectorAll('.grp-hdr-rm')].find(b => !b.disabled).click();
    await settle(20);
    check('after Remove');
  } finally {
    unpatch();
    await settle(100);
    dom.restore();
  }
});

test('a group that starts empty shows the Required note once a row is added, and drops it when the last goes', async () => {
  const { dom } = await openAdmin();
  const unpatch = await finishingAnimations();
  try {
    const { renderWidgetConfigForm } = await import('../js/widget-config-form.js');
    const { syncRequiredLegend } = await import('../js/admin-shared.js');
    const body = dom.document.createElement('div');
    dom.document.body.appendChild(body);
    const group = { key: 'rows', label: 'Row', type: 'group', fields: [{ key: 'url', label: 'URL', type: 'text' }] };
    renderWidgetConfigForm(body, [group], {});
    syncRequiredLegend(body);
    assert.equal(body.querySelectorAll('.req-legend').length, 0);
    body.querySelector('.wcf-add-row').click();
    assert.equal(body.querySelectorAll('.req-legend').length, 1, 'no note for the added required field');
    body.querySelector('.grp-hdr-rm').click();
    await settle(20);
    assert.equal(body.querySelectorAll('.req-legend').length, 0, 'the note outlived the last required field');
  } finally {
    unpatch();
    await settle(100);
    dom.restore();
  }
});

test('the hint of a select that fetches its options is read with the picker, and Fetch still reports', async () => {
  const { dom, t } = await openAdmin();
  try {
    const { renderWidgetConfigForm } = await import('../js/widget-config-form.js');
    const field = manifest('system-summary').find(f => f.key === 'beszelSystem');
    assert.ok(field?.optionsFrom && field.hint, 'the manifest field no longer fetches with a hint');
    const box = dom.document.createElement('div');
    dom.document.body.appendChild(box);
    renderWidgetConfigForm(box, [field], {}, { widgetId: 'w1', widgetType: 'system-summary' });
    const picker = box.querySelector('.row button');
    const ids = (picker.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    const hints = ids.map(id => dom.document.getElementById(id)?.textContent);
    assert.ok(hints.includes(field.hint), `the picker is described by ${JSON.stringify(hints)}`);
    const status = box.querySelector('.row-status');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.textContent, '', 'the hint is shown twice');
    const fetchBtn = box.querySelector('.row-btn');
    fetchBtn.click();
    assert.equal(status.textContent, t('widgetCfg.fetching'));
    await settle(50);
    assert.notEqual(status.textContent, t('widgetCfg.fetching'), 'Fetch never reported');
    assert.equal(box.querySelectorAll('.grp-tip').length, 1);
    assert.ok(
      (picker.getAttribute('aria-describedby') || '')
        .split(' ')
        .some(id => dom.document.getElementById(id)?.textContent === field.hint),
      'a Fetch unlinked the hint',
    );
  } finally {
    await settle(100);
    dom.restore();
  }
});

test('the Settings hints are linked to the fields they explain', () => {
  const html = read('admin/index.html');
  for (const [input, tip] of [
    ['srv-ip', 'host-ip-tip'],
    ['srv-socket', 'socket-hint'],
    ['srv-pve-token', 'pve-hint'],
    ['srv-hosts', 'hosts-tip'],
  ]) {
    assert.match(html, new RegExp(`<input id="${input}"[^>]*aria-describedby="${tip}"`), input);
    assert.match(html, new RegExp(`<p class="grp-tip" id="${tip}"`), tip);
  }
});

test('a poll interval out of range is refused, not changed', async () => {
  const { buildAppItem, pollSeconds, POLL_MIN, POLL_MAX } = await import('../js/admin-save-logic.js');
  assert.equal(POLL_MIN, 10);
  assert.equal(POLL_MAX, 3600);
  for (const bad of ['', '  ', '5', '9', '3601', '12.5', 'abc', null, undefined])
    assert.equal(pollSeconds(bad), null, bad);
  for (const good of ['10', ' 45 ', '3600', 60]) assert.equal(pollSeconds(good), Number(good));
  const base = { label: 'A', href: 'http://a.local', actEn: true, actUrl: 'http://a.local/api' };
  assert.equal(buildAppItem({ ...base, actInt: '5' }).errorKey, 'toast.pollRange');
  assert.equal(buildAppItem({ ...base, actInt: '' }).errorKey, 'toast.pollRange');
  assert.equal(buildAppItem({ ...base, actInt: '45' }).item.monitoring.activity.interval, 45);
  const off = { ...base, actEn: false };
  assert.equal(buildAppItem({ ...off, actInt: '5' }).item.monitoring.activity.interval, 10);
  assert.equal(buildAppItem({ ...off, actInt: '' }).item.monitoring.activity.interval, 30);
});

test('with Live Activity off, a typed poll interval saves what it saved before', async () => {
  const { buildAppItem } = await import('../js/admin-save-logic.js');
  const before = typed => Math.max(10, Math.min(3600, Math.max(10, Number.parseInt(typed || '30', 10))));
  const off = { label: 'A', href: 'http://a.local', actEn: false, actUrl: 'http://a.local/api' };
  const now = typed => buildAppItem({ ...off, actInt: typed }).item.monitoring.activity.interval;
  for (const [typed, saved] of [
    ['0', 10],
    ['-5', 10],
    ['5', 10],
    ['10', 10],
    ['30', 30],
    ['3600', 3600],
    ['4000', 3600],
    ['1e3', 10],
    ['', 30],
  ]) {
    assert.equal(before(typed), saved, `reference for ${JSON.stringify(typed)}`);
    assert.equal(now(typed), saved, JSON.stringify(typed));
  }
  assert.ok(Number.isNaN(before('abc')), 'before, a non-number saved NaN');
  assert.equal(now('abc'), 30, 'a non-number falls back like an empty field');
});

test('saving an app with a short poll interval shows the error on the field', async () => {
  const { dom, t } = await openAdmin();
  try {
    const { state } = await import('../js/admin-state.js');
    const { openEditor, readItem } = await import('../js/admin-editor.js');
    state.items = [
      {
        id: 'nas',
        type: 'app',
        label: 'NAS',
        href: 'http://nas.local',
        monitoring: { activity: { enabled: true, url: 'http://nas.local/api', interval: 30 } },
      },
    ];
    openEditor('nas');
    const poll = dom.document.getElementById('f-bint');
    poll.value = '5';
    const row = dom.document.getElementById('poll-row').querySelector('.row');
    row.scrollIntoView = () => {};
    assert.equal(readItem(state.items[0]), undefined, 'the save went ahead');
    assert.ok(row.classList.contains('row-invalid'));
    assert.equal(row.nextElementSibling.textContent, t('toast.pollRange', { min: '10', max: '3,600' }));
    assert.equal(poll.getAttribute('aria-invalid'), 'true');
  } finally {
    await settle(100);
    dom.restore();
  }
});

test('the page title names the Settings section on screen', async () => {
  const { dom, t } = await openAdmin();
  try {
    const nav = await import('../js/admin-nav.js');
    nav.initNav();
    nav.titleSettingsPage();
    assert.equal(dom.document.title, t('nav.sectionTitle', { section: t('nav.general') }));
    assert.equal(dom.document.title, 'General · Stackyard Settings');
    dom.document.querySelector('.nl[data-sec="about"]').click();
    assert.equal(dom.document.title, 'About · Stackyard Settings');
  } finally {
    await settle(100);
    dom.restore();
  }
  assert.match(read('js/admin-page-load.js'), /titleSettingsPage\(\);/);
  assert.doesNotMatch(read('js/admin-page-load.js'), /document\.title = /);
});

test('a slow row action announces Working after its status line is in place', async () => {
  const { dom, t } = await openAdmin();
  try {
    const { rowBusy } = await import('../js/admin-shared.js');
    const row = dom.document.createElement('div');
    row.className = 'row';
    const btns = dom.document.createElement('div');
    btns.className = 'row-btns';
    const btn = dom.document.createElement('button');
    btns.appendChild(btn);
    row.appendChild(btns);
    dom.document.body.appendChild(row);
    let open;
    const done = new Promise(r => {
      open = r;
    });
    const run = rowBusy(btn, () => done);
    const pending = run();
    await settle(320);
    const status = row.querySelector('.row-status');
    assert.ok(status, 'no status line after a slow start');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.textContent, '', 'the region was inserted with its text');
    await settle(150);
    assert.equal(status.textContent, t('common.working'));
    open();
    await pending;
    assert.equal(row.querySelector('.row-status'), null);
  } finally {
    await settle(100);
    dom.restore();
  }
});
