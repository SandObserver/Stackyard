// @ts-check
/* Pure assembly/validation logic lifted out of admin doSave so it can be
   unit-tested without a DOM. Each function takes plain data (widget state that
   the form has already collected) and returns plain data; the DOM reads stay in
   doSave. No DOM, no module state. */

/* Turn a label into a safe id stem: letters/digits/underscores only, collapsed,
   trimmed, with a type-specific fallback when nothing usable remains. */
export function cleanId(label, fallback = 'item') {
  return String(label || '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

/* Assemble an app item from already-read form values (v). Validates name/url,
   builds the monitoring block (healthcheck + activity badge), the custom badge
   display, and the static badge. Returns { error } or { item }. */
export function buildAppItem(v, orig) {
  if (!v.label) return { error: 'Name required' };
  if (!v.href)  return { error: 'URL required' };
  const DEFCOL = '#0289ff';
  const customObj = (v.actColor && v.actColor !== DEFCOL) || v.custUnit ? {
    color: v.actColor && v.actColor !== DEFCOL ? v.actColor : undefined,
    unit:  v.custUnit || undefined,
  } : undefined;
  const staticBadgeObj = v.staticEn && v.staticLabel
    ? { enabled: true, label: v.staticLabel.slice(0, 10), color: v.staticColor || 'blue' }
    : undefined;
  const spaths = v.spaths || [];
  return { item: {
    id: orig?.id || cleanId(v.label, 'app') + '_' + Date.now(),
    type: 'app', label: v.label, href: v.href,
    iconUrl: v.iconUrl, color: v.scol || 'dark',
    dock: v.dock || false,
    skipTlsVerify: v.skipTlsVerify || undefined,
    monitoring: {
      healthcheck: { enabled: v.hcEn && (!!v.hcCon || !!v.hcPing), container: v.hcCon, pingUrl: v.hcPing },
      activity: {
        enabled: v.actEn && !!v.actUrl, url: v.actUrl,
        params:  v.actParams?.length ? v.actParams : undefined,
        headers: v.actHeaders?.length ? v.actHeaders : undefined,
        extract: spaths.length === 1 ? spaths[0] : spaths.length > 1 ? spaths.map(p => ({ path: p })) : undefined,
        interval: Math.max(10, v.actInt),
        custom: customObj,
      },
      staticBadge: staticBadgeObj,
    },
  } };
}
