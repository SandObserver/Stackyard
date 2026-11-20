/* A refused widget has to explain itself where it is missing from. Rendering
   the reason only in the config editor of an item already using that widget is
   the one case a new install cannot reach, so the reason stays in the container
   log. The wording and filtering are tested in admin-logic.test.mjs. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { state } = await import('../js/admin-state.js');
const { buildWidgetForm } = await import('../js/admin-widget-form.js');

const REFUSED = [
  { name: 'weather', errors: ['manifest: <b>fields</b> must be a list'] },
  { name: 'pihole', errors: ['entry: index.html is missing', 'size: "huge" is not a size'] },
];

/** The widget form for a new widget, or for `item`, with REFUSED on the server. */
function form(item = null) {
  state._widgetReg = Object.assign(Object.create(null), {
    clock: { name: 'clock', label: 'Clock', sizes: ['small', 'medium'], fields: [] },
  });
  state._widgetRejected = structuredClone(REFUSED);
  state._wtype = item?.widgetType || 'clock';
  state._wsize = 'medium';
  state._evSession += 1;
  const body = dom.document.createElement('div');
  dom.document.body.appendChild(body);
  buildWidgetForm(body, item);
  return body;
}

const lists = body => body.querySelectorAll('.cfg-reject-list');

test('the picker says how many widgets were refused, and why each one was', () => {
  const body = form();
  const note = body.querySelectorAll('p.grp-tip').find(p => p.textContent === t('widgetCfg.refused', { count: 2 }));
  assert.ok(note, 'the picker does not show the count notice');
  assert.equal(lists(body).length, 1);
  assert.deepEqual(
    lists(body)[0]
      .querySelectorAll('li')
      .map(li => li.textContent),
    [
      'weather: manifest: <b>fields</b> must be a list',
      'pihole: entry: index.html is missing',
      'pihole: size: "huge" is not a size',
    ],
  );
});

test('the notice renders between the type list and the size section', () => {
  const body = form();
  const order = [];
  const walk = n => {
    for (const c of n.children) {
      if (c.id === 'wtype-row') order.push('type');
      if (c.classList.contains('cfg-reject-list')) order.push('reasons');
      if (c.tagName === 'H2' && c.textContent === t('widgetCfg.size')) order.push('size');
      walk(c);
    }
  };
  walk(body);
  assert.deepEqual(order, ['type', 'reasons', 'size']);
});

test('an item whose widget was refused shows its own reasons, without its name', () => {
  const body = form({ id: 'w', type: 'widget', widgetType: 'pihole', label: 'Pi-hole', widgetSize: 'medium' });
  const own = lists(body)
    .at(-1)
    .querySelectorAll('li')
    .map(li => li.textContent);
  assert.deepEqual(own, ['entry: index.html is missing', 'size: "huge" is not a size']);
});

/* A validator message is built from names taken out of the manifest. */
test('a reason is written as text, never as markup', () => {
  const body = form();
  const li = lists(body)[0].querySelector('li');
  assert.equal(li.querySelector('b'), null);
  assert.match(li.textContent, /<b>fields<\/b>/);
});
