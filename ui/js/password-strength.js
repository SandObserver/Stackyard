// @ts-check
/* Returns a label key, not a display string. Keep this module free of an i18n
   import. */

const DIM = 'rgba(255,255,255,.1)';

/* Five scores, four labels. The index must clamp to the last entry. */
const LABEL_KEYS = ['pwStrength.weak', 'pwStrength.fair', 'pwStrength.good', 'pwStrength.strong'];
const COLORS = ['#ff9f0a', '#ffd60a', '#34c759', '#34c759'];
const BARS = 5;

export const MIN_PASSWORD_LENGTH = 8;

export function passwordMismatch(newPassword, confirmation) {
  const pw = newPassword || '';
  return pw.length > 0 && pw !== (confirmation || '');
}

/** @param {string} pw
    @returns {{ score:number, labelKey:string, color:string, ok:boolean }}
    `labelKey` is '' when there is nothing to say. */
export function pwStrength(pw) {
  if (!pw) return { score: 0, labelKey: '', color: DIM, ok: false };
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, labelKey: 'pwStrength.tooShort', color: '#ff453a', ok: false };
  }
  let score = 1; /* starts at 1 once length >= 8 */
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  score = Math.min(BARS, score); /* one bar per point, 1..5 */
  const i = Math.min(LABEL_KEYS.length - 1, score - 1);
  return { score, labelKey: LABEL_KEYS[i], color: COLORS[i], ok: score >= 2 };
}
