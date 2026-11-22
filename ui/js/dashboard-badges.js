import {
  badgeMinimum,
  badgeSignature,
  computeBadgeVisual,
  folderLabelName,
  readBadgeUpdate,
} from '/js/badge-logic.js?v=7112fd10';
import { describeBadgeTile, wireBadgePopover } from '/js/badge-popover.js?v=578d337c';
import { formatNumber } from '/js/format-number.js?v=263fa390';
import { t } from '/js/i18n.js?v=82ba9da2';
import { pageTheme, paletteColor } from '/js/palette.js?v=3fb8ae43';

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash */
export function createBadges(dash) {
  const badgeState = Object.create(null);
  let _badgeFails = 0,
    _healthFails = 0,
    badgesStale = false,
    healthStale = false;
  const BEL = new Map();
  /* Last painted appearance per badge element. Without it the same values are
     rewritten thousands of times a session. */
  const BSIG = new WeakMap();
  const BEXIT = new WeakMap();
  /* Badges the first polls turn on are existing state, not a change. */
  let _firstPolls = 2;

  function breg(id, badge) {
    if (!BEL.has(id)) BEL.set(id, new Set());
    BEL.get(id).add(badge);
    /* Paint on registration. A poll only reaches ids it returns, so a fixed label
       alone stays invisible, and a rebuild blanks every badge until the next
       poll. */
    bupd(id);
  }
  function bunreg(id, badge) {
    if (BEL.has(id)) BEL.get(id).delete(badge);
  }
  function bupd(id) {
    const els = BEL.get(id);
    if (!els?.size) return;
    const { items, S } = dash;
    const item = items.find(i => i.id === id);
    const s = item?.type === 'folder' ? folderBadge(item) : badgeState[id] || {};
    const hideHealthy = S.server?.hideHealthyBadge !== false;
    const custom = item?.monitoring?.activity?.custom || {};
    const staticBdg = item?.monitoring?.staticBadge || {};
    const hasHC = S.server?.healthChecks !== false && !!(item?.monitoring?.healthcheck?.enabled || item?.container);

    const act = item?.monitoring?.activity || {};
    const isFolder = item?.type === 'folder';
    const { cls, txt, num, unit, bg, aria, color, nextColor, popover, rows } = computeBadgeVisual({
      health: s.health,
      activity: s.activity,
      activityStale: !!s.activityStale,
      labels: isFolder ? s.labels : act.combine ? undefined : act.labels,
      values: s.values,
      custom,
      staticBdg,
      hasHC,
      hideHealthy,
      badgesStale,
      healthStale,
      healthDetail: s.healthDetail,
      translate: t,
      format: formatNumber,
      palette: name => paletteColor(name, pageTheme()),
    });

    const sig = badgeSignature({ cls, txt, unit, bg, aria, color, nextColor, rows });

    els.forEach(badge => {
      /* Before the signature check. A badge first paints before its tile holds
         it, and an unchanged repaint would never name the tile. */
      const tile = /** @type {HTMLElement|null} */ (badge.closest('a, button, [role="button"]'));
      const tileName = tile?.dataset.tileName;
      if (tile && tileName) tile.setAttribute('aria-label', aria ? `${tileName}, ${aria}` : tileName);
      if (tile) describeBadgeTile(tile, badge, popover ? rows : null);
      if (BSIG.get(badge) === sig) return;
      const painted = BSIG.has(badge);
      BSIG.set(badge, sig);
      BEXIT.get(badge)?.cancel();
      BEXIT.delete(badge);
      const leaving = badge.classList.contains('on') && !cls.split(' ').includes('on') && badge.isConnected;
      if (leaving) {
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const exit = badge.animate(
          still
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: 'translateZ(0)' },
                { opacity: 0, transform: 'translateZ(0) scale(.6)' },
              ],
          { duration: 150, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'forwards' },
        );
        BEXIT.set(badge, exit);
        exit.onfinish = () => {
          BEXIT.delete(badge);
          paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows });
          exit.cancel();
        };
        return;
      }
      const entering = !_firstPolls && painted && !badge.classList.contains('on') && cls.split(' ').includes('on');
      paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows });
      if (entering) badgeEnter(badge);
    });
  }

  function bset(id, type, val) {
    if (!badgeState[id]) badgeState[id] = { health: 0, activity: 0 };
    badgeState[id][type] = val;
    bupd(id);
    dash.items.filter(i => i.type === 'folder' && (i.children || []).includes(id)).forEach(f => bupd(f.id));
  }
  /** A folder's badge, from the badges of the apps inside it. A labelled child
      contributes its labels; the rest add into a total. */
  function folderBadge(folder) {
    const children = (folder.children || []).map(id => dash.items.find(i => i.id === id)).filter(Boolean);
    let actSum = 0,
      hasHealth = false,
      stale = false;
    const labels = [],
      values = [];
    for (const c of children) {
      const s = badgeState[c.id] || {};
      if (s.health) hasHealth = true;
      const ca = c.monitoring?.activity;
      if (s.activityStale) stale = true;
      const own = !ca?.combine && Array.isArray(ca?.labels) && ca.labels.length ? ca.labels : null;
      if (own && Array.isArray(s.values)) {
        own.forEach((l, n) => {
          if (!l || typeof l.path !== 'string' || !l.path) return;
          labels.push({ ...l, name: folderLabelName(c.label || c.id, l) });
          values.push(s.values[n]);
        });
        continue;
      }
      /* A child whose own count is below its minimum shows no badge, so it must
         not raise the folder's either. */
      if (s.activity >= badgeMinimum(ca?.custom)) actSum += s.activity;
    }
    return { health: hasHealth, activity: actSum, labels, values, activityStale: stale };
  }

  function refreshBadges() {
    for (const id of BEL.keys()) bupd(id);
  }

  async function pollBadges() {
    try {
      const res = await fetch('/api/badges', { cache: 'no-store' });
      if (!res.ok) throw new Error(`badges ${res.status}`);
      const d = await res.json();
      for (const [id, v] of Object.entries(d)) {
        const { value, failed } = readBadgeUpdate(v);
        /* A failed item keeps its last value, marked stale. Overwriting it with
           zero reads as "nothing pending", which is not what happened. */
        bset(id, 'activityStale', failed);
        if (!failed) {
          bset(id, 'values', Array.isArray(v?.values) ? v.values.map(Number) : null);
          bset(id, 'activity', value);
        }
      }
      _badgeFails = 0;
      if (badgesStale) {
        badgesStale = false;
        refreshBadges();
      }
    } catch {
      if (++_badgeFails >= 2 && !badgesStale) {
        badgesStale = true;
        refreshBadges();
      }
    } finally {
      if (_firstPolls) _firstPolls--;
    }
  }
  async function pollHealth() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const d = await res.json();
      for (const [id, v] of Object.entries(d)) {
        bset(id, 'healthDetail', v);
        bset(id, 'health', v.unhealthy ? 1 : 0);
      }
      _healthFails = 0;
      if (healthStale) {
        healthStale = false;
        refreshBadges();
      }
    } catch {
      if (++_healthFails >= 2 && !healthStale) {
        healthStale = true;
        refreshBadges();
      }
    } finally {
      if (_firstPolls) _firstPolls--;
    }
  }

  return { BEL, breg, bunreg, bupd, refreshBadges, pollBadges, pollHealth };
}

/** @typedef {ReturnType<typeof createBadges>} Badges */

function badgeEnter(badge) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  badge.animate(
    still
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateZ(0) scale(.8)' },
          { opacity: 1, transform: 'translateZ(0)' },
        ],
    { duration: still ? 150 : 300, easing: 'cubic-bezier(.33,1,.68,1)' },
  );
}

function paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows }) {
  badge.className = cls;
  let txtEl = badge.firstElementChild;
  let unitEl = txtEl?.nextElementSibling;
  if (!txtEl) {
    txtEl = document.createElement('span');
    txtEl.className = 'badge-txt';
    unitEl = document.createElement('span');
    unitEl.className = 'badge-unit';
    badge.append(txtEl, unitEl);
  }
  txtEl.textContent = num;
  unitEl.textContent = unit ? ' ' + unit : '';
  /* The badge belongs to its tile's name, not to a live region of its own.
       An explicit label on the anchor wins over everything inside it, so a
       badge left to speak for itself is never reached by a reader moving from
       tile to tile. A name change is silent, which is what a figure on a timer
       needs. */
  badge.setAttribute('aria-hidden', 'true');
  badge.removeAttribute('role');
  badge.removeAttribute('aria-label');
  /* Never the `background` shorthand. It resets background-clip, and the
       pill behind is painted from this same value. */
  if (bg) badge.style.setProperty('--badge-bg', bg);
  else badge.style.removeProperty('--badge-bg');
  badge.style.color = color;
  if (nextColor) badge.style.setProperty('--badge-next', nextColor);
  else badge.style.removeProperty('--badge-next');
  /* No title attribute. The popover carries the reason, and a badge that can
       be hovered would otherwise draw the browser's own tooltip beside it.
       Removed rather than skipped: one set by an earlier paint would persist. */
  badge.removeAttribute('title');
  wireBadgePopover(badge, popover ? rows : null);
}
