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

/* The catalogues a name can come from, in the order the picker ranks them. A
   bare name is dashboard-icons: every icon saved before the other three
   existed is written that way. */
const SOURCES = ['di', 'selfhst', 'simple', 'lobe'];

const CDN_BASE = {
  di: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons',
  selfhst: 'https://cdn.jsdelivr.net/gh/selfhst/icons',
  simple: 'https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons',
  lobe: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons/packages/static-svg/icons',
};

/** Split a stored reference into its catalogue and slug. */
export function splitIconRef(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i > 0) {
    const source = s.slice(0, i);
    if (SOURCES.includes(source)) return { source, slug: s.slice(i + 1) };
  }
  return { source: 'di', slug: s };
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

/** Keep the catalogue prefix, normalise only the slug after it. */
export function cdnIconRef(raw) {
  const { source, slug } = splitIconRef(raw);
  const name = cdnIconName(slug);
  if (!name) return '';
  return source === 'di' ? name : `${source}:${name}`;
}

function cdnFileUrl(source, slug, ext) {
  if (source === 'simple' || source === 'lobe') return ext === 'svg' ? `${CDN_BASE[source]}/${slug}.svg` : '';
  return `${CDN_BASE[source]}/${ext}/${slug}.${ext}`;
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
    const { source, slug } = splitIconRef(name);
    const cdn = encodeURIComponent(cdnIconName(slug));
    const src = `&source=${source}`;
    /* Through the API first, which holds the file, so the CDN is not told which
       services this dashboard shows on every load. The direct link stays as the
       fallback for a failed proxy fetch. */
    /* One request, not one per format. Hundreds of catalogue entries are png
       only and hundreds have no png, and the server knows which from the
       catalogue index it already holds. */
    if (explicitExt) chain.push(`/api/icons/cdn?name=${cdn}&ext=${explicitExt}${src}`);
    else chain.push(`/api/icons/cdn?name=${cdn}${src}`);
    for (const ext of ['svg', 'png']) {
      if (explicitExt && explicitExt !== ext) continue;
      const direct = cdnFileUrl(source, cdn, ext);
      if (direct) chain.push(direct);
    }
  }
  return chain;
}
