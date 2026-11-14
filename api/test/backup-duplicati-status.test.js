const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('backup-dup'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { dataFnContext } = require('../src/widget-data');
const { fetchUnchecked } = require('../src/proxy');
const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'backup', 'data.js'));

/* Shapes from Duplicati: ServerStatusDto and BackupListService for the replies,
   Runner.cs and SerializeDateTime for the metadata dates. */
const backup = (id, metadata) => ({
  Backup: { ID: id, Name: `Job ${id}`, OperationType: 'Backup', Metadata: metadata },
  Schedule: null,
});

function serverState(over) {
  return {
    ActiveTask: null,
    ProgramState: 'Running',
    SchedulerQueueIds: [],
    ProposedSchedule: [],
    HasWarning: false,
    HasError: false,
    SuggestedStatusIcon: 'Ready',
    EstimatedPauseEnd: '0001-01-01T00:00:00',
    LastEventID: 1,
    LastDataUpdateID: 1,
    LastNotificationUpdateID: 1,
    UpdatedVersion: null,
    UpdaterState: 'Waiting',
    UpdateDownloadLink: null,
    UpdateDownloadProgress: 0,
    ...over,
  };
}

async function duplicati(t, state, backups) {
  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    req.resume();
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/v1/auth/login') {
        return send(200, { AccessToken: 'tok', RefreshNonce: 'nonce' });
      }
      if (req.headers.authorization !== 'Bearer tok') return send(401, {});
      if (req.url === '/api/v1/serverstate') return send(200, state);
      if (req.url === '/api/v1/backups') return send(200, backups);
      send(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function statuses(dupUrl, ids) {
  const config = { slots: ids.map(jobId => ({ provider: 'duplicati', dupUrl, dupPass: 'pw', jobId })) };
  const out = await dataFn(dataFnContext(config, 'slots', new URLSearchParams(), fetchUnchecked));
  return out.map(s => s.status);
}

test('a Duplicati card shows running only for the job the active task runs', async t => {
  const done = { LastBackupFinished: '20261101T020000Z' };
  const url = await duplicati(t, serverState({ ActiveTask: { Item1: 2, Item2: '5' } }), [
    backup('2', done),
    backup('5', done),
  ]);
  assert.deepEqual(await statuses(url, ['2', '5']), ['healthy', 'running']);
});

test('one failed Duplicati job marks only its own card as an error', async t => {
  const url = await duplicati(t, serverState({ HasError: true, HasWarning: true, SuggestedStatusIcon: 'ReadyError' }), [
    backup('1', { LastBackupFinished: '20261101T020000Z', LastErrorDate: '20261102T020000Z' }),
    backup('2', { LastBackupFinished: '20261102T030000Z' }),
    backup('3', { LastBackupFinished: '20261103T020000Z', LastErrorDate: '20261102T020000Z' }),
  ]);
  assert.deepEqual(await statuses(url, ['1', '2', '3']), ['error', 'healthy', 'healthy']);
});

test('a Duplicati card shows the same last run its status is read from', async t => {
  const url = await duplicati(t, serverState(), [
    {
      Backup: {
        ID: '1',
        Name: 'Mirror',
        OperationType: 'Sync',
        Metadata: {
          LastBackupFinished: '20261101T020000Z',
          LastSyncStarted: '20261103T015500Z',
          LastSyncFinished: '20261103T020000Z',
          LastErrorDate: '20261102T020000Z',
        },
      },
      Schedule: null,
    },
    backup('2', { LastBackupDate: '20261104T020000Z' }),
  ]);
  const config = { slots: ['1', '2'].map(jobId => ({ provider: 'duplicati', dupUrl: url, dupPass: 'pw', jobId })) };
  const out = await dataFn(dataFnContext(config, 'slots', new URLSearchParams(), fetchUnchecked));
  assert.deepEqual(
    out.map(s => [s.status, s.lastFinished]),
    [
      ['healthy', '2026-11-03T02:00:00.000Z'],
      ['healthy', '2026-11-04T02:00:00.000Z'],
    ],
  );
});
