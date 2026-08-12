/* Returns { provider, sessions: [{ title, subtitle, progress, state, type,
   player }] }. progress is 0..1, or null when the source has no duration. */

const crypto = require('crypto');

const MAX = 5;

function authErr(r) {
  return r.status === 401 || r.status === 403;
}

async function plex(ctx) {
  const base = ctx.normalizeBase(ctx.config.plexUrl);
  const token = ctx.config.plexToken;
  if (!base || !token) ctx.fail('Plex URL and token required', { kind: ctx.KIND.INVALID });
  /* Plex returns XML unless JSON is requested. */
  const r = await ctx.fetchJSON(`${base}/status/sessions`, {
    headers: { Accept: 'application/json', 'X-Plex-Token': token },
    timeout: 8000,
  });
  if (authErr(r)) ctx.fail('Plex auth failed (check token)', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail('Plex HTTP ' + r.status);
  let list = (r.data && r.data.MediaContainer && r.data.MediaContainer.Metadata) || [];
  if (!Array.isArray(list)) list = [list];
  return list.map(m => {
    const type = (m.type || '').toLowerCase();
    let title = m.title || '',
      subtitle = '';
    if (type === 'episode') subtitle = m.grandparentTitle || '';
    else if (type === 'track') subtitle = m.grandparentTitle || m.parentTitle || '';
    const dur = +m.duration || 0,
      off = +m.viewOffset || 0; // milliseconds
    const progress = dur > 0 ? Math.min(1, Math.max(0, off / dur)) : null;
    const pstate = (m.Player && m.Player.state) || 'playing'; // playing | paused | buffering
    const player = (m.Player && (m.Player.title || m.Player.product)) || '';
    return { title, subtitle, progress, state: pstate === 'paused' ? 'paused' : 'playing', type, player };
  });
}

async function jellyfinLike(ctx, provider) {
  const base = ctx.normalizeBase(provider === 'emby' ? ctx.config.embyUrl : ctx.config.jellyfinUrl);
  const key = provider === 'emby' ? ctx.config.embyKey : ctx.config.jellyfinKey;
  const name = provider === 'emby' ? 'Emby' : 'Jellyfin';
  if (!base || !key) ctx.fail(name + ' URL and API key required', { kind: ctx.KIND.INVALID });
  /* Header auth. Jellyfin deprecated the api_key query param. */
  const authHeaders = provider === 'emby' ? { 'X-Emby-Token': key } : { Authorization: `MediaBrowser Token="${key}"` };
  const r = await ctx.fetchJSON(`${base}/Sessions`, { headers: authHeaders, timeout: 8000 });
  if (authErr(r)) ctx.fail(name + ' auth failed', { kind: ctx.KIND.AUTH });
  if (r.status >= 400) ctx.fail(name + ' HTTP ' + r.status);
  const list = Array.isArray(r.data) ? r.data : [];
  const out = [];
  for (const s of list) {
    const np = s.NowPlayingItem;
    if (!np) continue;
    const ps = s.PlayState || {};
    const t = np.Type || '';
    let title = np.Name || '',
      subtitle = '';
    if (t === 'Episode') {
      subtitle = np.SeriesName || '';
      if (np.ParentIndexNumber != null && np.IndexNumber != null)
        subtitle = (np.SeriesName ? np.SeriesName + ' · ' : '') + `S${np.ParentIndexNumber}E${np.IndexNumber}`;
    } else if (t === 'Audio') {
      subtitle = np.AlbumArtist || np.Album || '';
    }
    const run = +np.RunTimeTicks || 0,
      pos = +ps.PositionTicks || 0;
    out.push({
      title,
      subtitle,
      progress: run > 0 ? Math.min(1, pos / run) : null,
      state: ps.IsPaused ? 'paused' : 'playing',
      type: t.toLowerCase(),
      player: s.DeviceName || s.Client || '',
    });
  }
  return out;
}

async function navidrome(ctx) {
  const base = ctx.normalizeBase(ctx.config.navidromeUrl);
  const user = ctx.config.navidromeUser,
    pass = ctx.config.navidromePassword;
  if (!base || !user || !pass) ctx.fail('Navidrome URL, username and password required', { kind: ctx.KIND.INVALID });
  /* md5(password + salt) is the Subsonic API's authentication token. Anything
     stronger fails to authenticate, and the only alternative the protocol
     offers is the password in clear text. Not a password hash at rest. CodeQL
     flags it as js/insufficient-password-hash and the alert is dismissed. */
  const salt = crypto.randomBytes(6).toString('hex');
  const token = crypto
    .createHash('md5')
    .update(pass + salt)
    .digest('hex');
  const url = `${base}/rest/getNowPlaying?u=${encodeURIComponent(user)}&t=${token}&s=${salt}&v=1.16.1&c=stackyard&f=json`;
  const r = await ctx.fetchJSON(url, { timeout: 8000 });
  if (r.status >= 400) ctx.fail('Navidrome HTTP ' + r.status);
  const sr = r.data && r.data['subsonic-response'];
  if (sr && sr.status === 'failed')
    ctx.fail('Navidrome rejected the request, check username and password', { kind: ctx.KIND.AUTH });
  let entries = (sr && sr.nowPlaying && sr.nowPlaying.entry) || [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries.map(e => {
    const dur = +e.duration || 0; // Subsonic duration is seconds
    const pos = e.positionMs != null ? +e.positionMs : null; // OpenSubsonic playbackReport (Navidrome >= 0.62), ms
    const progress = pos != null && dur > 0 ? Math.min(1, Math.max(0, pos / (dur * 1000))) : null;
    const state = e.state === 'paused' ? 'paused' : 'playing'; // starting/playing -> playing
    return {
      title: e.title || '',
      subtitle: e.artist || e.album || '',
      progress,
      state,
      type: 'track',
      player: e.playerName || '',
    };
  });
}

module.exports = async function (ctx) {
  const provider = ctx.config.provider || '';
  let sessions;
  if (provider === 'plex') sessions = await plex(ctx);
  else if (provider === 'jellyfin' || provider === 'emby') sessions = await jellyfinLike(ctx, provider);
  else if (provider === 'navidrome') sessions = await navidrome(ctx);
  else ctx.fail('No media server configured', { kind: ctx.KIND.INVALID });
  return { provider, sessions: sessions.filter(s => s.title).slice(0, MAX) };
};
