/* Wallpaper formats, identified by their own bytes. The extension a browser
   sends is not evidence of anything. */

const SIGNATURES = [
  { type: 'png', ext: '.png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'jpeg', ext: '.jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', ext: '.gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** @param {Buffer} buf @param {number[]} sig @param {number} [at] */
function startsWith(buf, sig, at = 0) {
  if (!buf || buf.length < at + sig.length) return false;
  return sig.every((b, i) => buf[at + i] === b);
}

/** @param {Buffer} buf @returns {string|null} */
function riffBrand(buf) {
  if (!startsWith(buf, [0x52, 0x49, 0x46, 0x46]) || !startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return null;
  return 'webp';
}

/** ISO base media: the brand follows the 'ftyp' box type. */
function isoBrand(buf) {
  if (!startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) return null;
  const brand = buf.slice(8, 12).toString('latin1');
  return brand === 'avif' || brand === 'avis' ? 'avif' : null;
}

/** The format of an image, or null when it is not one this project accepts.

    @param {Buffer} buf
    @returns {{type: string, ext: string, mime: string}|null} */
function sniffImageType(buf) {
  for (const s of SIGNATURES) if (startsWith(buf, s.bytes)) return { type: s.type, ext: s.ext, mime: s.mime };
  if (riffBrand(buf)) return { type: 'webp', ext: '.webp', mime: 'image/webp' };
  if (isoBrand(buf)) return { type: 'avif', ext: '.avif', mime: 'image/avif' };
  return null;
}

module.exports = { sniffImageType };
