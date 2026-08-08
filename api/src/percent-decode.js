/* Percent-decoding that does not throw. decodeURIComponent raises URIError on an
   invalid escape, so a stray '%' in untrusted input becomes a 500. What a failure
   means is left to the caller, because it differs by call site. */

/** Decode, or return null when the input is not valid percent-encoding.
    Callers decide what null means.
    @param {string} value @returns {string|null} */
function tryDecode(value) {
  const str = String(value ?? '');
  /* Nothing to decode, and nothing that can fail. Worth the check: this is the
     common case, on every request. */
  if (!str.includes('%')) return str;
  try { return decodeURIComponent(str); }
  catch { return null; }
}

/** Decode, falling back to the raw value. For inputs where a malformed escape
    should be carried through rather than rejected.
    @param {string} value @returns {string} */
function decodeOrRaw(value) {
  const str = String(value ?? '');
  const decoded = tryDecode(str);
  return decoded === null ? str : decoded;
}

module.exports = { tryDecode, decodeOrRaw };
