// @ts-check
/* SECURITY INVARIANT: these URLs may only ever be assigned to an <img src>. A
   user-uploaded SVG loaded that way cannot execute script; inlined into the DOM
   it can. The upload-time sanitizer is defence in depth, not the primary
   control. */
const LOCAL_ICONS = new Set();

export async function loadLocalIcons() {
  try {
    const r = await fetch('/api/icons/local', { cache: 'no-store' });
    if (r.ok) {
      /* Mutate the existing Set so all modules sharing the reference see the update.
         Reassigning LOCAL_ICONS = new Set(...) would leave other modules with a stale reference. */
      LOCAL_ICONS.clear();
      ((await r.json()).files || []).forEach(f => LOCAL_ICONS.add(f));
    }
  } catch {}
}

/* The filename is used exactly as it is on disk, uppercase extension included,
   and percent-encoded because a '+' or '&' changes meaning in a path. Only the
   filename, never the '/icons/' prefix, or the separator is escaped too. */
const iconPath = filename => `/icons/${encodeURIComponent(filename)}`;

export function resolveIcon(raw) {
  if (!raw) return '';
  raw = raw.trim();
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const filename = raw.split('/').pop().split('?')[0];
    return LOCAL_ICONS.has(filename) ? iconPath(filename) : raw;
  }
  const filename = raw.split('/').pop();
  return LOCAL_ICONS.has(filename) ? iconPath(filename) : '';
}

/* The catalogue is lowercase and hyphenated and its paths are case-sensitive, so
   "Home Assistant" has to become home-assistant. CDN names only: a local file is
   the user's own, and a filesystem may hold two names differing by case. */
export function cdnIconName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/* iconChain: ordered list of URLs to try, local first then CDN.
   Falls back to CDN-only when loadLocalIcons() wasn't called or failed. */
export function iconChain(rawIcon) {
  if (!rawIcon) return [];
  const localUrl = resolveIcon(rawIcon);
  const name = rawIcon
    .replace(/\.(svg|png)$/i, '')
    .split('/')
    .pop()
    .split('?')[0];
  const dot = rawIcon.lastIndexOf('.');
  const explicitExt = !rawIcon.startsWith('http') && dot > 0 ? rawIcon.slice(dot + 1).toLowerCase() : '';
  const chain = [];
  if (localUrl) chain.push(localUrl);
  if (rawIcon.startsWith('http')) {
    if (localUrl && rawIcon !== localUrl) chain.push(rawIcon);
    if (!localUrl) chain.push(rawIcon);
  } else {
    const cdn = encodeURIComponent(cdnIconName(name));
    if (!explicitExt || explicitExt === 'svg')
      chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${cdn}.svg`);
    if (!explicitExt || explicitExt === 'png')
      chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${cdn}.png`);
  }
  return chain;
}
