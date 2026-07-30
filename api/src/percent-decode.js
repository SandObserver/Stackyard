/* Percent-decoding that does not throw.

   decodeURIComponent raises URIError on an invalid escape, and both places that
   decoded untrusted input assumed it would not. A stray '%' anywhere in the
   Cookie header, in any cookie on the domain, turned every authenticated request
   into a 500, including the public /api/auth/check. A URL like
   /api/widget-config/% did the same.

   One helper rather than a guard at each call site, so the next place that needs
   to decode untrusted input has something correct to reach for.

   What a failure means is left to the caller, because it differs. A cookie value
   that will not decode is not a reason to fail the request: an unrelated cookie
   is not this application's business, and its own token is hex and dots, so it
   never needs decoding to be recognised. A route parameter that will not decode
   is a bad request, and the caller answers 400. */

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
