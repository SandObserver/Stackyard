/* Version precedence, per semver.org section 11. */

/** @typedef {{ nums: number[], pre: string[] }} Parsed */

/** @param {unknown} v @returns {Parsed} */
function parseVersion(v) {
  let s = String(v ?? '')
    .trim()
    .replace(/^v/i, '');
  s = s.split('+')[0];
  const dash = s.indexOf('-');
  const core = dash === -1 ? s : s.slice(0, dash);
  const pre = dash === -1 ? '' : s.slice(dash + 1);

  const nums = core
    .split('.')
    .slice(0, 3)
    .map(p => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
  while (nums.length < 3) nums.push(0);

  return { nums, pre: pre === '' ? [] : pre.split('.') };
}

const NUMERIC = /^\d+$/;

/** @returns {number} */
function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i],
      y = b[i];
    if (x === y) continue;
    const xn = NUMERIC.test(x),
      yn = NUMERIC.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** -1, 0 or 1 for a before, equal to, or after b.
    @param {unknown} a @param {unknown} b @returns {number} */
function compareVersions(a, b) {
  const pa = parseVersion(a),
    pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
function isNewer(a, b) {
  return compareVersions(a, b) > 0;
}

module.exports = { parseVersion, compareVersions, isNewer };
