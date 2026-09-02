// @ts-check
/* What a screen reader is given for a tile, read from the browser's own
   accessibility tree rather than from the markup.

   An explicit label on the anchor wins over everything inside it, so a badge
   that labels itself is never part of what a reader hears moving from tile to
   tile. A badge is also not a live region. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

/* A host that cannot resolve, so the check fails the same way on every run. */
const DEAD = 'http://does-not-resolve.invalid/';

const watched = (id, label) => ({
  ...app(id, label),
  monitoring: { healthcheck: { enabled: true, pingUrl: DEAD } },
});

/* Three badged tiles, not one: a live region per badge only shows as
   growth. */
const ITEMS = [watched('watched', 'Watched'), watched('w2', 'Second'), watched('w3', 'Third'), app('plain', 'Plain')];

/* Chromium only: the full tree with its live and atomic properties comes from
   the DevTools protocol, which WebKit does not expose. */
test.describe('tile names', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'needs CDP');

  test.beforeEach(async ({ request }) => {
    await seedConfig(request, { items: ITEMS, settings: { showLabels: { desktop: false } } });
    await dismissSetupPrompt(request);
  });

  /** Every node the browser computes, with the names and live properties. */
  async function axNodes(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes.map(n => ({
      role: n.role?.value,
      name: n.name?.value ?? '',
      live: (n.properties || []).find(p => p.name === 'live')?.value?.value,
    }));
  }

  test('a badged tile says so in its name, and an unbadged one does not', async ({ page }) => {
    await page.goto('/');
    await page.locator('.badge.on').first().waitFor({ state: 'visible' });
    const nodes = await axNodes(page);
    const named = n => nodes.find(x => x.name.startsWith(n));
    const watched = named('Watched');
    const plain = named('Plain');
    expect(watched, 'the badged tile is missing from the tree').toBeTruthy();
    expect(plain, 'the unbadged tile is missing from the tree').toBeTruthy();
    expect(watched.name, `the badge is absent from "${watched.name}"`).not.toBe('Watched');
    expect(plain.name).toBe('Plain');
  });

  /* Counting them absolutely is brittle: the browser prunes announcers that are
     empty and hidden. What matters is that the number does not depend on how
     many badges are on screen, which is what a live region per badge did. */
  test('badges do not each add a live region', async ({ page, request }) => {
    const readLive = async () => (await axNodes(page)).filter(n => n.live && n.live !== 'off');

    await seedConfig(request, { items: [app('plain', 'Plain')], settings: { showLabels: { desktop: false } } });
    await page.goto('/');
    await page.locator('.icon').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const without = await readLive();

    await seedConfig(request, { items: ITEMS, settings: { showLabels: { desktop: false } } });
    await page.goto('/');
    await page.locator('.badge.on').nth(2).waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const with3 = await readLive();

    expect(
      with3.length,
      `${without.length} live regions with no badge, ${with3.length} with three: ${with3
        .map(n => `${n.role} "${n.name}"`)
        .join(' | ')}`,
    ).toBe(without.length);
  });
});
