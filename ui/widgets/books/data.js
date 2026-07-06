/* Books widget data function.
   Default call returns { provider, source, books:[{title,author,progress,finished,color,kind}] } (<=8).
   ?endpoint=lists returns { options:[{value,label}] } for the config-time list picker.
   Providers:
     audiobookshelf : Bearer API key; library auto-picked (first book library)
     komga          : X-API-Key header
     kavita         : API key -> JWT via /api/Plugin/authenticate (series-based; color from ColorScape)
   Kavita recently/on-deck use the v2 POST endpoints and need verifying against a live server. */

const CAP = 8;
const enc = encodeURIComponent;
const clamp01 = n => Math.min(1, Math.max(0, n));
const cap = arr => (Array.isArray(arr) ? arr : []).slice(0, CAP);

function jget(ctx, base, path, headers) {
  return ctx.fetchJSON(base + path, { headers: Object.assign({ Accept: 'application/json' }, headers || {}), timeout: 8000 });
}
function jpost(ctx, base, path, headers, body) {
  return ctx.fetchJSON(base + path, {
    method: 'POST', timeout: 8000,
    headers: Object.assign({ Accept: 'application/json', 'Content-Type': 'application/json' }, headers || {}),
    body: body != null ? JSON.stringify(body) : undefined,
  });
}
function authErr(r) { return r.status === 401 || r.status === 403; }

/* ───────────────────────── Audiobookshelf ───────────────────────── */
async function absLibrary(ctx, base, hdr) {
  const r = await jget(ctx, base, '/api/libraries', hdr);
  if (authErr(r)) throw new Error('Audiobookshelf auth failed (check API key)');
  const libs = (r.data && r.data.libraries) || [];
  const book = libs.find(l => l.mediaType === 'book') || libs[0];
  if (!book) throw new Error('No Audiobookshelf library found');
  return book.id;
}
function absBook(li) {
  const md = (li.media && li.media.metadata) || {};
  const ump = li.userMediaProgress || li.mediaProgress || null;
  return {
    title: md.title || '',
    author: md.authorName || (Array.isArray(md.authors) ? md.authors.map(a => a.name).join(', ') : ''),
    progress: ump && ump.progress != null ? clamp01(+ump.progress) : null,
    finished: !!(ump && ump.isFinished),
    color: null,
    kind: 'book',
  };
}
async function abs(ctx) {
  const base = ctx.normalizeBase(ctx.config.absUrl);
  const key = ctx.config.absKey;
  if (!base || !key) throw new Error('Audiobookshelf URL and API key required');
  const hdr = { Authorization: 'Bearer ' + key };
  const lib = await absLibrary(ctx, base, hdr);
  const source = ctx.config.source || 'recently';
  let items = [];
  if (source === 'list' && ctx.config.listId) {
    const [kind, id] = String(ctx.config.listId).split(':');
    if (kind === 'playlist') {
      const r = await jget(ctx, base, `/api/playlists/${enc(id)}`, hdr);
      items = ((r.data && r.data.items) || []).map(it => it.libraryItem || it);
    } else {
      const r = await jget(ctx, base, `/api/collections/${enc(id)}`, hdr);
      items = (r.data && r.data.books) || [];
    }
  } else if (source === 'unread') {
    const f = Buffer.from('not-finished').toString('base64');
    const r = await jget(ctx, base, `/api/libraries/${enc(lib)}/items?filter=progress.${f}&sort=addedAt&desc=1&limit=${CAP}`, hdr);
    items = (r.data && r.data.results) || [];
  } else {
    const r = await jget(ctx, base, `/api/libraries/${enc(lib)}/items?sort=addedAt&desc=1&limit=${CAP}`, hdr);
    items = (r.data && r.data.results) || [];
  }
  return { provider: 'audiobookshelf', source, books: cap(items).map(absBook).filter(b => b.title) };
}
async function absLists(ctx) {
  const base = ctx.normalizeBase(ctx.config.absUrl);
  const key = ctx.config.absKey;
  if (!base || !key) throw new Error('Audiobookshelf URL and API key required');
  const hdr = { Authorization: 'Bearer ' + key };
  const lib = await absLibrary(ctx, base, hdr);
  const out = [];
  const c = await jget(ctx, base, `/api/libraries/${enc(lib)}/collections`, hdr);
  for (const col of ((c.data && c.data.results) || c.data || [])) if (col && col.id) out.push({ value: 'collection:' + col.id, label: col.name || 'Collection' });
  const p = await jget(ctx, base, `/api/libraries/${enc(lib)}/playlists`, hdr);
  for (const pl of ((p.data && p.data.results) || p.data || [])) if (pl && pl.id) out.push({ value: 'playlist:' + pl.id, label: pl.name || 'Playlist' });
  return { options: out };
}

/* ───────────────────────────── Komga ───────────────────────────── */
function komgaBook(b) {
  const md = b.metadata || {};
  const authors = Array.isArray(md.authors) ? md.authors : [];
  const writer = authors.find(a => /writer|author/i.test(a.role || '')) || authors[0];
  const rp = b.readProgress || null;
  const pages = (b.media && b.media.pagesCount) || 0;
  let progress = null;
  if (rp) progress = rp.completed ? 1 : (pages > 0 && rp.page ? clamp01(rp.page / pages) : null);
  return {
    title: md.title || b.name || '',
    author: writer ? writer.name : '',
    progress,
    finished: !!(rp && rp.completed),
    color: null,
    kind: 'book',
  };
}
async function komga(ctx) {
  const base = ctx.normalizeBase(ctx.config.komgaUrl);
  const key = ctx.config.komgaKey;
  if (!base || !key) throw new Error('Komga URL and API key required');
  const hdr = { 'X-API-Key': key };
  const source = ctx.config.source || 'recently';
  let path;
  if (source === 'list' && ctx.config.listId) path = `/api/v1/readlists/${enc(ctx.config.listId)}/books?size=${CAP}`;
  else if (source === 'unread') path = `/api/v1/books/ondeck?size=${CAP}`;
  else path = `/api/v1/books/latest?size=${CAP}`;
  const r = await jget(ctx, base, path, hdr);
  if (authErr(r)) throw new Error('Komga auth failed (check API key)');
  const content = (r.data && r.data.content) || (Array.isArray(r.data) ? r.data : []);
  return { provider: 'komga', source, books: cap(content).map(komgaBook).filter(b => b.title) };
}
async function komgaLists(ctx) {
  const base = ctx.normalizeBase(ctx.config.komgaUrl);
  const key = ctx.config.komgaKey;
  if (!base || !key) throw new Error('Komga URL and API key required');
  const r = await jget(ctx, base, `/api/v1/readlists?size=100`, { 'X-API-Key': key });
  const content = (r.data && r.data.content) || [];
  return { options: content.filter(l => l && l.id).map(l => ({ value: String(l.id), label: l.name || 'Read list' })) };
}

/* ───────────────────────────── Kavita ───────────────────────────── */
async function kavitaToken(ctx, base, key) {
  const r = await jpost(ctx, base, `/api/Plugin/authenticate?apiKey=${enc(key)}&pluginName=Stackyard`, null, null);
  if (authErr(r) || !(r.data && r.data.token)) throw new Error('Kavita auth failed (check API key)');
  return r.data.token;
}
function kavitaSeries(s) {
  const pages = +s.pages || 0, read = +s.pagesRead || 0;
  return {
    title: s.name || s.originalName || '',
    author: '',
    progress: pages > 0 ? clamp01(read / pages) : null,
    finished: pages > 0 && read >= pages,
    color: s.primaryColor || null,
    kind: 'series',
  };
}
async function kavita(ctx) {
  const base = ctx.normalizeBase(ctx.config.kavitaUrl);
  const key = ctx.config.kavitaKey;
  if (!base || !key) throw new Error('Kavita URL and API key required');
  const tok = await kavitaToken(ctx, base, key);
  const hdr = { Authorization: 'Bearer ' + tok };
  const source = ctx.config.source || 'recently';
  let list = [];
  if (source === 'list' && ctx.config.listId) {
    const r = await jget(ctx, base, `/api/ReadingList/items?readingListId=${enc(ctx.config.listId)}`, hdr);
    list = (Array.isArray(r.data) ? r.data : []).map(it => ({ name: it.seriesName || it.title, pages: it.pagesTotal, pagesRead: it.pagesRead, primaryColor: it.primaryColor }));
  } else if (source === 'unread') {
    const r = await jpost(ctx, base, `/api/Series/on-deck?pageSize=${CAP}`, hdr, {});
    list = Array.isArray(r.data) ? r.data : [];
  } else {
    const r = await jpost(ctx, base, `/api/Series/recently-added-v2?pageSize=${CAP}`, hdr,
      { statements: [], combination: 1, limitTo: CAP, sortOptions: { sortField: 2, isAscending: false } });
    list = Array.isArray(r.data) ? r.data : [];
  }
  return { provider: 'kavita', source, books: cap(list).map(kavitaSeries).filter(b => b.title) };
}
async function kavitaLists(ctx) {
  const base = ctx.normalizeBase(ctx.config.kavitaUrl);
  const key = ctx.config.kavitaKey;
  if (!base || !key) throw new Error('Kavita URL and API key required');
  const tok = await kavitaToken(ctx, base, key);
  const r = await jget(ctx, base, `/api/ReadingList/lists`, { Authorization: 'Bearer ' + tok });
  const arr = Array.isArray(r.data) ? r.data : ((r.data && r.data.content) || []);
  return { options: arr.filter(l => l && l.id).map(l => ({ value: String(l.id), label: l.title || l.name || 'Reading list' })) };
}

module.exports = async (ctx) => {
  const provider = (ctx.config && ctx.config.provider) || 'audiobookshelf';
  const wantLists = ctx.endpoint === 'lists';
  return ctx.dispatchProvider({
    audiobookshelf: c => wantLists ? absLists(c)    : abs(c),
    komga:          c => wantLists ? komgaLists(c)  : komga(c),
    kavita:         c => wantLists ? kavitaLists(c) : kavita(c),
  }, {
    default: 'audiobookshelf',
    onError: e => wantLists ? { options: [], error: e.message }
                            : { provider, books: [], error: e.message },
  });
};
