// @ts-check
/* Every upload that reaches the API counts toward its hourly limit of 20 per
   client address. Both browsers and retries share one address in a local run. */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  seedConfig,
  readConfig,
  dismissSetupPrompt,
  app,
  openDashboardList,
  rowByName,
  saveEditor,
  encodePng,
} = require('./helpers');
const { BASE_URL } = require('./base-url');
const { ICON_MAX_BYTES } = require('../api/src/routes/icons');
const { UPLOAD_MAX_BYTES } = require('../api/src/routes/wallpaper');

const nginxConf = fs.readFileSync(path.join(__dirname, '../nginx/dashboard.conf'), 'utf8');

/** @param {string} text */
function bodyLimit(text) {
  const m = /^\s*client_max_body_size\s+(\d+)([km]?)\s*;/m.exec(text);
  if (!m) throw new Error('no client_max_body_size found in nginx/dashboard.conf');
  return Number(m[1]) * { '': 1, k: 1024, m: 1024 * 1024 }[m[2]];
}
const SITE_BODY_LIMIT = bodyLimit(nginxConf.slice(nginxConf.indexOf('server {')));
const WALLPAPER_BODY_LIMIT = bodyLimit(
  /location = \/api\/wallpaper\/upload \{([\s\S]*?)\n {4}\}/.exec(nginxConf)?.[1] || '',
);

const TOO_LARGE = 'That image is too large for the server to accept.';
const WALLPAPER = { type: 'url', url: '/icons/wallpaper/none.png', brightness: 1, fit: 'fill' };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')], settings: { background: { ...WALLPAPER } } });
  await dismissSetupPrompt(request);
});

test.afterEach(async ({ request }) => {
  await seedConfig(request, { items: [] });
});

/** A file that starts like a PNG, so only its size can refuse it.
    @param {import('@playwright/test').TestInfo} testInfo @param {string} name @param {number} bytes */
function oversizePng(testInfo, name, bytes) {
  const file = testInfo.outputPath(name);
  const data = Buffer.alloc(bytes);
  encodePng(1, 1, [0, 0, 0]).copy(data);
  fs.writeFileSync(file, data);
  return file;
}

/** @param {import('@playwright/test').TestInfo} testInfo @param {string} name @param {Buffer} data */
function writeFile(testInfo, name, data) {
  const file = testInfo.outputPath(name);
  fs.writeFileSync(file, data);
  return file;
}

/** @param {import('@playwright/test').Page} page @param {string} button @param {string} file @param {string} route */
async function upload(page, button, file, route) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(button).click()]);
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith(route) && r.request().method() === 'POST', { timeout: 20_000 }),
    chooser.setFiles(file),
  ]);
  return res;
}

/** @param {import('@playwright/test').Page} page */
async function openAppEditor(page) {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();
  await page.locator('#ip-upload-lbl').waitFor({ state: 'visible' });
}

/** @param {import('@playwright/test').Page} page */
async function openAppearance(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  await expect(page.locator('#ie-bgurl-v')).toContainText('/icons/wallpaper/none.png');
}

/** @param {import('@playwright/test').Response} res @param {number} status */
async function expectTooLarge(res, status) {
  expect(res.status()).toBe(status);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(await res.json()).toMatchObject({ kind: 'invalid', code: 'invalid.too-large' });
}

test('an uploaded icon is stored, served and shown on the dashboard', async ({ page, request }, testInfo) => {
  const png = encodePng(48, 48, [32, 140, 220]);
  await openAppEditor(page);
  const res = await upload(page, '#ip-upload-lbl', writeFile(testInfo, 'e2e-upload.png', png), '/api/icons/upload');
  expect(res.status()).toBe(200);
  const { filename } = await res.json();
  expect(filename).toMatch(/^e2e-upload(-\d+)?\.png$/);
  await expect(page.locator('#toast')).toHaveText(`Uploaded ⁨${filename}⁩`);
  const src = `/icons/${encodeURIComponent(filename)}`;
  await expect(page.locator('#ipv img')).toHaveAttribute('src', src);

  const served = await request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(Buffer.compare(await served.body(), png)).toBe(0);
  expect((await (await request.get('/api/icons/local')).json()).files).toContain(filename);

  await saveEditor(page);
  expect((await readConfig(request)).items.find(i => i.id === 'alpha').iconUrl).toBe(filename);
  await page.goto('/');
  const tile = page.locator(`img[src="${src}"]`).first();
  await expect(tile).toBeVisible();
  await expect.poll(() => tile.evaluate(img => /** @type {HTMLImageElement} */ (img).naturalWidth)).toBe(48);
});

for (const [limit, name, bytes, status] of [
  ['the API', 'e2e-big-api', ICON_MAX_BYTES + 1, 400],
  ['nginx', 'e2e-big-nginx', SITE_BODY_LIMIT + 1, 413],
]) {
  test(`an icon over the limit ${limit} sets is refused with a message`, async ({ page, request }, testInfo) => {
    await openAppEditor(page);
    const res = await upload(page, '#ip-upload-lbl', oversizePng(testInfo, `${name}.png`, bytes), '/api/icons/upload');
    await expectTooLarge(res, status);
    await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
    await expect(page.locator('#toast')).toHaveText(`Could not upload the file. ${TOO_LARGE}`);
    const files = (await (await request.get('/api/icons/local')).json()).files;
    expect(files.filter(f => f.startsWith(name))).toEqual([]);
  });
}

test('an uploaded wallpaper is stored, served and shown on the dashboard', async ({ page, request }, testInfo) => {
  const png = encodePng(320, 200, [180, 90, 30]);
  await openAppearance(page);
  const res = await upload(page, '#bg-upload-lbl', writeFile(testInfo, 'e2e-wall.png', png), '/api/wallpaper/upload');
  expect(res.status()).toBe(200);
  const { url } = await res.json();
  expect(url).toMatch(/^\/icons\/wallpaper\/wallpaper-[0-9a-z]+-[0-9a-f]{8}\.png$/);
  await expect(page.locator('#toast')).toHaveText('Wallpaper stored on this server.');
  await expect(page.locator('#ie-bgurl-v')).toHaveText(url);

  const served = await request.get(url);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(Buffer.compare(await served.body(), png)).toBe(0);

  const [saved] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'POST'),
    page.locator('#bg-save').click(),
  ]);
  expect(saved.status()).toBe(200);
  expect((await readConfig(request)).settings.background.url).toBe(url);
  await page.goto('/');
  await page.locator('#pages').waitFor();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundImage))
    .toContain(url);
});

test('a wallpaper over the limit the API sets is refused with a message', async ({ page, request }, testInfo) => {
  await openAppearance(page);
  const file = oversizePng(testInfo, 'e2e-big-wall.png', UPLOAD_MAX_BYTES + 1);
  const res = await upload(page, '#bg-upload-lbl', file, '/api/wallpaper/upload');
  await expectTooLarge(res, 400);
  await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
  await expect(page.locator('#toast')).toHaveText(`Could not save the wallpaper. ${TOO_LARGE}`);
  await expect(page.locator('#ie-bgurl-v')).toHaveText('/icons/wallpaper/none.png');
  expect((await readConfig(request)).settings.background.url).toBe('/icons/wallpaper/none.png');
});

/* Headers only. nginx answers from the stated length, so no 20 MB body is sent. */
test('nginx refuses a wallpaper body over its own limit with the API error shape', async () => {
  const { hostname, port } = new URL(BASE_URL);
  const reply = await new Promise((resolve, reject) => {
    const socket = net.connect(Number(port) || 80, hostname);
    let data = '';
    socket.setTimeout(10_000, () => socket.destroy(new Error('nginx did not answer')));
    socket.on('connect', () =>
      socket.write(
        'POST /api/wallpaper/upload HTTP/1.1\r\n' +
          `Host: ${new URL(BASE_URL).host}\r\n` +
          'Content-Type: multipart/form-data; boundary=x\r\n' +
          `Content-Length: ${WALLPAPER_BODY_LIMIT + 1}\r\n` +
          'Connection: close\r\n\r\n',
      ),
    );
    socket.on('data', chunk => {
      data += chunk;
      const split = data.indexOf('\r\n\r\n');
      const length = /^content-length: *(\d+)/im.exec(data.slice(0, split));
      if (split >= 0 && length && Buffer.byteLength(data.slice(split + 4)) >= Number(length[1])) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
  const [head, body] = String(reply).split('\r\n\r\n');
  expect(head).toMatch(/^HTTP\/1\.1 413 /);
  expect(head).toMatch(/^content-type: application\/json/im);
  expect(JSON.parse(body)).toMatchObject({ kind: 'invalid', code: 'invalid.too-large' });
});
