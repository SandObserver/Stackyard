/* The four icon catalogues, searched together and returned as one ranked list.
   Each is fetched and cached on its own, so one unreachable catalogue never
   empties the results. */

const { fetchUnchecked } = require('./proxy');
const log = require('./log');

const CATALOG_TTL = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 24;

const JSDELIVR = 'https://cdn.jsdelivr.net/gh';
const DI_RAW = 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main';

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/* simple-icons' own rules for turning a brand title into a filename. Its data
   file overrides them for 14 entries and states nothing for the rest. */
function simpleSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/^\./, 'dot-')
    .replace(/\.$/, '-dot')
    .replace(/\./g, '-dot-')
    .replace(/^&/, 'and-')
    .replace(/&$/, '-and')
    .replace(/&/g, '-and-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const SOURCES = [
  {
    id: 'di',
    /* This catalogue's metadata names the services it covers, not the files it
       holds, and is wrong about ten of them. The repository's file list is the
       authority on what the picker may offer. */
    files: 'https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/HEAD?recursive=1',
    listing: `${JSDELIVR}/homarr-labs/dashboard-icons/metadata.json`,
    /* Past 50 MB, jsdelivr answers 403 for anything it has not already cached.
       The repository is the second try, for the index and the files alike. */
    listingMirror: `${DI_RAW}/metadata.json`,
    parse(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
      return Object.entries(data).map(([slug, meta]) => ({
        slug,
        name: slug,
        aliases: Array.isArray(meta?.aliases) ? meta.aliases : [],
        light: meta?.colors?.light || '',
        dark: meta?.colors?.dark || '',
        /* 683 of these entries are png only. */
        format: meta?.base === 'png' ? 'png' : 'svg',
      }));
    },
  },
  {
    id: 'selfhst',
    listing: `${JSDELIVR}/selfhst/icons/index.json`,
    parse(data) {
      if (!Array.isArray(data)) return [];
      return data
        .filter(e => e?.Reference)
        .map(e => ({
          slug: e.Reference,
          name: e.Name || e.Reference,
          aliases: String(e.Tags || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
          light: e.Light === 'Yes' ? `${e.Reference}-light` : '',
          dark: e.Dark === 'Yes' ? `${e.Reference}-dark` : '',
          format: e.SVG === 'Yes' ? 'svg' : 'png',
        }));
    },
  },
  {
    id: 'simple',
    listing: `${JSDELIVR}/simple-icons/simple-icons/_data/simple-icons.json`,
    parse(data) {
      const list = Array.isArray(data) ? data : data?.icons;
      if (!Array.isArray(list)) return [];
      return list
        .filter(e => e?.title)
        .map(e => ({
          slug: e.slug || simpleSlug(e.title),
          name: e.title,
          aliases: Object.values(e.aliases || {})
            .flat()
            .filter(a => typeof a === 'string'),
          light: '',
          dark: '',
          format: 'svg',
        }));
    },
  },
  {
    id: 'lobe',
    listing: 'https://api.github.com/repos/lobehub/lobe-icons/git/trees/HEAD?recursive=1',
    /* The GitHub API refuses a request with no User-Agent. */
    headers: { 'User-Agent': 'stackyard', Accept: 'application/vnd.github+json' },
    parse(data) {
      const tree = Array.isArray(data?.tree) ? data.tree : [];
      return tree
        .map(e => /^packages\/static-svg\/icons\/(.+)\.svg$/.exec(e?.path || ''))
        .filter(Boolean)
        .map(m => ({ slug: m[1], name: m[1], aliases: [], light: '', dark: '', format: 'svg' }));
    },
  },
];

const SOURCE_IDS = SOURCES.map(s => s.id);
/* Catalogues that state their own files correctly: selfh.st is right about all
   2894 of its entries, and the other two hold svg only. A second format is
   never offered after theirs. */
const DECLARATION_IS_EXACT = new Set(['selfhst', 'simple', 'lobe']);

/** @param {string} source @param {string} slug @param {string} ext */
function fileUrl(source, slug, ext) {
  if (source === 'di') return `${JSDELIVR}/homarr-labs/dashboard-icons/${ext}/${slug}.${ext}`;
  if (source === 'selfhst') return `${JSDELIVR}/selfhst/icons/${ext}/${slug}.${ext}`;
  if (source === 'simple') return ext === 'svg' ? `${JSDELIVR}/simple-icons/simple-icons/icons/${slug}.svg` : '';
  if (source === 'lobe')
    return ext === 'svg' ? `${JSDELIVR}/lobehub/lobe-icons/packages/static-svg/icons/${slug}.svg` : '';
  return '';
}

function rawFileUrl(source, slug, ext) {
  return source === 'di' ? `${DI_RAW}/${ext}/${slug}.${ext}` : '';
}

/** A bare slug is dashboard-icons. Every configuration written before the other
    three catalogues existed holds one, so this mapping cannot change. */
function refOf(source, slug) {
  return source === 'di' ? slug : `${source}:${slug}`;
}

/** @param {string} ref */
function parseRef(ref) {
  const s = String(ref || '').trim();
  const i = s.indexOf(':');
  if (i > 0) {
    const source = s.slice(0, i);
    if (SOURCE_IDS.includes(source)) return { source, slug: s.slice(i + 1) };
  }
  return { source: 'di', slug: s };
}

/** @param {any} data @returns {{svg: Set<string>, png: Set<string>}} */
function parseFileTree(data) {
  const tree = Array.isArray(data?.tree) ? data.tree : [];
  const svg = new Set();
  const png = new Set();
  for (const e of tree) {
    const path = e?.path || '';
    /* Concatenated, not sliced: a slice holds the whole path string alive. */
    if (path.startsWith('svg/') && path.endsWith('.svg')) svg.add(''.concat(path.slice(4, -4)));
    else if (path.startsWith('png/') && path.endsWith('.png')) png.add(''.concat(path.slice(4, -4)));
  }
  return { svg, png };
}

/** @type {Map<string, {at: number, entries: any[]}>} */
const _cache = new Map();
/** @type {Map<string, {at: number, files: {svg: Set<string>, png: Set<string>} | null}>} */
const _files = new Map();
/** @type {Map<string, Promise<any>>} */
const _inflight = new Map();

/* One fetch at a time per thing fetched. A search and a lookup start together
   and would otherwise pull the same multi-megabyte listing twice. */
function once(key, work) {
  const running = _inflight.get(key);
  if (running) return running;
  const p = work().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

function entriesFor(src) {
  const hit = _cache.get(src.id);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return Promise.resolve(hit.entries);
  return once(`entries:${src.id}`, async () => {
    try {
      const headers = src.headers || { Accept: 'application/json' };
      let r = await fetchUnchecked(src.listing, { headers });
      if (r.status !== 200 && src.listingMirror) r = await fetchUnchecked(src.listingMirror, { headers });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const entries = src.parse(r.data).filter(e => e.slug);
      if (!entries.length) throw new Error('empty catalogue');
      _cache.set(src.id, { at: Date.now(), entries });
      return entries;
    } catch (e) {
      log.warn('Icon catalogue could not be read', { source: src.id, reason: e.message });
      /* A stale copy beats dropping a whole catalogue over one failed refresh. */
      return hit ? hit.entries : [];
    }
  });
}

function filesFor(src) {
  if (!src.files) return Promise.resolve(null);
  const hit = _files.get(src.id);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return Promise.resolve(hit.files);
  return once(`files:${src.id}`, async () => {
    try {
      const r = await fetchUnchecked(src.files, {
        headers: { 'User-Agent': 'stackyard', Accept: 'application/vnd.github+json' },
        maxBytes: 16 * 1024 * 1024,
      });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const files = parseFileTree(r.data);
      if (!files.svg.size && !files.png.size) throw new Error('empty file list');
      _files.set(src.id, { at: Date.now(), files });
      return files;
    } catch (e) {
      log.warn('Icon file list could not be read', { source: src.id, reason: e.message });
      /* Back to what the metadata claims: wrong for ten entries, which beats
         no icons at all. */
      return hit ? hit.files : null;
    }
  });
}

/* Exact name, then exact alias, then prefix, then anywhere. Source order breaks
   every tie, so a full name is never buried under a longer one. */
function rank(entry, q) {
  if (norm(entry.name) === q || norm(entry.slug) === q) return 0;
  if (entry.aliases.some(a => norm(a) === q)) return 1;
  if (norm(entry.name).startsWith(q) || norm(entry.slug).startsWith(q)) return 2;
  if (norm(entry.name).includes(q) || norm(entry.slug).includes(q)) return 3;
  if (entry.aliases.some(a => norm(a).includes(q))) return 4;
  return -1;
}

function findEntry(entries, slug) {
  const target = norm(slug);
  return entries.find(
    e => norm(e.slug) === target || (e.light && norm(e.light) === target) || (e.dark && norm(e.dark) === target),
  );
}

/** The format the file is really in, or '' when there is no such file.
    @param {{svg: Set<string>, png: Set<string>} | null} files
    @param {string} slug @param {string} declared */
function formatOf(files, slug, declared) {
  if (!files) return declared;
  if (declared === 'png' ? files.png.has(slug) : files.svg.has(slug)) return declared;
  if (declared === 'png' ? files.svg.has(slug) : files.png.has(slug)) return declared === 'png' ? 'svg' : 'png';
  return '';
}

/** One URL when the format is settled, both when it is a guess. */
function urlsFor(source, slug, format, exact) {
  const order = exact ? [format] : format === 'png' ? ['png', 'svg'] : ['svg', 'png'];
  return order.map(ext => fileUrl(source, slug, ext)).filter(Boolean);
}

/* A catalogue names the same file as both the base and one variant, so the
   list is deduplicated by file: two buttons drawing one image is no choice.
   Eight entries name a base file the repository does not hold and two name a
   variant it does not, so the file list decides what is offered. */
/** @param {string} source @param {any} entry
    @param {{svg: Set<string>, png: Set<string>} | null} [files] */
function present(source, entry, files = null) {
  const exact = !!files || DECLARATION_IS_EXACT.has(source);
  const variants = [];
  const seen = new Set();
  for (const [key, slug] of [
    ['base', entry.slug],
    ['light', entry.light],
    ['dark', entry.dark],
  ]) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const format = formatOf(files, slug, entry.format);
    if (!format) continue;
    variants.push({ key, ref: refOf(source, slug), format, urls: urlsFor(source, slug, format, exact) });
  }
  /* Reached when the file list is newer or older than the metadata and holds
     none of the entry's files. */
  const shown = variants[0] || {
    ref: refOf(source, entry.slug),
    format: entry.format,
    urls: urlsFor(source, entry.slug, entry.format, DECLARATION_IS_EXACT.has(source)),
  };
  return {
    ref: shown.ref,
    name: entry.name,
    source,
    format: shown.format,
    urls: shown.urls,
    variants: variants.length > 1 ? variants.map(({ key, ref, urls }) => ({ key, ref, urls })) : [],
  };
}

/** @param {string} query */
async function searchIcons(query) {
  const q = norm(query);
  if (!q) return [];
  const [lists, fileLists] = await Promise.all([
    Promise.all(SOURCES.map(entriesFor)),
    Promise.all(SOURCES.map(filesFor)),
  ]);
  /** @type {{r: number, s: number, e: any}[]} */
  const hits = [];
  lists.forEach((entries, s) => {
    for (const e of entries) {
      const r = rank(e, q);
      if (r >= 0) hits.push({ r, s, e });
    }
  });
  hits.sort((a, b) => a.r - b.r || a.s - b.s || a.e.name.length - b.e.name.length);

  /* One row per service. It comes from whichever catalogue holds the light and
     dark files: 921 services have them in one catalogue and not in the one that
     otherwise ranks first, and a variant choice nobody can see is no choice. */
  const best = new Map();
  for (const h of hits) {
    const key = norm(h.e.name);
    const held = best.get(key);
    if (!held) best.set(key, h);
    else if (!(held.e.light || held.e.dark) && (h.e.light || h.e.dark)) best.set(key, h);
  }
  return [...best.values()].slice(0, MAX_RESULTS).map(h => present(SOURCES[h.s].id, h.e, fileLists[h.s]));
}

/** The files an icon already saved in a configuration has. The stored reference
    may be a variant rather than the entry's own slug. */
async function lookupIcon(ref) {
  const { source, slug } = parseRef(ref);
  const src = SOURCES.find(s => s.id === source);
  if (!src || !slug) return null;
  const [entries, files] = await Promise.all([entriesFor(src), filesFor(src)]);
  const entry = findEntry(entries, slug);
  return entry ? present(source, entry, files) : null;
}

/** The format of a saved reference, from what is already in memory. Never
    fetches: the first icon on a cold dashboard would wait for a 1 MB listing,
    and the caller tries both formats when this returns ''. */
function formatHint(ref) {
  const { source, slug } = parseRef(ref);
  const src = SOURCES.find(s => s.id === source);
  const held = src && _cache.get(src.id);
  if (!held) return '';
  const entry = findEntry(held.entries, slug);
  if (!entry) return '';
  return formatOf(_files.get(src.id)?.files || null, slug, entry.format) || entry.format;
}

function _resetCatalogCache() {
  _cache.clear();
  _inflight.clear();
  _files.clear();
}

module.exports = {
  searchIcons,
  lookupIcon,
  formatHint,
  parseRef,
  fileUrl,
  rawFileUrl,
  simpleSlug,
  SOURCE_IDS,
  _resetCatalogCache,
};
