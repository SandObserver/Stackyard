// @ts-check

/** One live query per preference, made on first use; `matches` stays current.
    @param {string} query */
function watched(query) {
  /** @type {MediaQueryList|null} */
  let mq = null;
  return () => {
    mq ??= typeof matchMedia === 'function' ? matchMedia(query) : null;
    return !!mq?.matches;
  };
}

export const contrastMore = watched('(prefers-contrast: more)');
export const prefersReducedMotion = watched('(prefers-reduced-motion: reduce)');
const plainOnly = watched('(prefers-reduced-motion: reduce), (forced-colors: active)');

/** Reduce Transparency, Reduce Motion and forced colours each ask for plain controls. */
export const wantsPlain = () => document.documentElement.dataset.transparency === 'reduce' || plainOnly();
