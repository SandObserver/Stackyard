// @ts-check
/* SECURITY INVARIANT:
   The URLs produced here (resolveIcon / iconChain) must only ever be assigned
   to an <img src=...>. User-uploaded SVGs are served from /icons/ and an SVG
   loaded via <img> cannot execute scripts, <style>, or event handlers.
   The upload-time sanitizer in api/src/routes/icons.js is defense-in-depth,
   NOT the primary XSS control. If an icon is ever inlined into the DOM
   (innerHTML, inline <svg>, object/embed), this assumption breaks; re-evaluate
   SVG sanitization before doing so. */
const LOCAL_ICONS = new Set();

export async function loadLocalIcons() {
  try {
    const r = await fetch('/api/icons/local', { cache:'no-store' });
    if (r.ok) {
      /* Mutate the existing Set so all modules sharing the reference see the update.
         Reassigning LOCAL_ICONS = new Set(...) would leave other modules with a stale reference. */
      LOCAL_ICONS.clear();
      ((await r.json()).files || []).forEach(f => LOCAL_ICONS.add(f));
    }
  } catch {}
}

/* The URL for a locally uploaded icon.

   The filename is used exactly as it appears on disk. It used to be taken apart
   and reassembled with the extension lowercased, so an icon saved as LOGO.SVG
   was requested as /icons/LOGO.svg: a file that does not exist, and an icon that
   silently never appeared. Uppercase extensions arrive routinely from Windows
   and from cameras.

   The filename is also percent-encoded. A space happens to survive because
   browsers encode it, but a '+' or a '&' changes meaning in a path and would
   have requested something else entirely. Only the filename is encoded, never
   the '/icons/' prefix, or the separator would be escaped too. */
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

/* A typed name as the icon catalogue spells it.

   Every file in the dashboard-icons repository is lowercase and hyphenated, and
   jsDelivr serves GitHub paths, which are case-sensitive. So a name typed as
   "MySpeed" or "Home Assistant" produced a 404 while the icon existed all along
   as myspeed.svg or home-assistant.svg, with no hint of why nothing appeared.

   This applies only to the CDN. A locally uploaded icon is the user's own file
   and is used exactly as it is on disk; guessing at its spelling could pick the
   wrong one, and a filesystem may hold two names differing only by case. */
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
  const localUrl    = resolveIcon(rawIcon);
  const name        = rawIcon.replace(/\.(svg|png)$/i, '').split('/').pop().split('?')[0];
  const dot         = rawIcon.lastIndexOf('.');
  const explicitExt = (!rawIcon.startsWith('http') && dot > 0) ? rawIcon.slice(dot+1).toLowerCase() : '';
  const chain       = [];
  if (localUrl) chain.push(localUrl);
  if (rawIcon.startsWith('http')) {
    if (localUrl && rawIcon !== localUrl) chain.push(rawIcon);
    if (!localUrl) chain.push(rawIcon);
  } else {
    const cdn = encodeURIComponent(cdnIconName(name));
    if (!explicitExt || explicitExt === 'svg') chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${cdn}.svg`);
    if (!explicitExt || explicitExt === 'png') chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${cdn}.png`);
  }
  return chain;
}