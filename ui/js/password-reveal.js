// @ts-check

/** Show or hide every field of a pair together. Any of the buttons toggles
    all of them.
    @param {HTMLButtonElement | HTMLButtonElement[]} buttons @param {HTMLInputElement[]} fields */
export function wireReveal(buttons, fields) {
  const all = [buttons].flat();
  for (const btn of all) {
    /* Keep. A tap must not take focus from the field: Settings saves a row on blur. */
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => setRevealed(all, fields, btn.getAttribute('aria-pressed') !== 'true'));
  }
}

/** @param {HTMLButtonElement[]} buttons @param {HTMLInputElement[]} fields @param {boolean} shown */
export function setRevealed(buttons, fields, shown) {
  for (const f of fields) f.type = shown ? 'text' : 'password';
  for (const btn of buttons) {
    btn.setAttribute('aria-pressed', String(shown));
    const use = btn.querySelector('use');
    const href = use?.getAttribute('href') || '';
    use?.setAttribute('href', href.replace(/-eye(-slash)?$/, shown ? '-eye-slash' : '-eye'));
  }
}

/** Fill each hidden username field with the host name. Password managers file
    the saved password under it, one entry per install.
    @param {ParentNode} [root] */
export function fillUsernames(root = document) {
  for (const f of root.querySelectorAll('input[autocomplete="username"]')) {
    if (f instanceof HTMLInputElement) f.value = location.hostname;
  }
}
