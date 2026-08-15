/* navigator.wakeLock exists only in a secure context. Over plain HTTP there is
   nothing to call and the dashboard runs unchanged. */

/** Holds a screen wake lock while the document is visible.
    @param {{ nav?: any, doc?: any }} [deps]
    @returns {{ stop: () => void, held: () => boolean, supported: () => boolean }} */
export function startWakeLock({ nav, doc } = {}) {
  const n = nav ?? (typeof navigator === 'undefined' ? null : navigator);
  const d = doc ?? (typeof document === 'undefined' ? null : document);
  let sentinel = null;
  let pending = false;
  let stopped = false;

  const supported = () => typeof n?.wakeLock?.request === 'function';

  /* The lock is dropped every time the document is hidden, so this runs again
     on each return to the foreground. */
  async function acquire() {
    if (stopped || sentinel || pending || !supported()) return;
    if (d && d.visibilityState === 'hidden') return;
    pending = true;
    try {
      const s = await n.wakeLock.request('screen');
      if (stopped) {
        await s.release?.();
        return;
      }
      sentinel = s;
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      /* Refused by the browser or the OS, for example in power save mode. */
    } finally {
      pending = false;
    }
  }

  const onVisibility = () => {
    if (!d || d.visibilityState === 'visible') acquire();
  };
  d?.addEventListener('visibilitychange', onVisibility);
  acquire();

  return {
    supported,
    held: () => sentinel !== null,
    stop() {
      stopped = true;
      d?.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      s?.release?.().catch?.(() => {});
    },
  };
}
