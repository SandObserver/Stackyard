// @ts-check
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const { seedConfig, dismissSetupPrompt, app, animationsDone, openDashboardList } = require('./helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/* Inside a widget frame these are not findings. A widget document has no main
   landmark or heading by design, and a transparent widget page is measured
   against white instead of the card behind it. */
const FRAME_ONLY = new Set(['landmark-one-main', 'page-has-heading-one', 'color-contrast']);

const clock = {
  id: 'clock1',
  type: 'widget',
  label: 'Clock',
  widgetType: 'clock',
  widgetSize: 'small',
  widgetConfig: {},
};
const folder = { id: 'box', type: 'folder', label: 'Media', children: ['plex'], color: 'dark' };

/* A tile with no icon draws the first letter of its name in its place. Axe reads
   that letter as label text, so "S Sonarr" looks like a mismatch with "Sonarr". */
const LETTER_TILE = '.fb, .folder-mini-fb';

/** @param {import('@playwright/test').Page} page */
async function serious(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = [];
  for (const v of violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    const nodes = [];
    for (const n of v.nodes) {
      if (FRAME_ONLY.has(v.id) && n.target.length > 1) continue;
      if (
        v.id === 'label-content-name-mismatch' &&
        n.target.length === 1 &&
        (await page.locator(String(n.target[0])).locator(LETTER_TILE).count()) > 0
      )
        continue;
      nodes.push(n.target.join(' > '));
    }
    if (nodes.length) found.push(`${v.id}: ${nodes.join(', ')}`);
  }
  return found;
}

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page, request }) => {
      await seedConfig(request, {
        items: [clock, folder, app('plex', 'Plex'), app('sonarr', 'Sonarr'), app('radarr', 'Radarr')],
      });
      await dismissSetupPrompt(request);
      await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
      await page.addInitScript(t => localStorage.setItem('sy-theme', t), theme);
    });

    test('the dashboard has no serious accessibility findings', async ({ page }) => {
      await page.goto('/');
      await page.locator('#pages a.icon').first().waitFor({ state: 'visible' });
      await page.waitForFunction(() =>
        [...document.querySelectorAll('iframe')].every(f => f.contentDocument?.readyState === 'complete'),
      );
      await animationsDone(page);
      expect(await serious(page)).toEqual([]);
    });

    for (const section of ['general', 'appearance', 'dashboard', 'about']) {
      test(`the ${section} section of Settings has no serious accessibility findings`, async ({ page }) => {
        await page.goto('/admin/');
        await page.locator('body.authed').waitFor({ state: 'attached' });
        await page.locator(`.nl[data-sec="${section}"]`).click();
        await animationsDone(page);
        expect(await serious(page)).toEqual([]);
      });
    }

    test('the app editor has no serious accessibility findings', async ({ page }) => {
      await openDashboardList(page);
      await page.locator('#btn-add').click();
      await page.locator('#ev-save').waitFor({ state: 'visible' });
      await animationsDone(page);
      expect(await serious(page)).toEqual([]);
    });
  });
}
