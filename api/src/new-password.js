const fs = require('fs');
const path = require('path');
const { PASSWORD_MIN, PASSWORD_MAX, contextWords, passwordProblem } = require('../../ui/js/password-policy.js');

/* Entries must be lower case and NFC, or a match is missed. */
const COMMON = new Set(
  fs
    .readFileSync(path.join(__dirname, 'common-passwords.txt'), 'utf8')
    .split('\n')
    .filter(line => line && !line.startsWith('#')),
);

const isCommonPassword = password => COMMON.has(password.normalize('NFC').toLowerCase());

/** Why a new password is refused, or null. Never call it for a password being
    checked against the stored one: existing passwords keep working.
    @param {unknown} password @param {string} [host]
    @returns {{ code: string, error: string } | null} */
function newPasswordError(password, host = '') {
  const pw = typeof password === 'string' ? password : '';
  const problem = passwordProblem(pw, contextWords(host));
  if (problem === 'short')
    return { code: 'invalid.password-short', error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (problem === 'long')
    return { code: 'invalid.password-long', error: `Password must be at most ${PASSWORD_MAX} characters.` };
  if (problem === 'guessable' || isCommonPassword(pw))
    return { code: 'invalid.password-common', error: 'This password is too common or too easy to guess.' };
  return null;
}

module.exports = { newPasswordError, isCommonPassword };
