// @ts-check
/* Password strength scoring, shared by the admin settings form and the
   dashboard's first-run setup prompt.

   It lived in both, character for character apart from two comments, so the
   thresholds a password is judged against were defined twice.

   Returns a label *key*, not a display string. The labels used to be hardcoded
   English, and both callers put them in front of the user: the setup dialog
   writes one into its hint, and admin-settings interpolates one into
   t('toast.pwWeak'), which produced a translated sentence ending in an English
   word. Returning a key keeps this module free of an i18n import, which
   admin-auth.js (one of its consumers) does not otherwise have. */

const DIM = 'rgba(255,255,255,.1)';

/* Five bars, so five scores, but four labels: the top two both read as strong.

   The index used to be `Math.min(4, score - 1)` against these four-entry
   arrays, so a password scoring the maximum indexed past the end and got
   `undefined` for both. The setup dialog assigns the label straight to
   `hint.textContent`, which renders the string "undefined", so the strongest
   possible password was the one that looked broken. Clamping to the last entry
   is what the four labels were always meant to do. */
const LABEL_KEYS = ['pwStrength.weak', 'pwStrength.fair', 'pwStrength.good', 'pwStrength.strong'];
const COLORS     = ['#ff9f0a', '#ffd60a', '#34c759', '#34c759'];
const BARS = 5;

export const MIN_PASSWORD_LENGTH = 8;

/** Score a password.
    @param {string} pw
    @returns {{ score:number, labelKey:string, color:string, ok:boolean }}
    `labelKey` is '' when there is nothing to say; otherwise pass it to t(). */
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
