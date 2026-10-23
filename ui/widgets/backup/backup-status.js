/* Keep these free of I/O. The login, token and fetch logic stays in data.js. */

function dupList(d) {
  return Array.isArray(d)
    ? d
    : Array.isArray(d?.Items)
      ? d.Items
      : Array.isArray(d?.Data)
        ? d.Data
        : Array.isArray(d?.backups)
          ? d.backups
          : Array.isArray(d?.Backups)
            ? d.Backups
            : [];
}
function dupCore(j) {
  return (j && (j.Backup || j.backup)) || j || {};
}
function dupId(j) {
  const b = dupCore(j);
  return String(b.ID ?? b.Id ?? b.id ?? '');
}
function dupName(j) {
  const b = dupCore(j);
  const id = dupId(j);
  return b.Name || b.name || (id ? `Job ${id}` : 'Backup');
}
function dupMeta(j) {
  const b = dupCore(j);
  return b.Metadata || b.metadata || {};
}
function dupSchedule(j) {
  return j.Schedule || j.schedule || dupCore(j).Schedule || null;
}

function dupNormalizeBase(url) {
  if (!url) throw new Error('Duplicati URL not configured');
  return (url.includes('://') ? url : `http://${url}`).replace(/\/$/, '');
}

function dupParseDate(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (compact) {
    const [, yr, mo, dy, hh, mm, ss] = compact;
    return new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}Z`).getTime();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function dupDeriveStatus(job, serverState) {
  const id = dupId(job);
  const meta = dupMeta(job);
  const tasks = serverState?.ActiveTask;
  const proposed = serverState?.ProposedSchedule || [];

  const isRunning = tasks != null && String(tasks.BackupID || tasks.Item1 || '') === id;
  if (isRunning) return 'running';

  if (serverState?.HasError) return 'error';

  const nextEntry = proposed.find(p => String(p.Item1) === id);
  if (nextEntry && nextEntry.Item2) {
    const nextRun = new Date(nextEntry.Item2).getTime();
    const lastFinished = dupParseDate(meta.LastBackupFinished || meta.LastBackupDate || '');
    if (Date.now() > nextRun && lastFinished < nextRun) return 'missed';
  }

  if (serverState?.HasWarning) return 'warning';

  return 'healthy';
}

function kopiaDeriveStatus(source) {
  const status = (source.status || '').toUpperCase();
  if (status === 'UPLOADING' || status === 'RUNNING') return 'running';
  if (status === 'PAUSED') return 'warning';

  const last = source.lastSnapshot;
  if (!last) return 'warning';

  if ((last.stats?.errorCount || 0) > 0) return 'error';

  const endTime = last.endTime ? new Date(last.endTime).getTime() : 0;
  if (endTime && Date.now() - endTime > STALE_MS) return 'warning';

  return 'healthy';
}

function kopiaSourceId(source) {
  return `${source.host}@${source.userName}:${source.path}`;
}

const STALE_MS = 25 * 60 * 60 * 1000;
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

function plausibleMs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_MS && n < MAX_MS ? n : null;
}

const epochMs = s => (s == null || s === '' ? null : plausibleMs(Number(s) * 1000));

function pbsGroupId(store, ns, group) {
  return `${store}:${ns || ''}:${group['backup-type']}/${group['backup-id']}`;
}

function pbsParseGroupId(id) {
  const m = /^([^:]+):([^:]*):(vm|ct|host)\/([^:/]+)$/.exec(String(id || ''));
  return m ? { store: m[1], ns: m[2], type: m[3], id: m[4] } : null;
}

function pbsDeriveStatus(group, newest, tasks, now = Date.now()) {
  const task = tasks?.[0];
  if (task && !task.endtime) return 'running';
  const lastMs = epochMs(group['last-backup']) || 0;
  const startMs = task ? epochMs(task.starttime) : null;
  if (startMs && startMs > lastMs && task.status !== 'OK' && !/^WARNINGS/.test(String(task.status || ''))) {
    return 'error';
  }
  if (newest?.verification?.state === 'failed') return 'error';
  if (!lastMs || now - lastMs > STALE_MS) return 'warning';
  return 'healthy';
}

/* Recent backups are newest first. The 30-day history is oldest first. */
function backrestLatest(summary) {
  const rb = summary?.recentBackups || {};
  const status = Array.isArray(rb.status) ? rb.status : [];
  const i = status.findIndex(s => s !== 'STATUS_INPROGRESS');
  if (i < 0) return null;
  const at = Number(rb.timestampMs?.[i]) + Number(rb.durationMs?.[i] || 0);
  return { status: status[i], finishedMs: plausibleMs(at) || 0 };
}

/* Task ids carry no namespace. Read it from the backup log line. */
function pbsLogNamespace(lines) {
  for (const line of lines) {
    const m = /(?:^|: )starting new backup on datastore '[^']*'.*: "([^"]+)"$/.exec(String(line ?? ''));
    if (!m) continue;
    const parts = m[1].split('/');
    const ns = [];
    while (parts[0] === 'ns' && parts.length > 1) ns.push(parts.splice(0, 2)[1]);
    return parts.length >= 2 ? ns.join('/') : null;
  }
  return null;
}

function backrestDeriveStatus(summary) {
  if (summary?.recentBackups?.status?.[0] === 'STATUS_INPROGRESS') return 'running';
  const history = summary?.historyLast30days;
  if (Array.isArray(history) && history.at(-1)?.overdue) return 'missed';
  const latest = backrestLatest(summary);
  if (!latest) return 'warning';
  if (latest.status === 'STATUS_ERROR') return 'error';
  if (latest.status === 'STATUS_SUCCESS') return 'healthy';
  return 'warning';
}

module.exports = {
  dupList,
  dupCore,
  dupId,
  dupName,
  dupMeta,
  dupSchedule,
  dupNormalizeBase,
  dupParseDate,
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
};
