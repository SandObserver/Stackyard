import { closeBadgePopover, holdBadgePopover } from '/js/badge-popover.js?v=578d337c';
import { clampPage, PAGE_TURN_MS } from '/js/dashboard-logic.js?v=b4828b62';
import { formatNumber } from '/js/format-number.js?v=263fa390';
import { easing, glide, isScripted } from '/js/frame-motion.js?v=911f7c03';
import { t } from '/js/i18n.js?v=82ba9da2';
import { EASE_IOS } from '/js/motion-curve.js?v=7fea8800';
import { el, inertAllBut, pageDir, qa, storeSet } from '/js/utils.js?v=457d9918';
import { setRefreshRate } from '/js/widget-frame.js?v=8e76d79b';

export const PAGE_STORE = 'dash_page';

/* Every page is mounted at once, so widgets the user has swiped away from keep
   polling. Off-screen frames run at a fraction of their configured rate. */
const OFF_PAGE_RATE = 4;

export const overlayOpen = () => !!document.querySelector('dialog[open], .cfg-recovery');

const PAGE_FOCUSABLE = 'a[href], button, iframe, [tabindex]:not([tabindex="-1"])';

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash */
export function createPager(dash) {
  const pageEase = easing(EASE_IOS);
  let _rateBound = false;
  let _willChangeTimer = 0;

  /** @param {Event} e */
  const onFrameLoad = e => {
    if (/** @type {Element} */ (e.target).tagName === 'IFRAME') applyPollRates();
  };
  function applyPollRates() {
    const strip = el('pages');
    if (!strip) return;
    /* A frame that has not loaded yet carries no toolbox to tell. A refresh
       loads a new frame element. */
    if (!_rateBound) {
      _rateBound = true;
      strip.addEventListener('load', onFrameLoad, true);
    }
    Array.from(strip.children).forEach((page, i) => {
      const rate = i === dash.pg ? 1 : OFF_PAGE_RATE;
      setRefreshRate(page, rate);
      qa('iframe', /** @type {HTMLElement} */ (page)).forEach(ifr => {
        const frame = /** @type {HTMLIFrameElement} */ (ifr);
        try {
          /** @type {any} */ (frame.contentWindow)?.__setPollRate?.(rate);
        } catch {
          /* A frame mid-navigation has no reachable window. */
        }
      });
    });
  }

  /** @param {HTMLElement} strip @param {number} n @param {number} ms
      @param {() => void} landed runs when the strip comes to rest */
  function slidePages(strip, n, ms, landed) {
    const shift = `translateX(${-pageDir() * n * 100}%)`;
    if (!isScripted()) {
      strip.style.transform = shift;
      const runs = strip.getAnimations();
      if (runs.length) Promise.allSettled(runs.map(a => a.finished)).then(landed);
      else landed();
      return;
    }
    const m = getComputedStyle(strip).transform;
    const from = m === 'none' ? 0 : new DOMMatrixReadOnly(m).m41;
    const to = -pageDir() * n * strip.offsetWidth;
    glide(
      strip,
      ms,
      pageEase,
      p => {
        strip.style.transform = `translateX(${from + (to - from) * p}px)`;
      },
      () => {
        strip.style.transform = shift;
        landed();
      },
    );
  }

  /** @param {number} [ms] how long the move takes */
  function goTo(n, announce = true, bump = true, ms = PAGE_TURN_MS) {
    const was = dash.pg;
    dash.pg = clampPage(n, dash.totalPages);
    if (dash.pg !== was) closeBadgePopover();
    if (dash.pg !== was && announce) announcePage(dash.pg, dash.totalPages);
    storeSet(PAGE_STORE, String(dash.pg));
    const strip = el('pages');
    const focused = document.activeElement;
    syncPageInert(dash.pg);
    const landed = holdBadgePopover();
    followFocus(strip, dash.pg, focused);
    slidePages(strip, dash.pg, ms, landed);
    strip.style.willChange = 'transform';
    clearTimeout(_willChangeTimer);
    _willChangeTimer = window.setTimeout(() => {
      if (!strip.classList.contains('dragging')) strip.style.willChange = 'auto';
    }, PAGE_TURN_MS + 50);
    document.querySelectorAll('.dot').forEach((d, i) => {
      d.classList.toggle('on', i === dash.pg);
      if (i === dash.pg) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    if (dash.mob && bump && dash.CB.mobPillBump) dash.CB.mobPillBump(dash.pg);
    syncPager(dash.totalPages);
    applyPollRates();
  }

  /** @param {number} total */
  function syncPager(total) {
    const pager = /** @type {HTMLInputElement|null} */ (el('mob-pager'));
    if (!pager) return;
    pager.hidden = !dash.mob || total < 2;
    pager.max = String(Math.max(1, total));
    pager.value = String(dash.pg + 1);
    pager.setAttribute(
      'aria-valuetext',
      t('home.pageAnnounce', { page: formatNumber(dash.pg + 1), total: formatNumber(total) }),
    );
  }

  return { goTo };
}

/** @typedef {ReturnType<typeof createPager>} Pager */

/* Announce user-initiated page changes only. Announcing polled health talks
   over whatever someone is doing every time a service flaps.

   @param {number} index @param {number} total */
function announcePage(index, total) {
  const live = el('page-live');
  if (!live) return;
  live.textContent = t('home.pageAnnounce', { page: formatNumber(index + 1), total: formatNumber(total) });
}

/** Move focus left on a page that turned inert onto the page now shown.
    @param {HTMLElement} strip @param {number} current @param {Element|null} focused */
function followFocus(strip, current, focused) {
  if (!focused || !strip.contains(focused)) return;
  const page = strip.children[current];
  if (!page || page.contains(focused)) return;
  const next = [...page.querySelectorAll(PAGE_FOCUSABLE), ...document.querySelectorAll('#dots .dot.on')].find(
    n => !(/** @type {HTMLElement} */ (n).hidden),
  );
  /* Keep preventScroll. A focus scroll moves the strip off its page. */
  /** @type {HTMLElement|undefined} */ (next)?.focus({ preventScroll: true });
}

/* A page that has scrolled off is still in the DOM and still focusable, so Tab
   walks out of the visible page into tiles nobody can see and the pager does
   not follow. inert takes them out of the tab order and the accessibility tree
   together. */
/** @param {number} current */
function syncPageInert(current) {
  const strip = el('pages');
  if (strip) inertAllBut(strip, current);
}
