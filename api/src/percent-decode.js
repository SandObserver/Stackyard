/** Decode, or return null when the input is not valid percent-encoding.
    @param {string} value @returns {string|null} */
function tryDecode(value) {
  const str = String(value ?? '');
  if (!str.includes('%')) return str;
  try {
    return decodeURIComponent(str);
  } catch {
    return null;
  }
}

/** Decode, falling back to the raw value.
    @param {string} value @returns {string} */
function decodeOrRaw(value) {
  const str = String(value ?? '');
  const decoded = tryDecode(str);
  return decoded === null ? str : decoded;
}

module.exports = { tryDecode, decodeOrRaw };
