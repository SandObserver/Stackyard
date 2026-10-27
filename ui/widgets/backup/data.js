/* The job pickers run per group row and read that row's own URL and password
   from ctx.row. */

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
  pbsGroupId,
  pbsParseGroupId,
  pbsDeriveStatus,
  pbsLogNamespace,
  plausibleMs,
  epochMs,
  backrestLatest,
  backrestDeriveStatus,
} = require('./backup-status');

const BACKUP_MS = 10000; /* backup providers respond more slowly than a normal data fetch */

/* Cached per instance, not per widget: several slots can point at the same
   container. The password is kept alongside, so a changed password forces a
   fresh login. */
const _dupTokens = new Map();

const authKind = (r, ctx) => ([400, 401, 403].includes(r.status) ? ctx.KIND.AUTH : ctx.KIND.UPSTREAM);

function thrownKind(e, ctx) {
  if (e && typeof e.kind === 'string') return e.kind;
  if (e && e.message === 'Timed out') return ctx.KIND.TIMEOUT;
  if (e && e.message === 'Response too large') return ctx.KIND.UPSTREAM;
  return ctx.KIND.NETWORK;
}

async function dupLogin(base, password, ctx) {
  const r = await ctx.fetchJSON(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Password: password }),
    timeout: BACKUP_MS,
  });
  if (r.status !== 200) ctx.fail(`Duplicati login failed: HTTP ${r.status}`, { kind: authKind(r, ctx) });
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
  if (r.status !== 200) ctx.fail(`Duplicati refresh failed: HTTP ${r.status}`, { kind: authKind(r, ctx) });
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
      _dupTokens.delete(base);
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

const PBS_TOKEN_ID = /^[^\s:@!]+@[A-Za-z0-9_][A-Za-z0-9._-]*![A-Za-z0-9_][A-Za-z0-9._-]*$/;
const PBS_SECRET = /^[A-Za-z0-9-]+$/;
const PBS_MAX_STORES = 20;
const PBS_MAX_NAMESPACES = 20;
const PBS_TASK_WINDOW_S = 7 * 24 * 3600;
const PBS_LOG_LINES = 5;
const PBS_LOG_READS = 4;
const PBS_TASK_NS_MAX = 2000;

/* The PBS API listens on HTTPS only. A bare host must not send the token over http. */
const pbsBase = url => dupNormalizeBase(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);

function pbsConn(row, ctx) {
  const url = (row.pbsUrl || '').trim();
  if (!url) ctx.fail('Proxmox Backup Server URL required', { kind: ctx.KIND.INVALID });
  const tokenId = (row.pbsTokenId || '').trim();
  const secret = (row.pbsSecret || '').trim();
  /* Both go into a request header. */
  if (!PBS_TOKEN_ID.test(tokenId) || !PBS_SECRET.test(secret)) {
    ctx.fail('Enter a token ID like user@pbs!name and its secret', { kind: ctx.KIND.INVALID });
  }
  return { base: pbsBase(url), tokenId, secret, skipTls: row.pbsSkipTls === true };
}

async function pbsGet(conn, path, ctx, keep) {
  const r = await ctx.fetchJSON(`${conn.base}/api2/json${path}`, {
    headers: { Authorization: `PBSAPIToken=${conn.tokenId}:${conn.secret}` },
    skipTls: conn.skipTls,
    timeout: BACKUP_MS,
  });
  if (r.status === 401 || r.status === 403)
    ctx.fail('Proxmox Backup Server refused the token', { kind: ctx.KIND.AUTH });
  if (r.status !== 200) ctx.fail(`Proxmox Backup Server returned HTTP ${r.status}`);
  if (!Array.isArray(r.data?.data)) {
    ctx.fail('Proxmox Backup Server sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
  }
  return r.data.data.filter(x => x && typeof x === 'object' && !Array.isArray(x) && keep(x));
}

const isStr = v => typeof v === 'string';
const PBS_KEEP = {
  store: x => isStr(x.store) && x.store !== '',
  ns: x => x.ns == null || isStr(x.ns),
  group: x => ['vm', 'ct', 'host'].includes(x['backup-type']) && isStr(x['backup-id']) && x['backup-id'] !== '',
  task: x => isStr(x.upid) && isStr(x.worker_id) && isStr(x.worker_type),
  any: () => true,
};

const pbsStorePath = store => `/admin/datastore/${encodeURIComponent(store)}`;
const pbsNsQuery = ns => (ns ? `?ns=${encodeURIComponent(ns)}` : '');
const pbsComment = x => (isStr(x?.comment) ? x.comment : '');

async function pbsGroups(row, ctx) {
  const conn = pbsConn(row, ctx);
  const listed = await pbsGet(conn, '/admin/datastore', ctx, PBS_KEEP.store);
  let truncated = listed.length > PBS_MAX_STORES;
  const perStore = await Promise.all(
    listed.slice(0, PBS_MAX_STORES).map(async ({ store }) => {
      let spaces = [''];
      try {
        const found = await pbsGet(conn, `${pbsStorePath(store)}/namespace`, ctx, PBS_KEEP.ns);
        if (found.length) spaces = found.map(n => n.ns || '');
      } catch {}
      if (spaces.length > PBS_MAX_NAMESPACES) truncated = true;
      const lists = await Promise.all(
        spaces.slice(0, PBS_MAX_NAMESPACES).map(async ns =>
          (await pbsGet(conn, `${pbsStorePath(store)}/groups${pbsNsQuery(ns)}`, ctx, PBS_KEEP.group)).map(g => ({
            ns,
            g,
          })),
        ),
      );
      return lists.flat().map(({ ns, g }) => {
        const where = ns ? `${store}/${ns}` : store;
        const what = `${g['backup-type']}/${g['backup-id']}`;
        const note = pbsComment(g);
        return { value: pbsGroupId(store, ns, g), label: `${where}: ${what}${note ? ` (${note})` : ''}` };
      });
    }),
  );
  return truncated ? { options: perStore.flat(), truncated } : { options: perStore.flat() };
}

const _pbsTaskNs = new Map();

function pbsTaskNs(conn, upid, ctx, mayRead) {
  const key = `${conn.base}|${upid}`;
  let p = _pbsTaskNs.get(key);
  if (p || !mayRead) return p || null;
  p = pbsGet(conn, `/nodes/localhost/tasks/${encodeURIComponent(upid)}/log?limit=${PBS_LOG_LINES}`, ctx, PBS_KEEP.any)
    .then(lines => pbsLogNamespace(lines.map(l => l.t)))
    .catch(() => null)
    .then(ns => {
      if (ns == null) _pbsTaskNs.delete(key);
      return ns;
    });
  _pbsTaskNs.set(key, p);
  while (_pbsTaskNs.size > PBS_TASK_NS_MAX) _pbsTaskNs.delete(_pbsTaskNs.keys().next().value);
  return p;
}

/* PBS 4.2 can move a group to another namespace of its datastore. The type and
   id stay. Kept per card so the search runs once after a move. */
const _pbsMoved = new Map();
const PBS_MOVED_MAX = 200;

const pbsSameGroup = ref => g => g['backup-type'] === ref.type && g['backup-id'] === ref.id;

/** The one other namespace of the datastore that holds this group, or null
    when none does, several do, or a list cannot be read. */
async function pbsFindMoved(conn, ref, ctx) {
  let spaces;
  try {
    spaces = (await pbsGet(conn, `${pbsStorePath(ref.store)}/namespace`, ctx, PBS_KEEP.ns)).map(n => n.ns || '');
  } catch {
    return null;
  }
  if (!spaces.length) spaces = [''];
  if (spaces.length > PBS_MAX_NAMESPACES) return null;
  const lists = await Promise.all(
    spaces
      .filter(ns => ns !== ref.ns)
      .map(async ns => {
        const groups = await pbsGet(
          conn,
          `${pbsStorePath(ref.store)}/groups${pbsNsQuery(ns)}`,
          ctx,
          PBS_KEEP.group,
        ).catch(() => null);
        return groups && { ns, group: groups.find(pbsSameGroup(ref)) };
      }),
  );
  if (lists.includes(null)) return null;
  const hits = lists.filter(l => l.group);
  return hits.length === 1 ? hits[0] : null;
}

async function pbsGroupTasks(conn, storeTasks, ref, ctx) {
  if (!storeTasks) return null;
  const workerId = `${ref.store}:${ref.type}/${ref.id}`;
  let reads = 0;
  for (const t of storeTasks) {
    if (t.worker_type !== 'backup' || t.worker_id !== workerId) continue;
    const cached = pbsTaskNs(conn, t.upid, ctx, false);
    if (!cached && reads++ >= PBS_LOG_READS) return null;
    const found = await (cached || pbsTaskNs(conn, t.upid, ctx, true));
    if (found == null) return null;
    if (found === ref.ns) return [t];
  }
  return [];
}

function backrestHeaders(user, pass) {
  const headers = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };
  if (user && pass) headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  return headers;
}

async function backrestSummary(url, user, pass, ctx) {
  const r = await ctx.fetchJSON(dupNormalizeBase(url) + '/v1.Backrest/GetSummaryDashboard', {
    method: 'POST',
    headers: backrestHeaders(user, pass),
    body: '{}',
    timeout: BACKUP_MS,
  });
  if (r.status === 401 || r.status === 403) ctx.fail('Backrest authentication failed', { kind: ctx.KIND.AUTH });
  if (r.status !== 200) ctx.fail(`Backrest returned HTTP ${r.status}`);
  /* Keep the default. An empty dashboard omits the field. */
  const plans = r.data?.planSummaries ?? [];
  if (!r.data || typeof r.data !== 'object' || !Array.isArray(plans)) {
    ctx.fail('Backrest sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
  }
  return plans.filter(p => p && typeof p === 'object' && isStr(p.id) && p.id !== '');
}

async function backrestPlans(row, ctx) {
  const url = (row.backrestUrl || '').trim();
  if (!url) ctx.fail('Backrest URL required', { kind: ctx.KIND.INVALID });
  const plans = await backrestSummary(url, (row.backrestUser || '').trim(), row.backrestPass || '', ctx);
  return { options: plans.filter(p => p.id).map(p => ({ value: p.id, label: p.id })) };
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

function dupLink(ctx, slot, id) {
  return ctx.serviceLink(slot.dupHref, slot.dupUrl, `/ngclient/backup/${encodeURIComponent(id)}/log`);
}

function kopiaLink(ctx, slot, source) {
  const q = ['userName', 'host', 'path'].map(k => `${k}=${encodeURIComponent(source[k] ?? '')}`).join('&');
  return ctx.serviceLink(slot.kopiaHref, slot.kopiaUrl, `/snapshots/single-source?${q}`);
}

/* Grouped by instance, then written back by index. Nulls are kept: the card
   maps result to slot by position. */
async function slots(config, ctx) {
  const list = Array.isArray(config.slots) ? config.slots : [];
  const dupGroups = {},
    kopiaGroups = {},
    pbsInstances = {},
    backrestGroups = {};

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
    } else if (s.provider === 'pbs' && s.pbsUrl) {
      const key = [s.pbsUrl.trim(), s.pbsTokenId, s.pbsSecret, s.pbsSkipTls === true].join('|');
      if (!pbsInstances[key]) pbsInstances[key] = { row: s, slots: [] };
      pbsInstances[key].slots.push({ i, jobId: String(s.jobId), customName: s.customName || '' });
    } else if (s.provider === 'backrest' && s.backrestUrl) {
      const key = [s.backrestUrl.trim(), s.backrestUser || '', s.backrestPass || ''].join('|');
      if (!backrestGroups[key]) {
        backrestGroups[key] = {
          url: s.backrestUrl.trim(),
          user: (s.backrestUser || '').trim(),
          pass: s.backrestPass || '',
          slots: [],
        };
      }
      backrestGroups[key].slots.push({ i, jobId: String(s.jobId), customName: s.customName || '' });
    }
  });

  const result = Array(list.length).fill(null);
  /* A card for an instance that stopped answering must not keep its last status. */
  const failSlots = (gs, kind) => {
    for (const { i } of gs) result[i] = { error: kind };
  };

  const dupDone = Promise.all(
    Object.values(dupGroups).map(async ({ base, pass, slots: gs }) => {
      try {
        const [stateR, backupsR] = await Promise.all([
          dupFetch(base, pass, '/api/v1/serverstate', ctx),
          dupFetch(base, pass, '/api/v1/backups', ctx),
        ]);
        if (stateR.status === 401 || backupsR.status === 401) return failSlots(gs, ctx.KIND.AUTH);
        if (stateR.status >= 400 || backupsR.status >= 400) return failSlots(gs, ctx.KIND.UPSTREAM);
        const serverState = stateR.data || {};
        const backups = dupList(backupsR.data);
        const proposed = {};
        (serverState.ProposedSchedule || []).forEach(p => {
          if (p.Item1 && p.Item2) proposed[String(p.Item1)] = p.Item2;
        });
        gs.forEach(({ i, jobId, customName }) => {
          const j = backups.find(b => dupId(b) === jobId);
          if (!j) {
            result[i] = { error: ctx.KIND.INVALID };
            return;
          }
          const id = dupId(j);
          const meta = dupMeta(j);
          result[i] = {
            id,
            name: customName || dupName(j),
            status: dupDeriveStatus(j, serverState),
            lastFinished: meta.LastBackupFinished || meta.LastBackupDate || meta.LastBackupStarted || null,
            nextRun: proposed[id] || dupSchedule(j)?.Time || null,
            link: dupLink(ctx, list[i], id),
          };
        });
      } catch (e) {
        /* One unreachable instance must leave the rest of the widget intact. */
        ctx.log.warn('backup: duplicati group failed', { base, error: e.message });
        failSlots(gs, thrownKind(e, ctx));
      }
    }),
  );

  const kopiaDone = Promise.all(
    Object.values(kopiaGroups).map(async ({ url, user, pass, slots: gs }) => {
      try {
        const r = await kopiaFetch(url, user, pass, '/api/v1/sources', ctx);
        if (r.status === 401 || r.status === 403) return failSlots(gs, ctx.KIND.AUTH);
        if (r.status !== 200) return failSlots(gs, ctx.KIND.UPSTREAM);
        const allSources = r.data?.sources || [];
        gs.forEach(({ i, jobId, customName }) => {
          const s = allSources.find(src => kopiaSourceId(src.source) === jobId);
          if (!s) {
            result[i] = { error: ctx.KIND.INVALID };
            return;
          }
          result[i] = {
            id: kopiaSourceId(s.source),
            name: customName || s.source.path,
            status: kopiaDeriveStatus(s),
            lastFinished: s.lastSnapshot?.endTime || null,
            nextRun: null,
            link: kopiaLink(ctx, list[i], s.source),
          };
        });
      } catch (e) {
        ctx.log.warn('backup: kopia group failed', { url, error: e.message });
        failSlots(gs, thrownKind(e, ctx));
      }
    }),
  );

  const pbsDone = Promise.all(
    Object.values(pbsInstances).map(async ({ row, slots: gs }) => {
      try {
        const conn = pbsConn(row, ctx);
        const wanted = gs.map(g => {
          const saved = pbsParseGroupId(g.jobId);
          const movedKey = `${conn.base}|${g.jobId}`;
          const moved = saved && _pbsMoved.get(movedKey);
          return { ...g, saved, movedKey, ref: saved && moved != null ? { ...saved, ns: moved } : saved };
        });
        const spaces = new Map();
        for (const { ref } of wanted) if (ref) spaces.set(`${ref.store}:${ref.ns}`, ref);
        const groupLists = new Map();
        for (const [key, { store, ns }] of spaces) {
          const listed = pbsGet(conn, `${pbsStorePath(store)}/groups${pbsNsQuery(ns)}`, ctx, PBS_KEEP.group);
          listed.catch(() => {});
          groupLists.set(key, listed);
        }
        const since = Math.floor(Date.now() / 1000) - PBS_TASK_WINDOW_S;
        const tasksByStore = new Map();
        for (const store of new Set(wanted.filter(w => w.ref).map(w => w.ref.store))) {
          const q = `?store=${encodeURIComponent(store)}&typefilter=backup&since=${since}&limit=500`;
          tasksByStore.set(
            store,
            pbsGet(conn, `/nodes/localhost/tasks${q}`, ctx, PBS_KEEP.task).catch(() => null),
          );
        }
        await Promise.all(
          wanted.map(async ({ i, saved, movedKey, ref: at, customName }) => {
            try {
              if (!saved) {
                result[i] = { error: ctx.KIND.INVALID };
                return;
              }
              let ref = at;
              let listError = null;
              let group = null;
              try {
                group = (await groupLists.get(`${ref.store}:${ref.ns}`)).find(pbsSameGroup(ref)) || null;
              } catch (e) {
                listError = e;
              }
              if (!group) {
                const moved = await pbsFindMoved(conn, ref, ctx);
                if (!moved) {
                  _pbsMoved.delete(movedKey);
                  if (listError) throw listError;
                  result[i] = { error: ctx.KIND.INVALID };
                  return;
                }
                ref = { ...saved, ns: moved.ns };
                group = moved.group;
                _pbsMoved.delete(movedKey);
                if (moved.ns !== saved.ns) _pbsMoved.set(movedKey, moved.ns);
                while (_pbsMoved.size > PBS_MOVED_MAX) _pbsMoved.delete(_pbsMoved.keys().next().value);
              }
              const q = new URLSearchParams({ 'backup-type': ref.type, 'backup-id': ref.id });
              if (ref.ns) q.set('ns', ref.ns);
              const [snaps, storeTasks] = await Promise.all([
                pbsGet(conn, `${pbsStorePath(ref.store)}/snapshots?${q}`, ctx, PBS_KEEP.any),
                tasksByStore.get(ref.store),
              ]);
              const time = s => epochMs(s['backup-time']) || 0;
              const newest = snaps.reduce((a, b) => (time(b) > (a ? time(a) : 0) ? b : a), null);
              const tasks = await pbsGroupTasks(conn, storeTasks, ref, ctx);
              const lastMs = epochMs(group['last-backup']);
              result[i] = {
                id: pbsGroupId(ref.store, ref.ns, group),
                name: customName || pbsComment(newest) || pbsComment(group) || `${ref.type}/${ref.id}`,
                status: pbsDeriveStatus(group, newest, tasks),
                lastFinished: lastMs ? new Date(lastMs).toISOString() : null,
                nextRun: null,
                link: ctx.serviceLink(list[i].pbsHref, list[i].pbsUrl),
              };
            } catch (e) {
              ctx.log.warn('backup: proxmox backup server slot failed', { url: row.pbsUrl, error: e.message });
              result[i] = { error: thrownKind(e, ctx) };
            }
          }),
        );
      } catch (e) {
        ctx.log.warn('backup: proxmox backup server group failed', { url: row.pbsUrl, error: e.message });
        failSlots(gs, thrownKind(e, ctx));
      }
    }),
  );

  const backrestDone = Promise.all(
    Object.values(backrestGroups).map(async ({ url, user, pass, slots: gs }) => {
      try {
        const plans = await backrestSummary(url, user, pass, ctx);
        gs.forEach(({ i, jobId, customName }) => {
          const p = plans.find(pl => pl.id === jobId);
          if (!p) {
            result[i] = { error: ctx.KIND.INVALID };
            return;
          }
          const next = plausibleMs(p.nextBackupTimeMs);
          const finished = backrestLatest(p)?.finishedMs;
          result[i] = {
            id: p.id,
            name: customName || p.id,
            status: backrestDeriveStatus(p),
            lastFinished: finished ? new Date(finished).toISOString() : null,
            nextRun: next ? new Date(next).toISOString() : null,
            link: ctx.serviceLink(list[i].backrestHref, list[i].backrestUrl, `/#/plan/${encodeURIComponent(p.id)}`),
          };
        });
      } catch (e) {
        ctx.log.warn('backup: backrest group failed', { url, error: e.message });
        failSlots(gs, thrownKind(e, ctx));
      }
    }),
  );

  await Promise.all([dupDone, kopiaDone, pbsDone, backrestDone]);
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
  if (endpoint === 'pbs-groups') {
    if (!row) ctx.fail('No slot selected', { kind: ctx.KIND.INVALID });
    return pbsGroups(row, ctx);
  }
  if (endpoint === 'backrest-plans') {
    if (!row) ctx.fail('No slot selected', { kind: ctx.KIND.INVALID });
    return backrestPlans(row, ctx);
  }
  return slots(config, ctx);
};
