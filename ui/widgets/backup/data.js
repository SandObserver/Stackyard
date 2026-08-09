/* Backup widget data. Three endpoints: "slots" for the dashboard card, and
   "duplicati-jobs"/"kopia-sources" for the admin job pickers, which run per
   group row and read that row's own URL and password from ctx.row. */

const {
  dupList,
  dupId,
  dupName,
  dupMeta,
  dupSchedule,
  dupNormalizeBase,
  dupDeriveStatus,
  kopiaDeriveStatus,
  kopiaSourceId,
} = require('./backup-status');

const BACKUP_MS = 10000; /* backup providers respond more slowly than a normal data fetch */

/* Duplicati issues short-lived access tokens, so one is cached per instance
   rather than per widget: several slots and several widgets can point at the
   same container. The password is kept alongside so a changed password forces a
   fresh login instead of reusing a token minted with the old one. */
const _dupTokens = new Map();

async function dupLogin(base, password, ctx) {
  const r = await ctx.fetchJSON(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Password: password }),
    timeout: BACKUP_MS,
  });
  if (r.status !== 200) ctx.fail(`Duplicati login failed: HTTP ${r.status}`, { kind: ctx.KIND.AUTH });
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) ctx.fail('Duplicati login returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupRefresh(base, refreshNonce, ctx) {
  const r = await ctx.fetchJSON(base + '/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RefreshNonce: refreshNonce }),
    timeout: BACKUP_MS,
  });
  if (r.status !== 200) ctx.fail(`Duplicati refresh failed: HTTP ${r.status}`, { kind: ctx.KIND.AUTH });
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) ctx.fail('Duplicati refresh returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupGetToken(base, password, ctx) {
  const cached = _dupTokens.get(base);
  if (cached && cached.password === password && cached.expiresAt > Date.now() + 30000) return cached.accessToken;
  let tokens;
  if (cached && cached.password === password && cached.refreshNonce) {
    try {
      tokens = await dupRefresh(base, cached.refreshNonce, ctx);
    } catch {
      tokens = await dupLogin(base, password, ctx);
    }
  } else {
    tokens = await dupLogin(base, password, ctx);
  }
  _dupTokens.set(base, {
    accessToken: tokens.accessToken,
    refreshNonce: tokens.refreshNonce,
    password,
    expiresAt: Date.now() + 4.5 * 60 * 1000 /* 4m30s, 30s before 5m expiry */,
  });
  return tokens.accessToken;
}

async function dupFetch(base, password, path, ctx) {
  const token = await dupGetToken(base, password, ctx);
  const r = await ctx.fetchJSON(base + path, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: BACKUP_MS,
  });
  if (r.status !== 401) return r;
  _dupTokens.delete(base);
  const retry = await dupGetToken(base, password, ctx);
  return ctx.fetchJSON(base + path, {
    headers: { Authorization: `Bearer ${retry}` },
    timeout: BACKUP_MS,
  });
}

function kopiaFetch(url, username, password, path, ctx) {
  const headers = {};
  if (username && password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }
  return ctx.fetchJSON(url.replace(/\/$/, '') + path, { headers, timeout: BACKUP_MS });
}

async function duplicatiJobs(row, ctx) {
  const url = (row.dupUrl || '').trim();
  if (!url) ctx.fail('Duplicati URL not configured', { kind: ctx.KIND.INVALID });
  const r = await dupFetch(dupNormalizeBase(url), row.dupPass || '', '/api/v1/backups', ctx);
  if (r.status === 401) ctx.fail('Authentication failed, check password', { kind: ctx.KIND.AUTH });
  return {
    options: dupList(r.data)
      .map(j => ({ value: dupId(j), label: dupName(j) }))
      .filter(o => o.value !== ''),
  };
}

async function kopiaSources(row, ctx) {
  const url = (row.kopiaUrl || '').trim();
  if (!url) ctx.fail('Kopia URL required', { kind: ctx.KIND.INVALID });
  const r = await kopiaFetch(url, (row.kopiaUser || '').trim(), row.kopiaPass || '', '/api/v1/sources', ctx);
  if (r.status === 401) ctx.fail('Kopia authentication failed', { kind: ctx.KIND.AUTH });
  if (r.status !== 200) ctx.fail(`Kopia returned HTTP ${r.status}`);
  return {
    options: (r.data?.sources || []).map(s => ({ value: kopiaSourceId(s.source), label: s.source.path })),
  };
}

/* Group the configured slots by instance so one widget with three slots on the
   same container makes one round of upstream calls, then write each answer back
   into the slot's own index. Nulls are kept so the card maps result to slot by
   position. */
async function slots(config, ctx) {
  const list = Array.isArray(config.slots) ? config.slots : [];
  const dupGroups = {},
    kopiaGroups = {};

  list.forEach((s, i) => {
    if (!s?.provider || !s.jobId) return;
    if (s.provider === 'duplicati' && s.dupUrl) {
      const base = dupNormalizeBase(s.dupUrl);
      if (!dupGroups[base]) dupGroups[base] = { base, pass: s.dupPass || '', slots: [] };
      dupGroups[base].slots.push({ i, jobId: String(s.jobId), customName: s.customName || '' });
    } else if (s.provider === 'kopia' && s.kopiaUrl) {
      const url = s.kopiaUrl.trim();
      if (!kopiaGroups[url]) kopiaGroups[url] = { url, user: s.kopiaUser || '', pass: s.kopiaPass || '', slots: [] };
      kopiaGroups[url].slots.push({ i, jobId: s.jobId, customName: s.customName || '' });
    }
  });

  const result = Array(list.length).fill(null);

  await Promise.all(
    Object.values(dupGroups).map(async ({ base, pass, slots: gs }) => {
      try {
        const [stateR, backupsR] = await Promise.all([
          dupFetch(base, pass, '/api/v1/serverstate', ctx),
          dupFetch(base, pass, '/api/v1/backups', ctx),
        ]);
        if (stateR.status === 401 || backupsR.status === 401) return;
        const serverState = stateR.data || {};
        const backups = dupList(backupsR.data);
        const proposed = {};
        (serverState.ProposedSchedule || []).forEach(p => {
          if (p.Item1 && p.Item2) proposed[String(p.Item1)] = p.Item2;
        });
        gs.forEach(({ i, jobId, customName }) => {
          const j = backups.find(b => dupId(b) === jobId);
          if (!j) return;
          const id = dupId(j);
          const meta = dupMeta(j);
          result[i] = {
            id,
            name: customName || dupName(j),
            status: dupDeriveStatus(j, serverState),
            lastFinished: meta.LastBackupFinished || meta.LastBackupDate || meta.LastBackupStarted || null,
            nextRun: proposed[id] || dupSchedule(j)?.Time || null,
          };
        });
      } catch (e) {
        /* One unreachable instance leaves its own slots null and the rest of the
           widget intact, so the failure is logged rather than thrown. */
        ctx.log.warn('backup: duplicati group failed', { base, error: e.message });
      }
    }),
  );

  await Promise.all(
    Object.values(kopiaGroups).map(async ({ url, user, pass, slots: gs }) => {
      try {
        const r = await kopiaFetch(url, user, pass, '/api/v1/sources', ctx);
        if (r.status !== 200) return;
        const allSources = r.data?.sources || [];
        gs.forEach(({ i, jobId, customName }) => {
          const s = allSources.find(src => kopiaSourceId(src.source) === jobId);
          if (!s) return;
          result[i] = {
            id: kopiaSourceId(s.source),
            name: customName || s.source.path,
            status: kopiaDeriveStatus(s),
            lastFinished: s.lastSnapshot?.endTime || null,
            nextRun: null,
          };
        });
      } catch (e) {
        ctx.log.warn('backup: kopia group failed', { url, error: e.message });
      }
    }),
  );

  return result;
}

module.exports = async function backupData(ctx) {
  const { endpoint, config, row } = ctx;
  if (endpoint === 'duplicati-jobs') {
    if (!row) ctx.fail('No slot selected', { kind: ctx.KIND.INVALID });
    return duplicatiJobs(row, ctx);
  }
  if (endpoint === 'kopia-sources') {
    if (!row) ctx.fail('No slot selected', { kind: ctx.KIND.INVALID });
    return kopiaSources(row, ctx);
  }
  return slots(config, ctx);
};
