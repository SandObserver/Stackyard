const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const b = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'backup', 'backup-status.js'));

test('dupList extracts the backup array from various response shapes', () => {
  assert.deepEqual(b.dupList([1, 2]), [1, 2]);
  assert.deepEqual(b.dupList({ Items: [1] }), [1]);
  assert.deepEqual(b.dupList({ Data: [2] }), [2]);
  assert.deepEqual(b.dupList({ backups: [3] }), [3]);
  assert.deepEqual(b.dupList({ Backups: [4] }), [4]);
  assert.deepEqual(b.dupList({ other: 1 }), []);
  assert.deepEqual(b.dupList(null), []);
});

test('dupCore/dupId/dupName/dupMeta/dupSchedule read across casing variants', () => {
  assert.deepEqual(b.dupCore({ Backup: { ID: '1' } }), { ID: '1' });
  assert.deepEqual(b.dupCore({ backup: { id: '2' } }), { id: '2' });
  assert.deepEqual(b.dupCore(null), {});
  assert.equal(b.dupId({ Backup: { Id: 7 } }), '7');
  assert.equal(b.dupId({}), '');
  assert.equal(b.dupName({ Backup: { Name: 'Nightly' } }), 'Nightly');
  assert.equal(b.dupName({ Backup: { ID: '3' } }), 'Job 3');
  assert.equal(b.dupName({}), 'Backup');
  assert.deepEqual(b.dupMeta({ Backup: { Metadata: { a: 1 } } }), { a: 1 });
  assert.deepEqual(b.dupMeta({}), {});
  assert.equal(b.dupSchedule({ Schedule: 'daily' }), 'daily');
  assert.equal(b.dupSchedule({}), null);
});

test('dupNormalizeBase adds a scheme, strips a trailing slash, and rejects empty', () => {
  assert.equal(b.dupNormalizeBase('host:8200'), 'http://host:8200');
  assert.equal(b.dupNormalizeBase('https://host/'), 'https://host');
  assert.throws(() => b.dupNormalizeBase(''), /not configured/);
});

test('dupParseDate handles compact, ISO, empty and invalid dates', () => {
  assert.equal(b.dupParseDate('20240115T133000Z'), Date.UTC(2024, 0, 15, 13, 30, 0));
  assert.equal(b.dupParseDate('2024-01-15T13:30:00Z'), Date.UTC(2024, 0, 15, 13, 30, 0));
  assert.equal(b.dupParseDate(''), 0);
  assert.equal(b.dupParseDate('not a date'), 0);
});

test('dupDeriveStatus resolves running/error/missed/warning/healthy in priority order', () => {
  const job = { ID: '1', Metadata: { LastBackupFinished: '20200101T000000Z' } };
  assert.equal(b.dupDeriveStatus(job, { ActiveTask: { BackupID: '1' } }), 'running');
  assert.equal(b.dupDeriveStatus(job, { ActiveTask: { Item1: '1' } }), 'running');
  assert.equal(b.dupDeriveStatus(job, { ActiveTask: { BackupID: '1' }, HasError: true }), 'running'); // running wins
  assert.equal(b.dupDeriveStatus(job, { HasError: true }), 'error');
  assert.equal(b.dupDeriveStatus(job, { ProposedSchedule: [{ Item1: '1', Item2: '2020-06-01T00:00:00Z' }] }), 'missed');
  assert.equal(b.dupDeriveStatus(job, { HasWarning: true }), 'warning');
  assert.equal(b.dupDeriveStatus(job, {}), 'healthy');
});

test('dupDeriveStatus is not missed when the last backup is newer than the scheduled run', () => {
  const job = { ID: '1', Metadata: { LastBackupFinished: '2025-12-31T00:00:00Z' } };
  assert.equal(
    b.dupDeriveStatus(job, { ProposedSchedule: [{ Item1: '1', Item2: '2020-06-01T00:00:00Z' }] }),
    'healthy',
  );
});

test('kopiaDeriveStatus resolves its status chain', () => {
  assert.equal(b.kopiaDeriveStatus({ status: 'UPLOADING' }), 'running');
  assert.equal(b.kopiaDeriveStatus({ status: 'running' }), 'running');
  assert.equal(b.kopiaDeriveStatus({ status: 'PAUSED' }), 'warning');
  assert.equal(b.kopiaDeriveStatus({ status: 'IDLE' }), 'warning'); // no snapshot
  assert.equal(b.kopiaDeriveStatus({ status: 'IDLE', lastSnapshot: { stats: { errorCount: 2 } } }), 'error');
  const stale = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  assert.equal(b.kopiaDeriveStatus({ status: 'IDLE', lastSnapshot: { endTime: stale } }), 'warning');
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal(
    b.kopiaDeriveStatus({ status: 'IDLE', lastSnapshot: { endTime: fresh, stats: { errorCount: 0 } } }),
    'healthy',
  );
});

test('kopiaSourceId composes host, user and path', () => {
  assert.equal(b.kopiaSourceId({ host: 'nas', userName: 'root', path: '/data' }), 'nas@root:/data');
});

test('pbsGroupId round-trips through pbsParseGroupId, with and without a namespace', () => {
  const g = { 'backup-type': 'vm', 'backup-id': '100' };
  assert.equal(b.pbsGroupId('main', '', g), 'main::vm/100');
  assert.deepEqual(b.pbsParseGroupId('main::vm/100'), { store: 'main', ns: '', type: 'vm', id: '100' });
  assert.deepEqual(b.pbsParseGroupId(b.pbsGroupId('main', 'site-a/pve', g)), {
    store: 'main',
    ns: 'site-a/pve',
    type: 'vm',
    id: '100',
  });
  assert.equal(b.pbsParseGroupId('main:vm/100'), null);
  assert.equal(b.pbsParseGroupId(''), null);
});

test('pbsDeriveStatus resolves its status chain', () => {
  const now = 1_800_000_000_000;
  const fresh = { 'last-backup': now / 1000 - 3600 };
  const old = { 'last-backup': now / 1000 - 26 * 3600 };
  const ok = { verification: { state: 'ok' } };
  assert.equal(b.pbsDeriveStatus(fresh, ok, [], now), 'healthy');
  assert.equal(b.pbsDeriveStatus(fresh, ok, null, now), 'healthy');
  assert.equal(b.pbsDeriveStatus(fresh, ok, [{ starttime: now / 1000 - 60 }], now), 'running');
  const failedAfter = [{ starttime: now / 1000 - 60, endtime: now / 1000 - 30, status: 'connection error' }];
  assert.equal(b.pbsDeriveStatus(fresh, ok, failedAfter, now), 'error');
  const failedBefore = [{ starttime: now / 1000 - 7200, endtime: now / 1000 - 7100, status: 'connection error' }];
  assert.equal(b.pbsDeriveStatus(fresh, ok, failedBefore, now), 'healthy');
  const warned = [{ starttime: now / 1000 - 60, endtime: now / 1000 - 30, status: 'WARNINGS: 1' }];
  assert.equal(b.pbsDeriveStatus(fresh, ok, warned, now), 'healthy');
  assert.equal(b.pbsDeriveStatus(fresh, { verification: { state: 'failed' } }, [], now), 'error');
  assert.equal(b.pbsDeriveStatus(old, ok, [], now), 'warning');
  assert.equal(b.pbsDeriveStatus({}, null, null, now), 'warning');
});

test('backrestDeriveStatus reads the newest backup and today’s overdue flag', () => {
  const plan = (status, extra = {}) => ({
    recentBackups: {
      status,
      timestampMs: status.map((_, i) => String(2000 - i * 100)),
      durationMs: status.map(() => '50'),
    },
    ...extra,
  });
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_SUCCESS'])), 'healthy');
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_INPROGRESS', 'STATUS_ERROR'])), 'running');
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_ERROR', 'STATUS_SUCCESS'])), 'error');
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_WARNING'])), 'warning');
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_USER_CANCELLED'])), 'warning');
  assert.equal(b.backrestDeriveStatus(plan([])), 'warning');
  assert.equal(b.backrestDeriveStatus({}), 'warning');
  const overdue = { historyLast30days: [{ overdue: false }, { overdue: true }] };
  assert.equal(b.backrestDeriveStatus(plan(['STATUS_SUCCESS'], overdue)), 'missed');
});

test('backrestLatest skips a running backup and adds its duration', () => {
  const p = {
    recentBackups: {
      status: ['STATUS_INPROGRESS', 'STATUS_SUCCESS'],
      timestampMs: ['3000', '1000'],
      durationMs: ['10', '500'],
    },
  };
  assert.deepEqual(b.backrestLatest(p), { status: 'STATUS_SUCCESS', finishedMs: 1500 });
  assert.equal(b.backrestLatest({ recentBackups: { status: ['STATUS_INPROGRESS'] } }), null);
});
