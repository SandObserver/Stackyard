// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const app = n => ({ id: `a${n}`, type: 'app', label: `App ${n}`, href: 'https://example.lan/', iconUrl: 'sonarr' });
const manyApps = Array.from({ length: 120 }, (_, n) => app(n));

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: manyApps, settings: {} });
  await dismissSetupPrompt(request);
});

test('icons on the page in view load at once and later pages stay lazy', async ({ page }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  const lazy = page.locator('#pages > *').nth(0).locator('img[loading="lazy"]');
  await expect(page.locator('#pages > *').nth(0).locator('img').first()).toBeAttached();
  await expect(lazy).toHaveCount(0);
  await expect(page.locator('#pages > *').nth(1).locator('img[loading="lazy"]').first()).toBeAttached();
});

test('Settings asks for its start-up data together', async ({ page }) => {
  const configAsked = new Promise(resolve => {
    page.on('request', r => {
      if (new URL(r.url()).pathname === '/api/config') resolve(undefined);
    });
  });
  await page.route('**/api/icons/local', async route => {
    await configAsked;
    await route.continue();
  });
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
});

async function restore(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

test('a page restored with no changes lifts its veil without reloading', async ({ page }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await restore(page);
  await page.locator('body.ready').waitFor({ state: 'attached' });
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('a page restored after a settings change reloads', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await seedConfig(request, { items: manyApps.slice(0, 3), settings: {} });
  await restore(page);
  await page.waitForFunction(() => !window.__sameDocument);
  await page.locator('body.ready').waitFor({ state: 'attached' });
});

test('Settings shows no form until its real values are in', async ({ page }) => {
  let release = () => {};
  const held = new Promise(resolve => {
    release = () => resolve(undefined);
  });
  await page.route('**/api/config', async route => {
    await held;
    await route.continue();
  });
  await page.goto('/admin/');
  await expect(page.locator('.sb-nav')).toBeVisible();
  await expect(page.locator('.cp')).toBeHidden();
  release();
  await expect(page.locator('.cp')).toBeVisible();
});

test('Settings still shows its failure message when the config cannot load', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status: 500, json: { error: 'no' } }));
  await page.goto('/admin/');
  await expect(page.locator('.cp')).toBeVisible();
  await page.locator('.nl[data-sec="dashboard"]').click();
  await expect(page.locator('.dash-load-fail')).toBeVisible();
});

test('the last wallpaper is requested and its colour painted before the page has built', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sy-boot', JSON.stringify({ url: '/favicon.ico?hint', color: 'rgb(9,8,7)' }));
    new MutationObserver(() => {
      window.__bootBg ||= document.documentElement?.style.getPropertyValue('--boot-bg');
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['style'] });
  });
  const hinted = page.waitForRequest(r => r.url().endsWith('/favicon.ico?hint'));
  await page.goto('/');
  await hinted;
  await expect.poll(() => page.evaluate(() => window.__bootBg)).toBe('rgb(9,8,7)');
});

test('a page restored while the server cannot be reached says so and keeps its old contents hidden', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await page.route('**/api/**', route => route.abort());
  await restore(page);
  await expect(page.locator('.api-error-screen')).toBeVisible();
  await expect(page.locator('#pages')).toHaveAttribute('inert', '');
  await expect(page.locator('body')).not.toHaveClass(/\bready\b/);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

for (const [what, reply] of [
  [
    'a redirect to a sign-in proxy',
    route => route.fulfill({ status: 302, headers: { Location: 'https://sso.example.test/' } }),
  ],
  ['a sign-in page', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Sign in</p>' })],
]) {
  test(`a page restored into ${what} reloads`, async ({ page, browserName }) => {
    test.skip(what.includes('redirect') && browserName === 'webkit', 'Playwright cannot fulfil a redirect in WebKit');
    await page.goto('/');
    await page.locator('body.ready').waitFor({ state: 'attached' });
    await page.evaluate(() => {
      window.__sameDocument = true;
    });
    await page.route('**/api/auth/check', reply);
    await restore(page);
    await page.waitForFunction(() => !window.__sameDocument);
  });
}

test('a stored colour gives way to the theme when there is no wallpaper', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sy-boot', JSON.stringify({ color: 'rgb(220,220,210)' }));
  });
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundColor))
    .not.toBe('rgb(220, 220, 210)');
});

test('Settings stops its spinner when it shows a recovery screen instead of the form', async ({ page }) => {
  await page.route('**/api/auth/check', route =>
    route.fulfill({ status: 503, json: { error: 'damaged', code: 'auth.password-damaged' } }),
  );
  await page.goto('/admin/');
  await expect(page.locator('.cfg-recovery')).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::after').content)).toBe('none');
});

const DARK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQEREBAAB8AD2SgCfbAAAAAElFTkSuQmCC',
  'base64',
);
const LIGHT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP49esXAAXgAu+YSct+AAAAAElFTkSuQmCC',
  'base64',
);
const CREDIT = { name: 'Jane Doe', profile: 'https://unsplash.com/@jane', site: 'https://unsplash.com/' };

/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').APIRequestContext} request
    @param {(wide: boolean) => Promise<boolean>} serve */
async function unsplashOnPhone(page, request, serve) {
  await seedConfig(request, { items: [], settings: { background: { type: 'unsplash', collection: '' } } });
  await page.route('**/api/wallpaper', route =>
    route.fulfill({ json: { url: 'https://images.unsplash.com/photo-1?ixid=x&w=2880&h=1800', credit: CREDIT } }),
  );
  await page.route('https://images.unsplash.com/**', async route => {
    const u = new URL(route.request().url());
    const wide = Number(u.searchParams.get('w')) > Number(u.searchParams.get('h'));
    if (!(await serve(wide))) return route.abort();
    return route.fulfill({
      body: wide ? LIGHT : DARK,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await page.addInitScript(() => {
    window.__orientation = 'portrait-primary';
    Object.defineProperty(screen.orientation, 'type', { configurable: true, get: () => window.__orientation });
  });
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await expect(page.locator('#photo-credit')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page @param {string} type */
const rotate = (page, type) =>
  page.evaluate(t => {
    window.__orientation = t;
    screen.orientation.dispatchEvent(new Event('change'));
  }, type);

/** @param {import('@playwright/test').Page} page */
const shownShape = page =>
  page.evaluate(() => {
    const m = document.documentElement.style.getPropertyValue('--bg-image').match(/w=(\d+)&h=(\d+)/);
    return m && Number(m[1]) > Number(m[2]) ? 'wide' : 'tall';
  });

test('turning a phone sideways and back keeps the upright photo', async ({ page, request }) => {
  await unsplashOnPhone(page, request, async wide => {
    if (wide) await new Promise(r => setTimeout(r, 1500));
    return true;
  });
  await rotate(page, 'landscape-primary');
  await rotate(page, 'portrait-primary');
  await page.waitForTimeout(2500);
  expect(await shownShape(page)).toBe('tall');
  const hint = await page.evaluate(() => JSON.parse(localStorage.getItem('sy-boot') || '{}'));
  const [, w, h] = hint.url.match(/w=(\d+)&h=(\d+)/);
  expect(Number(w)).toBeLessThan(Number(h));
  expect(Number(hint.color.match(/^rgb\((\d+),/)[1])).toBeLessThan(100);
});

test('a photo that fails to load on rotation keeps the shown photo and its credit', async ({ page, request }) => {
  await unsplashOnPhone(page, request, async wide => !wide);
  await rotate(page, 'landscape-primary');
  await page.waitForTimeout(1000);
  expect(await shownShape(page)).toBe('tall');
  await expect(page.locator('#photo-credit')).toBeVisible();
});

test('a page that said the server was unreachable reloads once a later restore finds it again', async ({ page }) => {
  await page.goto('/');
  await page.locator('body.ready').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await page.route('**/api/**', route => route.abort());
  await restore(page);
  await restore(page);
  await expect(page.locator('.api-error-screen')).toHaveCount(1);
  await page.unroute('**/api/**');
  await restore(page);
  await page.waitForFunction(() => !window.__sameDocument);
});

test('the unreachable-server screen does not sit on a stored colour', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sy-boot', JSON.stringify({ color: 'rgb(230,230,225)' }));
  });
  await page.route('**/api/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.api-error-screen')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundColor)).not.toBe(
    'rgb(230, 230, 225)',
  );
});
