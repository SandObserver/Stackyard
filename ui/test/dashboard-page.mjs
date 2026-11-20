/* The dashboard page in the fake DOM, against a fake API. Install or boot it
   once per test file: the page modules keep their state for the process. The
   page is hidden after the file's tests. A poll left running keeps the test
   process alive. */

import { register } from 'node:module';
import { after } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

/** A config item for an app tile. @param {string} id @param {Record<string, any>} [more] */
export const app = (id, more = {}) => ({
  id,
  type: 'app',
  label: id.toUpperCase(),
  href: `http://${id}.local`,
  ...more,
});

/** The fake API routes a dashboard boot reads.
    @param {{ config?: any, widgets?: any, auth?: any, badges?: any, health?: any }} [api] */
export function dashboardRoutes({ config, widgets, auth, badges, health } = {}) {
  return {
    ...catalogRoutes(),
    '/api/config': config ?? { items: [app('a')], settings: { language: 'en' } },
    '/api/widgets': widgets ?? { widgets: [] },
    '/api/auth/check': auth ?? { enabled: false, setupPrompted: true, passwordSet: true },
    '/api/icons/local': [],
    '/api/badges': badges ?? {},
    '/api/health': health ?? {},
  };
}

/** Install the dashboard page and the fake API, without booting.
    @param {{ routes?: Record<string, any>, config?: any, widgets?: any, auth?: any, badges?: any, health?: any,
      storage?: Record<string, string>, reduceMotion?: boolean, width?: number, height?: number }} [opts] */
export function installDashboard(opts = {}) {
  const fetch = fakeFetch({ ...dashboardRoutes(opts), ...opts.routes });
  const dom = installDom({
    markup: pageBody('index.html'),
    fetch,
    storage: opts.storage,
    reduceMotion: opts.reduceMotion,
    location: 'http://nas.local/',
  });
  after(() => {
    dom.document.hidden = true;
    dom.document.dispatchEvent({ type: 'visibilitychange' });
  });
  if (opts.width) globalThis.innerWidth = opts.width;
  if (opts.height) globalThis.innerHeight = opts.height;
  return { dom, fetch };
}

/** Boot the dashboard and wait until its first layout is built.
    @param {Parameters<typeof installDashboard>[0] & { mob?: boolean, early?: any }} [opts] */
export async function bootDashboard(opts = {}) {
  const { dom, fetch } = installDashboard(opts);
  if (opts.early) /** @type {any} */ (globalThis).__early = opts.early;
  const { boot } = await import('../js/dashboard-boot.js');
  const { createDashboardState } = await import('../js/dashboard-state.js');
  const dash = createDashboardState({ mob: !!opts.mob, bootTimeoutMs: 15000 });
  const booted = boot(dash);
  await settle();
  for (let i = 0; i < 4; i++) {
    dom.flushFrames();
    await settle();
  }
  return {
    dom,
    fetch,
    dash,
    booted,
    /** Hide the page, which stops the polls, so the test process can exit. */
    stop() {
      dom.document.hidden = true;
      dom.document.dispatchEvent({ type: 'visibilitychange' });
    },
  };
}
