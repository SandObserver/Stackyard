/* Now Playing widget data function.

   Config (server-side, secrets included):
     provider          : 'plex' | 'jellyfin' | 'emby' | 'navidrome'
     tautulliUrl/Key   : Plex sessions come from Tautulli (Plex's own API is counts-only)
     jellyfinUrl/Key   : Jellyfin /Sessions
     embyUrl/Key       : Emby /Sessions (same shape as Jellyfin)
     navidromeUrl/User/Password : Subsonic getNowPlaying. Progress + play/paused come from the
                                  OpenSubsonic playbackReport extension (Navidrome >= 0.62, positionMs/state);
                                  older servers omit these, so progress falls back to null.

   Returns the normalized shape the widget renders:
     { provider, sessions: [{ title, subtitle, progress, state, type }] }
   progress is 0..1, or null when the source has no duration (Navidrome).
   state is 'playing' | 'paused'. sessions is capped at 5. */

const crypto = require('crypto');

const MAX = 5;

async function tautulli(ctx) {
  const base = ctx.normalizeBase(ctx.config.tautulliUrl);
  const key = ctx.config.tautulliKey;
  if (!base || !key) throw new Error('Tautulli URL and API key required');
  const url = `${base}/api/v2?apikey=${encodeURIComponent(key)}&cmd=get_activity`;
  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status === 401 || r.status === 403) throw new Error('Tautulli auth failed');
  if (r.status >= 400) throw new Error('Tautulli HTTP ' + r.status);
  const list = (r.data && r.data.response && r.data.response.data && r.data.response.data.sessions) || [];
  return list.map(s => {
    const type = s.media_type;
    let title = s.title || '', subtitle = '';
    if (type === 'episode') subtitle = s.grandparent_title || '';
    else if (type === 'track') subtitle = s.grandparent_title || s.original_title || '';
    else if (type === 'movie') title = s.full_title || s.title || '';
    let progress = null;
    if (s.progress_percent != null && s.progress_percent !== '') progress = Math.min(1, Math.max(0, (+s.progress_percent) / 100));
    else { const dur = +s.duration || 0, off = +s.view_offset || 0; if (dur > 0) progress = Math.min(1, off / dur); }
    return { title, subtitle, progress, state: s.state === 'paused' ? 'paused' : 'playing', type: type || '' };
  });
}

async function jellyfinLike(ctx, provider) {
  const base = ctx.normalizeBase(provider === 'emby' ? ctx.config.embyUrl : ctx.config.jellyfinUrl);
  const key = provider === 'emby' ? ctx.config.embyKey : ctx.config.jellyfinKey;
  const name = provider === 'emby' ? 'Emby' : 'Jellyfin';
  if (!base || !key) throw new Error(name + ' URL and API key required');
  const url = `${base}/Sessions?api_key=${encodeURIComponent(key)}`;
  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status === 401 || r.status === 403) throw new Error(name + ' auth failed');
  if (r.status >= 400) throw new Error(name + ' HTTP ' + r.status);
  const list = Array.isArray(r.data) ? r.data : [];
  const out = [];
  for (const s of list) {
    const np = s.NowPlayingItem;
    if (!np) continue;
    const ps = s.PlayState || {};
    const t = np.Type || '';
    let title = np.Name || '', subtitle = '';
    if (t === 'Episode') {
      subtitle = np.SeriesName || '';
      if (np.ParentIndexNumber != null && np.IndexNumber != null)
        subtitle = (np.SeriesName ? np.SeriesName + ' · ' : '') + `S${np.ParentIndexNumber}E${np.IndexNumber}`;
    } else if (t === 'Audio') {
      subtitle = np.AlbumArtist || np.Album || '';
    }
    const run = +np.RunTimeTicks || 0, pos = +ps.PositionTicks || 0;
    out.push({ title, subtitle, progress: run > 0 ? Math.min(1, pos / run) : null, state: ps.IsPaused ? 'paused' : 'playing', type: t.toLowerCase() });
  }
  return out;
}

async function navidrome(ctx) {
  const base = ctx.normalizeBase(ctx.config.navidromeUrl);
  const user = ctx.config.navidromeUser, pass = ctx.config.navidromePassword;
  if (!base || !user || !pass) throw new Error('Navidrome URL, username and password required');
  const salt = crypto.randomBytes(6).toString('hex');
  const token = crypto.createHash('md5').update(pass + salt).digest('hex');
  const url = `${base}/rest/getNowPlaying?u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=stackyard&f=json`;
  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status >= 400) throw new Error('Navidrome HTTP ' + r.status);
  const sr = r.data && r.data['subsonic-response'];
  if (sr && sr.status === 'failed') throw new Error('Navidrome: ' + ((sr.error && sr.error.message) || 'auth failed'));
  let entries = (sr && sr.nowPlaying && sr.nowPlaying.entry) || [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries.map(e => {
    const dur = +e.duration || 0;                                   // Subsonic duration is seconds
    const pos = e.positionMs != null ? +e.positionMs : null;        // OpenSubsonic playbackReport (Navidrome >= 0.62), ms
    const progress = (pos != null && dur > 0) ? Math.min(1, Math.max(0, pos / (dur * 1000))) : null;
    const state = e.state === 'paused' ? 'paused' : 'playing';      // starting/playing -> playing
    return { title: e.title || '', subtitle: e.artist || e.album || '', progress, state, type: 'track' };
  });
}

module.exports = async function (ctx) {
  const provider = ctx.config.provider || '';
  try {
    let sessions;
    if (provider === 'plex') sessions = await tautulli(ctx);
    else if (provider === 'jellyfin' || provider === 'emby') sessions = await jellyfinLike(ctx, provider);
    else if (provider === 'navidrome') sessions = await navidrome(ctx);
    else return { provider, sessions: [], error: 'No media server configured' };
    return { provider, sessions: sessions.filter(s => s.title).slice(0, MAX) };
  } catch (e) {
    return { provider, sessions: [], error: e.message };
  }
};
