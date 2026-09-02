// @ts-check
/* The editor builds its Live Activity section from ids the template owns. A
   removed id must not throw inside the build: that leaves the whole editor
   blank with every button in it inert, so these specs open it for real. */

const { test, expect } = require('@playwright/test');
const {
  seedConfig,
  readConfig,
  expectItem,
  saveEditor,
  app,
  openDashboardList,
  setInlineRow,
  rowByName,
} = require('./helpers');

const labelled = () => ({
  ...app('seerr', 'Requests'),
  monitoring: {
    activity: {
      enabled: true,
      url: 'http://counts.invalid/api',
      interval: 30,
      labels: [
        { path: 'errors', name: 'errors', unit: 'err', color: '#ff393c' },
        { path: 'pending', name: 'pending', unit: 'pending', color: '#ffcc00' },
      ],
    },
  },
});

test('the editor opens for a new app', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedConfig(page.request, { items: [app('alpha', 'Alpha')] });
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await expect(page.locator('#f-lbl')).toHaveCount(1);
  await expect(page.locator('#ev-save')).toBeVisible();
  expect(errors, 'building the editor must not throw').toEqual([]);
});

test('the editor opens for an app that already has labels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedConfig(page.request, { items: [labelled()] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await expect(page.locator('#albl-path-0')).toBeVisible();
  await expect(page.locator('#albl-path-1')).toBeVisible();
  expect(errors, 'building the editor must not throw').toEqual([]);
});

test('a labelled app survives an edit that does not touch its labels', async ({ page }) => {
  await seedConfig(page.request, { items: [labelled()] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await setInlineRow(page, 'ie-name', 'f-lbl', 'Requests 2');
  await saveEditor(page);

  const cfg = await readConfig(page.request);
  const saved = expectItem(cfg, i => i.label === 'Requests 2', 'the app');
  expect(saved.monitoring.activity.labels.map(l => l.path)).toEqual(['errors', 'pending']);
  expect(saved.monitoring.activity.labels[0].unit).toBe('err');
  expect(saved.monitoring.activity.labels[1].color).toBe('#ffcc00');
});

test('reordering labels changes which one owns the badge', async ({ page }) => {
  await seedConfig(page.request, { items: [labelled()] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await page.locator('.albl-hdr').nth(1).locator('.albl-move').first().click();
  await saveEditor(page);

  const cfg = await readConfig(page.request);
  const saved = expectItem(cfg, i => i.label === 'Requests', 'the app');
  expect(saved.monitoring.activity.labels.map(l => l.path)).toEqual(['pending', 'errors']);
});

test('removing a label drops it from the saved config', async ({ page }) => {
  await seedConfig(page.request, { items: [labelled()] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await page.locator('.albl-hdr').nth(1).locator('.grp-hdr-rm').click();
  await saveEditor(page);

  const cfg = await readConfig(page.request);
  const saved = expectItem(cfg, i => i.label === 'Requests', 'the app');
  expect(saved.monitoring.activity.labels.map(l => l.path)).toEqual(['errors']);
});

test('a single label keeps its own styling rather than losing it', async ({ page }) => {
  const one = labelled();
  one.monitoring.activity.labels = [{ path: 'pending', name: 'pending', unit: 'pending', color: '#ffcc00' }];
  await seedConfig(page.request, { items: [one] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await saveEditor(page);

  const cfg = await readConfig(page.request);
  const saved = expectItem(cfg, i => i.label === 'Requests', 'the app');
  expect(saved.monitoring.activity.labels).toHaveLength(1);
  expect(saved.monitoring.activity.labels[0].unit).toBe('pending');
  expect(saved.monitoring.activity.labels[0].color).toBe('#ffcc00');
});

/* Bad config reaches the editor from the file, not from the form, so these
   shapes cannot be produced by using the admin and must not break it. */
const withActivity = activity => ({
  ...app('seerr', 'Requests'),
  monitoring: { activity: { enabled: true, url: 'http://counts.invalid/api', interval: 30, ...activity } },
});

const BAD = {
  'labels that are not an array': { labels: 'pending' },
  'an empty labels array': { labels: [] },
  'a label with no path': { labels: [{ name: 'orphan' }] },
  'labels that are not objects': { labels: [null, 'x', 7] },
  'a label with a hostile name': { labels: [{ path: 'a', name: '<img src=x onerror=alert(1)>' }] },
  'a nonsense minimum': { labels: [{ path: 'a', min: 'soon' }] },
  'a colour that is not a colour': { labels: [{ path: 'a', color: 'javascript:alert(1)' }] },
  'more labels than anyone would set': {
    labels: Array.from({ length: 40 }, (_, n) => ({ path: `p${n}`, name: `label ${n}` })),
  },
};

for (const [what, activity] of Object.entries(BAD)) {
  test(`the editor opens for an app with ${what}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedConfig(page.request, { items: [withActivity(activity)] });
    await openDashboardList(page);
    await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
    await expect(page.locator('#f-lbl')).toHaveCount(1);
    await expect(page.locator('#ev-save')).toBeVisible();
    expect(errors, `building the editor threw for ${what}`).toEqual([]);
  });
}

test('a hostile label name is shown as text, never run as markup', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => {
    dialogs.push(d.message());
    d.dismiss();
  });
  await seedConfig(page.request, {
    items: [withActivity({ labels: [{ path: 'a', name: '<img src=x onerror=alert(1)>' }] })],
  });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await expect(page.locator('#albl-name-0')).toHaveValue('<img src=x onerror=alert(1)>');
  expect(await page.locator('#act-labels img').count(), 'the name must not become an element').toBe(0);
  expect(dialogs).toEqual([]);
});

test('saving an app whose labels were malformed writes a clean list', async ({ page }) => {
  await seedConfig(page.request, { items: [withActivity({ labels: [null, { path: 'a', name: 'kept' }, 'x'] })] });
  await openDashboardList(page);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await saveEditor(page);
  const cfg = await readConfig(page.request);
  const saved = expectItem(cfg, i => i.label === 'Requests', 'the app');
  expect(saved.monitoring.activity.labels).toEqual([{ path: 'a', name: 'kept' }]);
});

test('opening and saving does not rewrite a colour nobody touched', async ({ page }) => {
  await seedConfig(page.request, {
    items: [
      withActivity({ labels: [{ path: 'a', name: 'kept', color: '#cb30df' }] }),
      { ...app('fixed', 'Fixed'), monitoring: { staticBadge: { enabled: true, label: 'b', color: '#35c759' } } },
    ],
  });
  await openDashboardList(page);
  for (const name of ['Requests', 'Fixed']) {
    await rowByName(page, name).locator('button', { hasText: 'Edit' }).click();
    await saveEditor(page);
  }
  const cfg = await readConfig(page.request);
  expect(expectItem(cfg, i => i.label === 'Requests', 'the app').monitoring.activity.labels[0].color).toBe('#cb30df');
  expect(expectItem(cfg, i => i.label === 'Fixed', 'the app').monitoring.staticBadge.color).toBe('#35c759');
});

test('an older summed badge stays summed when the app is opened and saved', async ({ page }) => {
  await seedConfig(page.request, {
    items: [
      withActivity({ extract: [{ path: 'a' }, { path: 'b' }] }),
      { ...app('one', 'One'), monitoring: { activity: { enabled: true, url: 'http://x.invalid', extract: 'a' } } },
    ],
  });
  await openDashboardList(page);
  await expect(page.locator('#act-combine')).toHaveCount(0);
  await rowByName(page, 'Requests').locator('button', { hasText: 'Edit' }).click();
  await expect(page.locator('#act-combine')).toBeChecked();
  await saveEditor(page);

  /* One path was never a sum, so the toggle stays hidden and it becomes a
     single label. */
  await rowByName(page, 'One').locator('button', { hasText: 'Edit' }).click();
  await expect(page.locator('#act-combine-row')).toBeHidden();
  await saveEditor(page);

  const cfg = await readConfig(page.request);
  const summed = expectItem(cfg, i => i.label === 'Requests', 'the app').monitoring.activity;
  expect(summed.combine, 'the summed badge must survive a save').toBe(true);
  expect(summed.labels).toBeUndefined();
  const single = expectItem(cfg, i => i.label === 'One', 'the app').monitoring.activity;
  expect(single.combine).toBeUndefined();
  expect(single.labels).toEqual([{ path: 'a' }]);
});
