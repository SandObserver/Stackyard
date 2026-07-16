/* Content check for uploaded raster icons, split out from the icons route so it
   can be unit-tested. SVGs are not handled here: they go through svg-sanitize,
   which is a stronger control than a signature match.

   The goal is to reject non-images that carry an image extension, not to police
   filename honesty, so a PNG named .ico passes. Browsers accept that too, and
   nginx serves uploads as static files either way. */

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/* reserved=0, type=1 (icon). type=2 is a cursor and is not accepted. */
const ICO = [0x00, 0x00, 0x01, 0x00];

function startsWith(buf, sig) {
  if (!buf || buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

function sniffIconType(buf) {
  if (startsWith(buf, PNG)) return 'png';
  if (startsWith(buf, ICO)) return 'ico';
  return null;
}

module.exports = { sniffIconType };
