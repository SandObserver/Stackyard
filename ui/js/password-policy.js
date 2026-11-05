// @ts-check
/* Keep it free of the DOM and of imports: the API requires it. Never apply
   these rules to a stored password: owners with older, shorter passwords would
   be locked out. */

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 1024;

const SERVICE_WORDS = ['stackyard', 'dashboard', 'homelab'];

/** Characters as a person counts them: one per code point, accents composed.
    @param {string} pw @returns {number} */
export function passwordLength(pw) {
  return [...pw.normalize('NFC')].length;
}

/** @param {string} newPassword @param {string} confirmation */
export function passwordMismatch(newPassword, confirmation) {
  const pw = (newPassword || '').normalize('NFC');
  return pw.length > 0 && pw !== (confirmation || '').normalize('NFC');
}

/** Words that name this install: the service and the parts of its host name.
    @param {string} [host] @returns {string[]} */
export function contextWords(host = '') {
  const parts = String(host)
    .toLowerCase()
    .split(/[^\p{L}]+/u);
  return [...SERVICE_WORDS, ...parts.filter(w => w.length >= 3)];
}

function onlyContextWords(pw, words) {
  let letters = pw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  for (const w of [...words].sort((a, b) => b.length - a.length)) letters = letters.split(w).join('');
  return letters === '';
}

/** What is wrong with a new password, or '' when it may be used. Common
    passwords are checked only on the server.
    @param {string} pw @param {string[]} [words] from contextWords
    @returns {'' | 'short' | 'long' | 'guessable'} */
export function passwordProblem(pw, words = contextWords()) {
  const n = passwordLength(pw || '');
  if (n < PASSWORD_MIN) return 'short';
  if (n > PASSWORD_MAX) return 'long';
  if (onlyContextWords(pw, words)) return 'guessable';
  return '';
}

/** Catalog keys that explain why a password was refused, by problem or by the
    server's `invalid.password-*` code. */
export const REFUSAL_KEYS = Object.freeze({
  short: 'hostBlock.tooShort',
  long: 'hostBlock.tooLong',
  guessable: 'pwStrength.guessable',
  common: 'pwStrength.common',
});

const BARS = 5;

/** What a password field shows while the owner types. `lit` bars of five fill
    toward the minimum length. Returns catalog keys, not text.
    @param {string} pw @param {string[]} [words]
    @returns {{ ok: boolean, lit: number, tone: '' | 'short' | 'bad' | 'ok',
                key: string, vars: Record<string, number>, refusalKey: string }} */
export function passwordMeter(pw, words = contextWords()) {
  const problem = passwordProblem(pw || '', words);
  const refusalKey = problem ? REFUSAL_KEYS[problem] : '';
  if (!pw) return { ok: false, lit: 0, tone: '', key: 'pwStrength.tip', vars: {}, refusalKey };
  if (problem === 'short') {
    const count = passwordLength(pw);
    const lit = Math.floor((count * BARS) / PASSWORD_MIN);
    return { ok: false, lit, tone: 'short', key: 'pwStrength.count', vars: { count }, refusalKey };
  }
  if (problem) return { ok: false, lit: BARS, tone: 'bad', key: refusalKey, vars: {}, refusalKey };
  return { ok: true, lit: BARS, tone: 'ok', key: 'pwStrength.enough', vars: {}, refusalKey };
}

/** @param {string} tone from passwordMeter @returns {string} a CSS colour */
export const meterColor = tone =>
  tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : tone === 'short' ? 'var(--warning)' : '';
