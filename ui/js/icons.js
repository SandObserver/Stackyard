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

export function resolveIcon(raw) {
  if (!raw) return '';
  raw = raw.trim();
  const base = '/icons';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const filename = raw.split('/').pop().split('?')[0];
    return LOCAL_ICONS.has(filename) ? `${base}/${filename}` : raw;
  }
  const filename = raw.split('/').pop();
  const dot = filename.lastIndexOf('.');
  const name = dot > 0 ? filename.slice(0, dot) : filename;
  const ext  = dot > 0 ? filename.slice(dot + 1).toLowerCase() : 'svg';
  return LOCAL_ICONS.has(filename) ? `${base}/${name}.${ext}` : '';
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
    if (!explicitExt || explicitExt === 'svg') chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${name}.svg`);
    if (!explicitExt || explicitExt === 'png') chain.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${name}.png`);
  }
  return chain;
}