/* The dashboard entry file prepares the page, then boots, and shows the build
   error screen when the boot throws. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settle } from './fake-dom.mjs';
import { app, installDashboard } from './dashboard-page.mjs';

let seenAtBoot = null;
const { dom } = installDashboard({
  storage: { 'sy-transparency': 'reduce' },
  routes: {
    '/api/auth/check': () => {
      const root = globalThis.document.documentElement;
      seenAtBoot = {
        transparency: root.getAttribute('data-transparency'),
        sprite: !!globalThis.document.getElementById('sy-sprite'),
      };
      return { enabled: false, setupPrompted: true, passwordSet: true };
    },
    '/api/config': { items: [app('a')], settings: { language: 'en' } },
  },
});
const meta = dom.document.createElement('meta');
meta.setAttribute('name', 'viewport');
meta.setAttribute('content', 'width=device-width');
dom.document.head.appendChild(meta);
dom.document.getElementById('mob-pager').remove();
/** @type {any} */ (globalThis).__bootTimeoutMs = 15000;
const errors = [];
const consoleError = console.error;
console.error = (...a) => errors.push(a);
await import('../js/dashboard.js');
for (let i = 0; i < 6; i++) {
  await settle();
  dom.flushFrames();
}
console.error = consoleError;

test('the sprite and the transparency setting are in place before the first request', () => {
  assert.deepEqual(seenAtBoot, { transparency: 'reduce', sprite: true });
});

test('the viewport resizes the content when the keyboard opens', () => {
  assert.equal(meta.getAttribute('content'), 'width=device-width,interactive-widget=resizes-content');
});

test('a boot that throws shows the build error and lifts the veil', () => {
  const screen = dom.document.querySelector('.api-error-screen');
  assert.ok(screen, 'no error screen');
  assert.equal(screen.querySelector('a.api-error-btn')?.getAttribute('href'), '/admin/');
  assert.ok(dom.document.body.classList.contains('ready'));
  assert.ok(
    errors.some(e => e[0] === '[boot]'),
    'the failure is not logged',
  );
});
