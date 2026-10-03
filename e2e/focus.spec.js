// @ts-check
/* Keyboard focus after Settings controls redraw or hide the focused element. */

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

const focused = page =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim() : '';
  });

const editorOpened = page =>
  expect
    .poll(() => page.evaluate(() => document.getElementById('ev-body')?.contains(document.activeElement)))
    .toBe(true);

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo'), app('charlie', 'Charlie')] });
});

test('a list move keeps focus on the moved row', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Move down: Alpha' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').nth(1)).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move down: Alpha');

  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').nth(2)).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move down: Alpha');

  await page.keyboard.press('Enter');
  await expect(page.locator('#al .rnm').last()).toHaveText('Alpha');
  expect(await focused(page)).toBe('Move up: Alpha');
});

test('closing the editor returns focus to the row that opened it', async ({ page }) => {
  await openDashboardList(page);
  const edit = rowByName(page, 'Bravo').getByRole('button', { name: /^Edit/ });
  await edit.focus();
  await page.keyboard.press('Enter');
  await editorOpened(page);
  await page.locator('#ev-back').click();
  await expect(edit).toBeFocused();

  await edit.press('Enter');
  await editorOpened(page);
  await page.locator('#ev-save').click();
  await expect(page.locator('#dash-edit-view')).toBeHidden();
  await expect(rowByName(page, 'Bravo').getByRole('button', { name: /^Edit/ })).toBeFocused();
});

test('deleting from the editor moves focus to Add', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Charlie').getByRole('button', { name: /^Edit/ }).click();
  await editorOpened(page);
  await page.locator('#ev-delete').click();
  await page.locator('dialog .bd-btn').click();
  await expect(page.locator('#dash-edit-view')).toBeHidden();
  await expect(page.locator('#btn-add')).toBeFocused();
});

test('Enter and Escape in an inline edit return focus to its pencil', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await editorOpened(page);
  const pen = page.locator('#ie-name .pe');
  await pen.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#f-lbl')).toBeFocused();
  await page.keyboard.type('Delta');
  await page.keyboard.press('Enter');
  await expect(pen).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(pen).toBeFocused();
});

test('a widget size tile and the type picker keep focus after the form redraws', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await editorOpened(page);
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  const small = page.locator('#ev-body .tile-opt[data-size="small"]');
  await small.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ev-body .tile-opt[data-size="small"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ev-body .tile-opt[data-size="small"]')).toBeFocused();

  await page.locator('#f-wtype-btn').click();
  await page.locator('#f-wtype-list li[role="option"]:not([aria-selected="true"])').first().click();
  await expect(page.locator('#f-wtype-btn')).toBeFocused();
});

test('header rows and activity labels keep focus when added, moved or removed', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        ...app('svc', 'Service'),
        monitoring: { activity: { enabled: true, url: 'http://svc.invalid/api', interval: 30 } },
      },
    ],
  });
  await page.route('**/api/badge-proxy', route =>
    route.fulfill({
      json: {
        numbers: [
          { path: 'a', label: 'a', value: 1 },
          { path: 'b', label: 'b', value: 2 },
        ],
      },
    }),
  );
  await openDashboardList(page);
  await rowByName(page, 'Service').getByRole('button', { name: /^Edit/ }).click();
  await editorOpened(page);
  await page.locator('#bfetch').click();
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(1);

  await page.locator('#auth-en').evaluate(e => e.click());
  await page.locator('#bhdr-rows .kv-add').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bhdr-rows .kv-row .kv-k').last()).toBeFocused();
  await page.locator('#bhdr-rows .kv-del').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bhdr-rows .kv-row')).toHaveCount(0);
  await expect(page.locator('#bhdr-rows .kv-add')).toBeFocused();

  await page.locator('#act-add-label').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(2);
  await page.locator('#act-labels .albl-hdr[data-idx="0"] .albl-move').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr[data-idx="1"] .albl-move').nth(0)).toBeFocused();

  await page.locator('#act-labels .albl-hdr[data-idx="1"] .grp-hdr-rm').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(1);
  await expect(page.locator('#act-labels .albl-hdr[data-idx="0"] .grp-hdr-rm')).toBeFocused();
});

test('opening the editor and switching its type keep focus inside the editor', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ev-body .tile-opt[data-ctype="app"]')).toBeFocused();

  await page.locator('#ev-body .tile-opt[data-ctype="widget"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ev-body .tile-opt[data-ctype="widget"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ev-body .tile-opt[data-ctype="widget"]')).toBeFocused();

  await page.locator('#ev-back').click();
  await rowByName(page, 'Alpha').getByRole('button', { name: /^Edit/ }).press('Enter');
  await expect(page.locator('#dash-edit-view')).toBeVisible();
  await editorOpened(page);
});

test('a view switch keeps focus on the view control', async ({ page, request }) => {
  await seedConfig(request, {
    items: [{ id: 'net', type: 'widget', widgetType: 'connections', widgetSize: 'medium', label: 'Net' }],
  });
  await openDashboardList(page);
  await rowByName(page, 'Net').getByRole('button', { name: /^Edit/ }).click();
  await editorOpened(page);
  await page.locator('[data-field="view"] input:checked').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-field="view"] input[value="vpn"]')).toBeChecked();
  await expect(page.locator('[data-field="view"] input[value="vpn"]')).toBeFocused();
});

test('adding an app to a folder keeps focus on the folder add button', async ({ page, request }) => {
  await seedConfig(request, {
    items: [app('alpha', 'Alpha'), { id: 'box', type: 'folder', label: 'Box', children: [] }],
  });
  await openDashboardList(page);
  await rowByName(page, 'Box').locator('.rnm').click();
  const add = page.locator('#al .fp-add');
  await add.focus();
  await page.keyboard.press('Enter');
  await page.locator('dialog').getByText('Alpha').click();
  await expect(rowByName(page, 'Alpha')).toHaveAttribute('data-indent', '1');
  await expect(page.locator('#al .fp-add')).toBeFocused();
});

test('removing the only saved activity label before a Fetch moves focus to Fetch', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        ...app('svc', 'Service'),
        monitoring: {
          activity: { enabled: true, url: 'http://svc.invalid/api', interval: 30, labels: [{ path: 'a', name: 'A' }] },
        },
      },
    ],
  });
  await openDashboardList(page);
  await rowByName(page, 'Service').getByRole('button', { name: /^Edit/ }).click();
  await editorOpened(page);
  await page.locator('#act-labels .grp-hdr-rm').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#act-labels .albl-hdr')).toHaveCount(0);
  await expect(page.locator('#bfetch')).toBeFocused();
});

test('Tab stays inside the sign-in screen', async ({ page }) => {
  await page.route('**/api/auth/check', route => route.fulfill({ json: { enabled: true, authenticated: false } }));
  await page.goto('/admin/');
  await expect(page.locator('#login-pw')).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const outside = await page.evaluate(() => {
      const a = document.activeElement;
      return a && a !== document.body && !document.getElementById('login-screen')?.contains(a) ? a.outerHTML : '';
    });
    expect(outside, `Tab ${i + 1} left the sign-in screen`).toBe('');
  }
});

test('signing in again mid-session returns focus to the control that asked', async ({ page }) => {
  let refused = false;
  await page.route('**/api/config', route => {
    if (route.request().method() !== 'POST' || refused) return route.fallback();
    refused = true;
    return route.fulfill({ status: 401, json: { error: 'Unauthorised', kind: 'auth' } });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="appearance"]').click();
  const awake = page.locator('#set-awake');
  await awake.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#login-pw')).toBeFocused();
  await page.locator('#login-pw').fill('anything');
  await page.keyboard.press('Enter');
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(awake).toBeFocused();
});

/* A closed section is zero height, so focus inside it is lost from view. */
test('a switched-off editor section takes no focus until it opens', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /^Edit/ }).click();
  await editorOpened(page);
  const focusableInside = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('#hc-sub input, #hc-sub button')].filter(el => {
          /** @type {HTMLElement} */ (el).focus();
          return document.activeElement === el;
        }).length,
    );
  await expect(page.locator('#hc-en')).not.toBeChecked();
  expect(await focusableInside()).toBe(0);
  await page.locator('label.tog:has(#hc-en)').click();
  await expect(page.locator('#hc-sub')).toHaveClass(/\bopen\b/);
  await expect.poll(focusableInside).toBeGreaterThan(0);
});
