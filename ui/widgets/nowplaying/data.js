/* Now Playing widget data function.

   Config (server-side, secrets included):
     provider          : 'plex' | 'jellyfin' | 'emby' | 'navidrome'
     plexUrl/Token     : Plex Media Server /status/sessions (X-Plex-Token); no Tautulli needed
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

async function plex(ctx) {
  const base = ctx.normalizeBase(ctx.config.plexUrl);
  const token = ctx.config.plexToken;
  if (!base || !token) throw new Error('Plex URL and token required');
  // Plex returns XML unless JSON is requested; token may be header or query
  const r = await ctx.fetchJSON(`${base}/status/sessions`, {
    headers: { 'Accept': 'application/json', 'X-Plex-Token': token }, timeout: 8000
  });
  if (r.status === 401 || r.status === 403) throw new Error('Plex auth failed (check token)');
  if (r.status >= 400) throw new Error('Plex HTTP ' + r.status);
  let list = (r.data && r.data.MediaContainer && r.data.MediaContainer.Metadata) || [];
  if (!Array.isArray(list)) list = [list];
  return list.map(m => {
    const type = (m.type || '').toLowerCase();
    let title = m.title || '', subtitle = '';
    if (type === 'episode') subtitle = m.grandparentTitle || '';
    else if (type === 'track') subtitle = m.grandparentTitle || m.parentTitle || '';
    const dur = +m.duration || 0, off = +m.viewOffset || 0;     // milliseconds
    const progress = dur > 0 ? Math.min(1, Math.max(0, off / dur)) : null;
    const pstate = (m.Player && m.Player.state) || 'playing';   // playing | paused | buffering
    return { title, subtitle, progress, state: pstate === 'paused' ? 'paused' : 'playing', type };
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
    if (provider === 'plex') sessions = await plex(ctx);
    else if (provider === 'jellyfin' || provider === 'emby') sessions = await jellyfinLike(ctx, provider);
    else if (provider === 'navidrome') sessions = await navidrome(ctx);
    else return { provider, sessions: [], error: 'No media server configured' };
    return { provider, sessions: sessions.filter(s => s.title).slice(0, MAX) };
  } catch (e) {
    return { provider, sessions: [], error: e.message };
  }
};
