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
  assert.equal(b.dupDeriveStatus(job, { ProposedSchedule: [{ Item1: '1', Item2: '2020-06-01T00:00:00Z' }] }), 'healthy');
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
  assert.equal(b.kopiaDeriveStatus({ status: 'IDLE', lastSnapshot: { endTime: fresh, stats: { errorCount: 0 } } }), 'healthy');
});

test('kopiaSourceId composes host, user and path', () => {
  assert.equal(b.kopiaSourceId({ host: 'nas', userName: 'root', path: '/data' }), 'nas@root:/data');
});
