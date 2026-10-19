// @ts-check
/* The fit setting from the dropdown to the wallpaper layer. A break in that
   chain leaves the control present and doing nothing, which is what the admin
   page cannot show. */

const { test, expect } = require('@playwright/test');
const { seedConfig, readConfig, dismissSetupPrompt, setInlineRow } = require('./helpers');
const { BASE_URL } = require('./base-url');

const WALLPAPER = { type: 'url', url: '/icons/wallpaper/none.png', brightness: 1, fit: 'fill' };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER } } });
  await dismissSetupPrompt(request);
});

/* The page fills these fields from the config after it loads. A click before
   that lands is overwritten. */
async function openAppearance(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  await page.locator('#bg-fit-btn').waitFor({ state: 'visible' });
  await expect(page.locator('#ie-bgurl-v')).toContainText('/icons/wallpaper/');
}

test('choosing Fit and saving stores it', async ({ page, request }) => {
  await openAppearance(page);
  await page.locator('#bg-fit-btn').click();
  await page.locator('#bg-fit-list li[data-val="fit"]').click();
  await expect(page.locator('#bg-fit-list li[data-val="fit"]')).toHaveAttribute('aria-selected', 'true');
  const saved = page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST');
  await page.locator('#bg-save').click();
  expect((await saved).ok()).toBeTruthy();

  const cfg = await readConfig(request);
  expect(cfg.settings.background.fit).toBe('fit');
});

test('the saved choice is shown again when the page is reopened', async ({ page, request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  await openAppearance(page);
  await expect(page.locator('#bg-fit-list li[data-val="fit"]')).toHaveAttribute('aria-selected', 'true');
});

test('the settings pages show the wallpaper the same way the dashboard does', async ({ page, request }) => {
  const sizeOnAdmin = async () => {
    await page.goto('/admin/');
    await page.locator('.nl[data-sec="appearance"]').click();
    await expect(page.locator('#ie-bgurl-v')).toContainText('/icons/wallpaper/');
    return page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundSize);
  };

  expect(await sizeOnAdmin()).toBe('cover');

  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  expect(await sizeOnAdmin()).toBe('contain');
});

test('fill covers the viewport and fit shows the whole image', async ({ page, request }) => {
  /* The wallpaper is applied after the tiles are built. Wait for the value. */
  const expectSize = async want => {
    await page.goto('/');
    await page.locator('#pages').waitFor();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundSize))
      .toBe(want);
  };

  await expectSize('cover');

  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  await expectSize('contain');
});

for (const [what, reply] of [
  ['returns no image', route => route.fulfill({ json: { url: null } })],
  ['fails', route => route.abort()],
]) {
  test(`Settings says so when the Unsplash wallpaper ${what}`, async ({ page, request }) => {
    await seedConfig(request, { items: [], settings: { background: { type: 'unsplash', query: 'x' } } });
    await page.route('**/api/wallpaper', reply);
    await page.goto('/admin/');
    await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
    await expect(page.locator('#toast')).toHaveText('The wallpaper could not be loaded.');
  });
}

test('a failed wallpaper link goes back to the last saved wallpaper, not the one at page load', async ({ page }) => {
  let fetches = 0;
  await page.route('**/api/wallpaper/fetch', route =>
    ++fetches === 1 ? route.fulfill({ json: { url: '/icons/wallpaper/saved-later.png' } }) : route.abort(),
  );
  await openAppearance(page);

  await setInlineRow(page, 'ie-bgurl', 'bg-url-inp', 'https://example.invalid/first.jpg');
  await expect(page.locator('#ie-bgurl-v')).toContainText('saved-later.png');
  const saved = page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST');
  await page.locator('#bg-save').click();
  expect((await saved).ok()).toBeTruthy();

  await setInlineRow(page, 'ie-bgurl', 'bg-url-inp', 'https://example.invalid/second.jpg');
  await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
  await expect(page.locator('#ie-bgurl-v')).toContainText('saved-later.png');
});

test.describe('Unsplash key', () => {
  const UNSPLASH = { type: 'unsplash', brightness: 0.62, collection: '' };

  test.beforeEach(async ({ page, request }) => {
    await seedConfig(request, { items: [], settings: { background: { ...UNSPLASH } } });
    const res = await request.post('/api/settings/unsplash-key', {
      data: { apiKey: 'stored-key' },
      headers: { Origin: BASE_URL },
    });
    expect(res.ok()).toBeTruthy();
    await page.route('**/api/wallpaper', route => route.fulfill({ json: { url: null } }));
    await page.goto('/admin/');
    await page.locator('.nl[data-sec="appearance"]').click();
    await expect(page.locator('#ie-apikey-v')).toHaveText('Configured');
  });

  test('opening the field and saving does not send a key', async ({ page }) => {
    const sent = [];
    page.on('request', r => {
      if (r.url().includes('/api/settings/unsplash-key') && r.method() === 'POST') sent.push(r.postData());
    });
    await page.locator('#ie-apikey .rv').click();
    const input = page.locator('#bg-apikey-inp');
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('type', 'password');
    await page.locator('#ie-apikey .rl').click();
    await expect(page.locator('#ie-apikey-v')).toHaveText('Configured');

    await setInlineRow(page, 'ie-bgcol', 'bg-col-inp', 'AGVpqBZnzUE');
    const saved = page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST');
    await page.locator('#bg-save').click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.locator('#toast')).not.toHaveClass(/\berr\b/);
    expect(sent).toEqual([]);
  });

  test('a typed key is sent once and the field is emptied', async ({ page }) => {
    await setInlineRow(page, 'ie-apikey', 'bg-apikey-inp', 'new-key');
    await expect(page.locator('#ie-apikey-v')).toHaveText('New value set');
    const posted = page.waitForRequest(r => r.url().includes('/api/settings/unsplash-key') && r.method() === 'POST');
    await page.locator('#bg-save').click();
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ apiKey: 'new-key' });
    await expect(page.locator('#ie-apikey-v')).toHaveText('Configured');
    await expect(page.locator('#bg-apikey-inp')).toHaveValue('');
  });
});
