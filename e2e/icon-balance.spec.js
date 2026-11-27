// @ts-check

const path = require('node:path');
const { test, expect } = require('@playwright/test');

const LIMIT = 1.5;
const LOGO_HALVES = new Set(['logo-ink', 'logo-arc']);
const INK = '.sy-i,.sy-a,.sy-i3{fill:#000}.sy-is,.sy-as,.sy-i3s{stroke:#000}';

test('every icon balances its weight near the grid centre', async ({ page }) => {
  const { ICONS, symbol } = await import(path.join(__dirname, '..', 'ui', 'js', 'icon-set.js'));
  const svgs = Object.entries(ICONS)
    .filter(([id]) => !LOGO_HALVES.has(id))
    .map(([id, icon]) => {
      const { defs, sym } = symbol(id, icon);
      const body = sym.replace(/^<symbol[^>]*>|<\/symbol>$/g, '');
      return [
        id,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240"><style>${INK}</style><defs>${defs}</defs>${body}</svg>`,
      ];
    });
  const offsets = await page.evaluate(async list => {
    const size = 240;
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(size, size).getContext('2d'));
    const out = {};
    for (const [id, svg] of list) {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await img.decode();
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, size, size).data;
      let [sum, sx, sy] = [0, 0, 0];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const a = px[(y * size + x) * 4 + 3];
          sum += a;
          sx += a * (x + 0.5);
          sy += a * (y + 0.5);
        }
      const unit = size / 24;
      out[id] = [sx / sum / unit - 12, sy / sum / unit - 12].map(n => Math.round(n * 100) / 100);
    }
    return out;
  }, svgs);
  const off = Object.entries(offsets).filter(([, xy]) => xy.some(n => Math.abs(n) > LIMIT));
  expect(off, `weight more than ${LIMIT} grid units from centre`).toEqual([]);
});
