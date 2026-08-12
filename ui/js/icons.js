// @ts-check
/* SECURITY INVARIANT: these URLs may only ever be assigned to an <img src>. A
   user-uploaded SVG loaded that way cannot execute script. Inlined into the DOM
   it can. */
const LOCAL_ICONS = new Set();

export async function loadLocalIcons() {
  try {
    const r = await fetch('/api/icons/local', { cache: 'no-store' });
    if (r.ok) {
      /* Mutate the existing Set. Reassigning it leaves every other module
         holding a stale reference. */
      LOCAL_ICONS.clear();
      ((await r.json()).files || []).forEach(f => LOCAL_ICONS.add(f));
    }
  } catch {}
}

/* Percent-encode the filename only, never the '/icons/' prefix, or the
   separator is escaped too. */
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

/* CDN names only. The catalogue is lowercase, hyphenated and case-sensitive; a
   local filesystem may hold two names differing by case. */
export function cdnIconName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

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
    /* Through the API first, which holds the file, so the CDN is not told which
       services this dashboard shows on every load. The direct link stays as the
       fallback for a failed proxy fetch. */
    if (!explicitExt || explicitExt === 'svg') chain.push(`/api/icons/cdn?name=${cdn}&ext=svg`);
    if (!explicitExt || explicitExt === 'png') chain.push(`/api/icons/cdn?name=${cdn}&ext=png`);
    if (!explicitExt || explicitExt === 'svg')
      chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${cdn}.svg`);
    if (!explicitExt || explicitExt === 'png')
      chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${cdn}.png`);
  }
  return chain;
}
