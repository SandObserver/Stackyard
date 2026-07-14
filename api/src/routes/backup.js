const { on, json, readBody, checkOrigin } = require('../router');
const { loadConfig } = require('../config');
const { fetchJSON } = require('../proxy');
const { BACKUP_MS } = require('../timeouts');
const { dupList, dupId, dupName, dupMeta, dupSchedule, dupNormalizeBase, dupDeriveStatus, kopiaDeriveStatus, kopiaSourceId } = require('../backup-status');

const _dupTokens = new Map();

async function dupLogin(base, password) {
  const r = await fetchJSON(base + '/api/v1/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ Password: password }),
    timeout: BACKUP_MS,
  });
  if (r.status !== 200) throw new Error(`Duplicati login failed: HTTP ${r.status}`);
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) throw new Error('Duplicati login returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupRefresh(base, refreshNonce) {
  const r = await fetchJSON(base + '/api/v1/auth/refresh', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ RefreshNonce: refreshNonce }),
    timeout: BACKUP_MS,
  });
  if (r.status !== 200) throw new Error(`Duplicati refresh failed: HTTP ${r.status}`);
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) throw new Error('Duplicati refresh returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupGetToken(widgetId, base, password) {
  const cached = _dupTokens.get(widgetId);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.accessToken;
  let tokens;
  if (cached?.refreshNonce) {
    try { tokens = await dupRefresh(base, cached.refreshNonce); }
    catch { tokens = await dupLogin(base, password); }
  } else {
    tokens = await dupLogin(base, password);
  }
  _dupTokens.set(widgetId, {
    accessToken:  tokens.accessToken,
    refreshNonce: tokens.refreshNonce,
    expiresAt:    Date.now() + 4.5 * 60 * 1000, /* 4m30s, 30s before 5m expiry */
  });
  return tokens.accessToken;
}

async function dupFetch(widgetId, base, password, path) {
  const token = await dupGetToken(widgetId, base, password);
  const r = await fetchJSON(base + path, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: BACKUP_MS,
  });
  if (r.status === 401) {
    _dupTokens.delete(widgetId);
    const token2 = await dupGetToken(widgetId, base, password);
    const r2 = await fetchJSON(base + path, {
      headers: { 'Authorization': `Bearer ${token2}` },
      timeout: BACKUP_MS,
    });
    return r2;
  }
  return r;
}

on('POST', '/api/duplicati-jobs/:id', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const body     = JSON.parse(await readBody(req));
    const url      = (body.url || '').trim();
    if (!url) return json(res, 400, { error: 'url required' });
    const base = dupNormalizeBase(url);

    let password = (body.password || '').trim();
    if (!password && body.useStoredPass) {
      const cfg = loadConfig();
      const wid = req.params.id;
      const w   = cfg.items?.find(i => i.id === wid && i.type === 'widget');
      const slot = (w?.widgetConfig?.slots || []).find(s =>
        s?.provider === 'duplicati' &&
        dupNormalizeBase(s.dupUrl || '') === base &&
        s.dupPass
      );
      password = slot?.dupPass || '';
    }

    const tokenKey = req.params.id + '_jobs_fetch';
    _dupTokens.delete(tokenKey); /* always fresh for admin fetch */
    const token = await dupGetToken(tokenKey, base, password);

    const r = await fetchJSON(base + '/api/v1/backups', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: BACKUP_MS,
    });
    if (r.status === 401) return json(res, 401, { error: 'Authentication failed, check password' });

    const jobs = dupList(r.data)
      .map(j => ({ id: dupId(j), name: dupName(j) }))
      .filter(j => j.id !== '');

    json(res, 200, jobs);
  } catch(e) { json(res, 502, { error: e.message }); }
});

async function kopiaFetch(url, username, password, path) {
  const headers = {};
  if (username && password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }
  return fetchJSON(url.replace(/\/$/, '') + path, { headers, timeout: BACKUP_MS });
}

on('POST', '/api/kopia-sources/:id', async(req, res) => {
  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch {}

  const url      = body.url?.trim();
  const username = body.username?.trim() || '';
  let   password = body.password?.trim() || '';

  if (!password && body.useStoredPass) {
    const cfg = loadConfig();
    const w   = cfg.items?.find(i => i.id === req.params.id);
    if (w?.widgetConfig?.kopiaPass) password = w.widgetConfig.kopiaPass;
  }

  if (!url) return json(res, 400, { error: 'URL required' });

  try {
    const r = await kopiaFetch(url, username, password, '/api/v1/sources');
    if (r.status === 401) return json(res, 401, { error: 'Kopia authentication failed' });
    if (r.status !== 200) return json(res, 502, { error: `Kopia returned HTTP ${r.status}` });

    const sources = (r.data?.sources || []).map(s => ({
      id:   kopiaSourceId(s.source),
      name: s.source.path,
    }));
    json(res, 200, sources);
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/backup-data/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error: 'widget not found' });

  const wc    = w.widgetConfig || {};
  const slots = Array.isArray(wc.slots) ? wc.slots : [];

  const dupGroups   = {};  /* url → {base, pass, slots:[{i,jobId}]} */
  const kopiaGroups = {};  /* url → {url, user, pass, slots:[{i,jobId}]} */

  slots.forEach((s, i) => {
    if (!s?.provider || !s.jobId) return;
    if (s.provider === 'duplicati' && s.dupUrl) {
      const base = dupNormalizeBase(s.dupUrl);
      if (!dupGroups[base]) dupGroups[base] = { base, pass: s.dupPass||'', slots:[] };
      dupGroups[base].slots.push({ i, jobId: String(s.jobId), customName: s.customName||'' });
    } else if (s.provider === 'kopia' && s.kopiaUrl) {
      const url = s.kopiaUrl.trim();
      if (!kopiaGroups[url]) kopiaGroups[url] = { url, user: s.kopiaUser||'', pass: s.kopiaPass||'', slots:[] };
      kopiaGroups[url].slots.push({ i, jobId: s.jobId, customName: s.customName||'' });
    }
  });

  const result = Array(slots.length).fill(null);

  try {
    await Promise.all(Object.values(dupGroups).map(async ({base, pass, slots: gs}) => {
      try {
        const [stateR, backupsR] = await Promise.all([
          dupFetch(req.params.id, base, pass, '/api/v1/serverstate'),
          dupFetch(req.params.id, base, pass, '/api/v1/backups'),
        ]);
        if (stateR.status === 401 || backupsR.status === 401) return;
        const serverState = stateR.data || {};
        const backups     = dupList(backupsR.data);
        const proposed    = {};
        (serverState.ProposedSchedule||[]).forEach(p=>{ if(p.Item1&&p.Item2) proposed[String(p.Item1)]=p.Item2; });
        gs.forEach(({i, jobId, customName}) => {
          const j = backups.find(b => dupId(b) === jobId);
          if (!j) return;
          const id = dupId(j);
          const meta = dupMeta(j);
          result[i] = { id, name: customName || dupName(j),
            status: dupDeriveStatus(j, serverState),
            lastFinished: meta.LastBackupFinished||meta.LastBackupDate||meta.LastBackupStarted||null,
            nextRun: proposed[id]||dupSchedule(j)?.Time||null };
        });
      } catch {}
    }));

    await Promise.all(Object.values(kopiaGroups).map(async ({url, user, pass, slots: gs}) => {
      try {
        const r = await kopiaFetch(url, user, pass, '/api/v1/sources');
        if (r.status !== 200) return;
        const allSources = r.data?.sources||[];
        gs.forEach(({i, jobId, customName}) => {
          const s = allSources.find(src => kopiaSourceId(src.source) === jobId);
          if (!s) return;
          result[i] = { id: kopiaSourceId(s.source), name: customName || s.source.path,
            status: kopiaDeriveStatus(s),
            lastFinished: s.lastSnapshot?.endTime||null, nextRun: null };
        });
      } catch {}
    }));

    json(res, 200, result);   /* indexed by slot; nulls kept so the widget maps by index */
  } catch(e) { json(res, 502, { error: e.message }); }
});
