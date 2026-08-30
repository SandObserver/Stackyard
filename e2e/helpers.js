// @ts-check
/* Seed through the API, never by writing the config file: a spec must work
   against a container it shares no filesystem with, and the seed must pass the
   same validation a real save does. */

const { expect } = require('@playwright/test');
const { BASE_URL } = require('./base-url');

/** Replace the whole config. @param {import('@playwright/test').APIRequestContext} request */
async function seedConfig(request, config) {
  const body = { _schemaVersion: 3, items: [], settings: {}, ...config };
  /* A write has to state its origin, and this request context is not a page. */
  const res = await request.post('/api/config', { data: body, headers: { Origin: BASE_URL } });
  expect(res.ok(), `seeding failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Clear the first-run setup prompt. Until it is dismissed the dashboard shows
    the prompt and never builds its tiles, so every dashboard spec needs this.
    @param {import('@playwright/test').APIRequestContext} request */
async function dismissSetupPrompt(request) {
  const res = await request.post('/api/auth/dismiss-setup', { headers: { Origin: BASE_URL } });
  expect(res.ok(), `dismissing the setup prompt failed: ${res.status()}`).toBeTruthy();
}

/** The config as the server holds it. */
async function readConfig(request) {
  const res = await request.get('/api/config');
  expect(res.ok(), `reading config failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Find a saved item, failing with what is actually stored. */
function expectItem(cfg, predicate, what) {
  const found = (cfg.items || []).find(predicate);
  const summary = (cfg.items || []).map(i => `${i.type}:${i.id}:${JSON.stringify(i.label)}`).join(', ');
  expect(found, `${what} was not saved. Config holds: [${summary}]`).toBeTruthy();
  return found;
}

/** An app item, with only the fields a hand-written fixture needs. */
function app(id, label, href = `http://example.invalid/${id}`) {
  return { id, type: 'app', label, href, color: 'dark', dock: false };
}

/** Open Settings and switch to the Dashboard section. Admin has no URL
    routing: the section is chosen by clicking the sidebar. */
async function openDashboardList(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="dashboard"]').click();
  await page.locator('#btn-add').waitFor({ state: 'visible' });
}

/** Set one inline-edit row: click the value, type, commit with Enter. */
async function setInlineRow(page, rowId, inputId, value) {
  const row = page.locator(`#${rowId}`);
  await row.locator('.rv').click();
  const input = page.locator(`#${inputId}`);
  await input.waitFor({ state: 'visible' });
  await input.fill(value);
  await input.press('Enter');
}

/** Click the editor's Save and wait for the write to land. Clicking returns as
    soon as the event is dispatched, so reading the config straight afterwards
    races the request. */
async function saveEditor(page) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST'),
    page.locator('#ev-save').click(),
  ]);
  expect(response.status(), `saving returned ${response.status()}: ${await response.text()}`).toBe(200);
  return response;
}

/** Names in the dashboard list, in the order they appear. */
function rowNames(page) {
  return page.locator('#al .rnm').allTextContents();
}

/** The row for a named item. */
function rowByName(page, name) {
  return page.locator('#al .row').filter({ has: page.locator('.rnm', { hasText: name }) });
}

/* ── Reading a real pixel ─────────────────────────────────────────────────── */

/* Translucent chrome over a wallpaper cannot be judged from the stylesheet: what
   the eye gets is the blur and every layer composited together. So these read
   the pixel the browser actually painted.

   Playwright vendors a PNG decoder, but it is an internal of the bundle and
   would break on an upgrade. A screenshot is 8-bit non-interlaced RGB or RGBA,
   which zlib and twenty lines cover. */

const zlib = require('node:zlib');

/** @param {Buffer} png @returns {{width:number,height:number,channels:number,data:Buffer}} */
function decodePng(png) {
  let width = 0,
    height = 0,
    channels = 0;
  const idat = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8],
        colour = body[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unexpected screenshot format: depth ${depth}, colour type ${colour}`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  /* Undo the per-row filter. Each row is prefixed by its filter type. */
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const line = out.subarray(y * stride, (y + 1) * stride);
    const prior = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prior[x];
      const c = x >= channels ? prior[x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** The colour the browser painted at the centre of an element.
    @param {import('@playwright/test').Locator} locator @returns {Promise<[number,number,number]>} */
async function centrePixel(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element is not visible');
  const shot = await locator.page().screenshot({
    clip: { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 1, height: 1 },
  });
  const { data } = decodePng(shot);
  return [data[0], data[1], data[2]];
}

/** The colour the browser painted at one point inside an element.
    @param {import('@playwright/test').Locator} locator
    @param {number} fx @param {number} fy fractions of the element's box
    @returns {Promise<[number,number,number]>} */
async function pixelAt(locator, fx, fy) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element is not visible');
  const shot = await locator.page().screenshot({
    clip: { x: box.x + box.width * fx, y: box.y + box.height * fy, width: 1, height: 1 },
  });
  const { data } = decodePng(shot);
  return [data[0], data[1], data[2]];
}

/** WCAG relative luminance. @param {[number,number,number]} rgb */
function luminance([r, g, b]) {
  const lin = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two painted colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour at one point, once it has stopped changing. A panel that fades or
    blurs in is still moving when it first becomes visible, and a sample taken
    then measures a frame the reader never sees.
    @param {import('@playwright/test').Locator} locator
    @param {number} fx @param {number} fy fractions of the element's box
    @returns {Promise<[number,number,number]>} */
async function settledPixelAt(locator, fx, fy) {
  let previous = await pixelAt(locator, fx, fy);
  for (let i = 0; i < 20; i++) {
    await locator.page().waitForTimeout(100);
    const current = await pixelAt(locator, fx, fy);
    if (current.every((c, n) => c === previous[n])) return current;
    previous = current;
  }
  throw new Error(`the colour at ${fx},${fy} never settled: last read rgb(${previous})`);
}

module.exports = {
  seedConfig,
  dismissSetupPrompt,
  readConfig,
  expectItem,
  saveEditor,
  app,
  openDashboardList,
  setInlineRow,
  rowNames,
  rowByName,
  centrePixel,
  pixelAt,
  settledPixelAt,
  contrast,
};
