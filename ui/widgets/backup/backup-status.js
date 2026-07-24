/* Pure status-derivation helpers for the backup widget, split out from the
   backup route so they can be unit-tested. All operate on already-parsed
   provider JSON with no I/O. The async login/token/fetch logic stays in the
   route. */

function dupList(d) {
  return Array.isArray(d)            ? d
    : Array.isArray(d?.Items)        ? d.Items
    : Array.isArray(d?.Data)         ? d.Data
    : Array.isArray(d?.backups)      ? d.backups
    : Array.isArray(d?.Backups)      ? d.Backups
    : [];
}
function dupCore(j) { return (j && (j.Backup || j.backup)) || j || {}; }
function dupId(j) { const b = dupCore(j); return String(b.ID ?? b.Id ?? b.id ?? ''); }
function dupName(j) { const b = dupCore(j); const id = dupId(j); return b.Name || b.name || (id ? `Job ${id}` : 'Backup'); }
function dupMeta(j) { const b = dupCore(j); return b.Metadata || b.metadata || {}; }
function dupSchedule(j) { return j.Schedule || j.schedule || dupCore(j).Schedule || null; }

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
  const id       = dupId(job);
  const meta     = dupMeta(job);
  const tasks    = serverState?.ActiveTask;
  const proposed = serverState?.ProposedSchedule || [];

  const isRunning = tasks != null && String(tasks.BackupID || tasks.Item1 || '') === id;
  if (isRunning) return 'running';

  if (serverState?.HasError) return 'error';

  const nextEntry = proposed.find(p => String(p.Item1) === id);
  if (nextEntry && nextEntry.Item2) {
    const nextRun      = new Date(nextEntry.Item2).getTime();
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
  if (endTime && Date.now() - endTime > 25 * 60 * 60 * 1000) return 'warning';

  return 'healthy';
}

function kopiaSourceId(source) {
  return `${source.host}@${source.userName}:${source.path}`;
}

module.exports = {
  dupList, dupCore, dupId, dupName, dupMeta, dupSchedule,
  dupNormalizeBase, dupParseDate, dupDeriveStatus,
  kopiaDeriveStatus, kopiaSourceId,
};
