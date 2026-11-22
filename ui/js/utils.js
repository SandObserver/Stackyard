import { iconChain } from '/js/icons.js?v=76c29d43';
import { toneForColor } from '/js/label-contrast.js?v=a160c6d1';
import { SETTINGS_ICON, SETTINGS_ICON_LIGHT } from '/js/settings-icon.js?v=4079b66a';
import { t } from '/js/i18n.js?v=82ba9da2';
import { pageTheme, tileColor } from '/js/palette.js?v=3fb8ae43';

export const mk = (tag, a = {}) => {
  const e = document.createElement(tag);
  Object.assign(e, a);
  return e;
};
/** @param {Element|null|undefined} root */
export function loadImagesNow(root) {
  root?.querySelectorAll('img[loading="lazy"]').forEach(img => {
    /** @type {HTMLImageElement} */ (img).loading = 'eager';
  });
}
/** @param {Promise<unknown>} work @param {number} ms @returns {Promise<void>} */
export function within(work, ms) {
  return new Promise(resolve => {
    const done = () => resolve();
    work.then(done, done);
    setTimeout(done, ms);
  });
}

/* Site storage blocked by the browser throws on every access. */
/** @param {string} key @returns {string|null} */
export function storeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
export function storeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/* Every colour an item renders with passes through here, and the value can
   arrive in an imported config. It is assigned to a background, where a CSS
   url() fetches from whatever host it names. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z%.,\s/+-]*\)|[a-z]{3,20})$/i;
const DEFAULT_TILE_COLOR = '#1C1C1E';

/** Reject an invalid colour. Repairing one by deleting characters paints a
    colour nobody chose.
    @param {unknown} c @param {string} fallback @returns {string} */
export const cssColor = (c, fallback) => {
  const v = String(c ?? '').trim();
  return v && SAFE_COLOR.test(v) ? v : fallback;
};

export const clr = c => {
  if (!c) return DEFAULT_TILE_COLOR;
  const named = tileColor(c, pageTheme());
  if (named) return named;
  return cssColor(c, DEFAULT_TILE_COLOR);
};
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** The first visible character, upper-cased. Indexing a string splits an emoji
    into half a surrogate pair, which draws as a replacement box.
    @param {string|null|undefined} text @returns {string} */
export const initial = text => {
  for (const { segment } of GRAPHEMES.segment(text || '?')) return segment.toUpperCase();
  return '?';
};
/** A name for a translated sentence, isolated so its punctuation stays with it
    in the other direction.
    @param {string} text @returns {string} */
export const isolate = text => `\u2068${text}\u2069`;
/* The plate is a colour the user chose, so the ink has to be measured from it.
   White on the palette's own yellow reads at 1.5:1. */
export const letterTile = (l, sz, plate) => {
  const e = mk('span');
  e.className = 'fb';
  /* A right-to-left page mirrors a lone bracket: "<" draws as ">". */
  e.dir = 'ltr';
  const tone = toneForColor(plate) ?? (pageTheme() === 'light' ? 'dark' : 'light');
  if (tone === 'dark') e.classList.add('fb-on-light');
  e.style.fontSize = Math.round(sz * 0.32) + 'px';
  e.textContent = initial(l);
  return e;
};
export { esc } from '/js/html.js?v=48f9dc21';

/* A name the user typed has its own direction. Without that an English name
   inside a Persian dashboard lays out right-to-left and an over-long one loses
   its head rather than its tail.

   The isolation goes on a <bdi> around the text, not on the block. `dir` sets
   alignment as well as bidi, so a Latin name on the block dragged its whole row
   to the other edge: a title and its subtitle ended up on opposite sides.

   @param {HTMLElement} node @param {string} text @returns {HTMLElement} */
export const setUserText = (node, text) => {
  node.textContent = '';
  const bdi = mk('bdi');
  bdi.textContent = text;
  node.appendChild(bdi);
  return node;
};

/** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
const liveTimers = new WeakMap();

/** Clears the region first, so the same text is read again.
    @param {Element} node @param {string} text */
export function setLiveText(node, text) {
  clearTimeout(liveTimers.get(node));
  liveTimers.delete(node);
  if (!text || node.textContent !== text) {
    node.textContent = text;
    return;
  }
  node.textContent = '';
  liveTimers.set(
    node,
    setTimeout(() => {
      liveTimers.delete(node);
      node.textContent = text;
    }, 50),
  );
}

/* A centred label that ellipsises. The block's direction decides which end is
   cut, so it takes dir="auto" and no <bdi>: dir="auto" skips text inside a bdi
   and would resolve to ltr.

   @param {HTMLElement} node @param {string} text @returns {HTMLElement} */
export const setCentredText = (node, text) => {
  node.dir = 'auto';
  node.textContent = text;
  return node;
};

/* A page strip is laid out in the page's direction, so the next page sits to the
   left in one direction and to the right in the other. translateX has no logical
   form, and a strip moved the wrong way leaves the screen: 1 where a page
   advances leftwards, -1 where it advances rightwards.

   The same number mirrors the inputs. A leftward drag and the right arrow ask
   for the next page in one direction and the previous page in the other. */
export const pageDir = () => (getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1);

/* A tile label is one line and ellipsises. The full name is on the anchor's
   accessible name either way, so this is for a pointer: a tooltip only where the
   text is actually cut, because one on every tile is noise.

   @param {ParentNode} [root] */
export function titleWhenTruncated(root = document) {
  for (const label of root.querySelectorAll('.ilabel, .dyn-mob-label, .dyn-fold-label')) {
    const tile = /** @type {HTMLElement|null} */ (label.closest('a, button'));
    if (!tile) continue;
    const text = label.textContent || '';
    if (label.scrollWidth > label.clientWidth + 1) tile.title = text;
    else if (tile.title === text) tile.removeAttribute('title');
  }
}

/* Strip quotes, parens and backslashes. A user URL must not break out of a CSS
   url('...') wrapper. */
export const sanitizeCssUrl = u => String(u || '').replace(/['"\\()]/g, '');

/* ── Typed element lookups ───────────────────────────────────────────────────
   None of these check for null. They look up elements the page itself renders,
   so a missing one is a bug in the markup. */

/** @param {string} id @returns {HTMLElement} */
export const el = id => /** @type {HTMLElement} */ (document.getElementById(id));

/** A form control: input, select or textarea.
    @param {string} id @returns {HTMLInputElement} */
export const inp = id => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLElement} */
export const q = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLInputElement} */
export const qi = (sel, root = document) => /** @type {HTMLInputElement} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLElement[]} */
export const qa = (sel, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(sel)]);

/** The form control an event came from.
    @param {Event} e @returns {HTMLInputElement} */
export const tgt = e => /** @type {HTMLInputElement} */ (e.target);

/** @param {HTMLInputElement} field */
export function plainInput(field) {
  field.setAttribute('autocapitalize', 'none');
  field.setAttribute('autocorrect', 'off');
  field.setAttribute('spellcheck', 'false');
}

/** Focus the first candidate that is attached, enabled and rendered.
    @param {...(Element|null|undefined)} els @returns {boolean} whether one took focus */
export function focusFirst(...els) {
  for (const e of els) {
    const h = /** @type {HTMLElement & { disabled?: boolean }} */ (e);
    if (!h?.isConnected || h.disabled || h.hidden || !h.getClientRects().length) continue;
    h.focus();
    if (document.activeElement === h) return true;
  }
  return false;
}

/** @param {Element} parent @param {number} current */
export function inertAllBut(parent, current) {
  [...parent.children].forEach((child, i) => {
    if (i === current) child.removeAttribute('inert');
    else child.setAttribute('inert', '');
  });
}

export const ICON_R = 0.26;

/* breg is passed in to avoid a circular import. */
export function mkWrap(item, sz, r, isz, cls, breg) {
  const w = mk('div');
  w.className = cls ? `plate ${cls}` : 'plate';
  const colour = item.system === 'settings' ? 'auto' : (item.color ?? '');
  const wrapBg = clr(colour);
  const clear = item.color === 'clear' && item.system !== 'settings';
  w.dataset.color = colour;
  w.style.cssText = `--tc:${wrapBg};width:${sz}px;height:${sz}px;border-radius:${r}px;${clear ? '' : `background-color:${wrapBg};`}position:relative;flex-shrink:0;overflow:visible;display:flex;align-items:center;justify-content:center;`;
  if (clear) w.classList.add('plate-clear', 'glass-surface');
  const rawIcon = item.iconUrl || '';
  if (item.system === 'settings') {
    const si = Math.min(sz, Math.round(isz * 1.22));
    const img = mk('img', {
      src: pageTheme() === 'light' ? SETTINGS_ICON_LIGHT : SETTINGS_ICON,
      alt: '',
      draggable: false,
    });
    img.setAttribute('aria-hidden', 'true');
    img.className = 'settings-glyph';
    img.style.cssText = `width:${si}px;height:${si}px;object-fit:contain;position:relative;z-index:3;`;
    img.onerror = () => img.replaceWith(letterTile(item.label, sz, clr(colour)));
    w.appendChild(img);
  } else if (rawIcon) {
    const chain = iconChain(rawIcon);
    if (chain.length) {
      const img = mk('img', { src: chain[0], alt: '', loading: 'lazy', draggable: false });
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText = `width:${isz}px;height:${isz}px;object-fit:contain;position:relative;z-index:3;`;
      let step = 0;
      const tryNext = () => {
        step++;
        if (step < chain.length) img.src = chain[step];
        else img.replaceWith(letterTile(item.label, sz, clr(colour)));
      };
      img.onerror = tryNext;
      /* A 403 fires load, not onerror. A blocked image has zero dimensions. */
      img.onload = () => {
        if (img.naturalWidth === 0) tryNext();
      };
      w.appendChild(img);
    } else w.appendChild(letterTile(item.label, sz, wrapBg));
  } else w.appendChild(letterTile(item.label, sz, wrapBg));
  if (
    breg &&
    (item.monitoring?.healthcheck?.enabled ||
      item.monitoring?.activity?.enabled ||
      item.monitoring?.staticBadge?.enabled ||
      item.container ||
      item.badge?.enabled)
  ) {
    const b = mk('div');
    b.className = 'badge';
    w.appendChild(b);
    breg(item.id, b);
  }
  return w;
}

/** @param {ParentNode} [root] */
export function rethemeTiles(root = document) {
  const light = pageTheme() === 'light';
  const ink = plate => (toneForColor(plate) ?? (light ? 'dark' : 'light')) === 'dark';
  for (const node of root.querySelectorAll('.plate[data-color]')) {
    const w = /** @type {HTMLElement} */ (node);
    const bg = clr(w.dataset.color);
    w.style.setProperty('--tc', bg);
    if (!w.classList.contains('plate-clear')) w.style.backgroundColor = bg;
    w.querySelector(':scope > .fb')?.classList.toggle('fb-on-light', ink(bg));
    const glyph = /** @type {HTMLImageElement|null} */ (w.querySelector(':scope > img.settings-glyph'));
    if (glyph) glyph.src = light ? SETTINGS_ICON_LIGHT : SETTINGS_ICON;
  }
  for (const node of root.querySelectorAll('.folder-mini-bg[data-color]')) {
    const m = /** @type {HTMLElement} */ (node);
    const bg = clr(m.dataset.color);
    m.style.background = bg;
    m.querySelector(':scope > .folder-mini-fb')?.classList.toggle('fb-on-light', ink(bg));
  }
}

/** @param {any[]} items */
export const isDashboardEmpty = items => !(items || []).some(i => i && !i.system && !i.hidden);

/* Keep this on the body. A child of the page strip counts as a page.

   @param {any[]} items */
export function renderEmptyState(items) {
  document.querySelector('.empty-state')?.remove();
  if (!isDashboardEmpty(items)) return;

  const box = mk('div');
  box.className = 'empty-state';
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('class', 'sy-icon empty-state-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#sy-solid-logo');
  mark.append(use);
  const title = mk('h2');
  title.className = 'empty-state-title';
  title.textContent = t('home.emptyTitle');
  const sub = mk('p');
  sub.className = 'empty-state-sub';
  sub.textContent = t('home.emptyBody');
  const btn = mk('a', { href: '/admin/' });
  btn.className = 'empty-state-btn';
  btn.textContent = t('home.emptyAction');
  const hint = mk('a', { href: '/admin/#general' });
  hint.className = 'empty-state-hint';
  hint.textContent = t('home.emptyImportLink');
  box.append(mark, title, sub, btn, hint);
  document.body.appendChild(box);
}
