import { restoreAction } from '/js/dashboard-logic.js?v=b4828b62';
import { overlayOpen } from '/js/dashboard-pager.js?v=a2181a99';
import { liftVeil, showApiDown } from '/js/dashboard-screens.js?v=a1d32807';
import { repeatJittered } from '/js/jitter.js?v=087a1fcf';
import { el } from '/js/utils.js?v=9ed2b298';

/** @param {{
      badges: import('/js/dashboard-badges.js?v=5b05724e').Badges,
      differs: (c: any) => boolean,
    }} deps */
export function createPolling({ badges, differs }) {
  const { pollBadges, pollHealth } = badges;
  const strip = el('pages');
  /* Jittered, so several open clients do not poll on the same tick. */
  let _pollTimers = [];
  const _repeat = (fn, base) => _pollTimers.push(repeatJittered(fn, base));

  const pollConfig = async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return;
      if (differs(await res.json()) && !overlayOpen() && !strip.classList.contains('dragging')) location.reload();
    } catch {}
  };

  const stopPolling = () => {
    _pollTimers.forEach(clear => clear());
    _pollTimers = [];
  };

  /* A tab that boots hidden starts here and again when first shown. */
  const startPolling = () => {
    stopPolling();
    _repeat(pollBadges, 20_000);
    _repeat(pollHealth, 30_000);
    _repeat(pollConfig, 15_000);
  };

  const watchVisibility = () => {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopPolling();
      } else {
        pollBadges();
        pollHealth();
        pollConfig();
        startPolling();
      }
    });
  };

  /** @param {number} [bootTimeoutMs] */
  const watchRestore = bootTimeoutMs => {
    /* Keep the veil until both checks finish. A restored page holds its old
       contents, including after a sign-out. */
    window.addEventListener('pagehide', e => {
      if (e.persisted) document.body.classList.remove('ready');
    });
    window.addEventListener('pageshow', async e => {
      if (!e.persisted) return;
      const signal = AbortSignal.timeout(bootTimeoutMs);
      /** @param {string} url @returns {Promise<import('/js/dashboard-logic.js?v=b4828b62').RestoreCheck>} */
      const check = async url => {
        try {
          const r = await fetch(url, { cache: 'no-store', redirect: 'manual', signal });
          return { status: r.status, body: r.ok ? await r.json().catch(() => undefined) : undefined };
        } catch {
          return null;
        }
      };
      const [auth, config] = await Promise.all([check('/api/auth/check'), check('/api/config')]);
      const action = restoreAction(auth, config, differs);
      if (action === 'reload' || (action === 'show' && document.body.classList.contains('api-down'))) {
        location.reload();
        return;
      }
      if (action === 'offline') {
        showApiDown();
        return;
      }
      pollBadges();
      pollHealth();
      startPolling();
      liftVeil();
    });
  };

  return { pollConfig, startPolling, stopPolling, watchVisibility, watchRestore };
}
