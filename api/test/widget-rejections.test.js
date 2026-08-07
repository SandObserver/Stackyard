/* P5-13: a refused widget was invisible outside the container log.

   loadRegistry skips a manifest it cannot parse or cannot validate, logs a
   warning, and moves on. Nothing else knew. Admin could tell that a configured
   widget's definition was missing, but not why, so its message ended by telling
   the operator to go and read the server log — the last place a self-hoster
   looks and the first place the UI cannot reach.

   It matters more since the validator was tightened: a widget with one typo in
   its showIf or viewField now does not load at all, where before it loaded and
   misbehaved quietly.

   The reasons travel with the registry now. They are kept beside it rather than
   in it, so a lookup by widgetType can never resolve to a rejected widget. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-reject-'));
const widgetsDir = path.join(root, 'widgets');

function writeWidget(name, manifest) {
  const dir = path.join(widgetsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'widget.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}

writeWidget('fine', { name: 'fine', label: 'Fine', sizes: ['small'] });
writeWidget('badjson', '{ this is not json');
writeWidget('badmanifest', { name: 'badmanifest', label: 'B', sizes: ['small'],
  viewField: 'veiw', views: { a: { src: 'a.html' } } });
writeWidget('wrongname', { name: 'somethingelse', label: 'W', sizes: ['small'] });
/* A directory with no widget.json is not a folder-style widget and is not a
   rejection: the legacy flat-file widgets sit beside these. */
fs.mkdirSync(path.join(widgetsDir, 'notawidget'), { recursive: true });

process.env.WIDGETS_PATH = widgetsDir;
process.env.CONFIG_PATH = path.join(root, 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const widgets = require('../src/widgets');

widgets.loadRegistry();
const rejected = widgets.getRejected();
const byName = Object.fromEntries(rejected.map(r => [r.name, r.errors]));

test('a valid widget still registers', () => {
  assert.ok(widgets.getRegistry().fine, 'the good widget should load');
});

test('every refused widget is reported', () => {
  assert.deepEqual(Object.keys(byName).sort(), ['badjson', 'badmanifest', 'wrongname']);
});

/* A rejected widget is not a widget. Keeping the two apart is what stops a
   lookup by widgetType finding one. */
test('a refused widget is not in the registry', () => {
  const reg = widgets.getRegistry();
  for (const name of Object.keys(byName)) {
    assert.equal(reg[name], undefined, `${name} must not be registered`);
  }
});

test('a directory with no manifest is skipped, not rejected', () => {
  assert.ok(!('notawidget' in byName), 'a non-widget folder is not a failure');
});

/* The reason has to say what to change. */
test('a malformed manifest reports the rule it broke', () => {
  assert.match(byName.badmanifest.join(' '), /viewField.*veiw.*not a declared field/);
});

test('a name that does not match its folder is reported', () => {
  assert.match(byName.wrongname.join(' '), /must match the folder name/);
});

test('unreadable JSON is reported as such', () => {
  assert.equal(byName.badjson.length, 1);
  assert.match(byName.badjson[0], /not valid JSON/);
});

/* The parser names the syntax problem and an offset, never file content, so it
   is safe to put in front of an operator. */
test('the JSON error does not quote the file back', () => {
  assert.ok(!byName.badjson[0].includes('this is not json'),
    `the message must not carry file content: ${byName.badjson[0]}`);
});

test('every reported error is a non-empty string', () => {
  for (const [name, errs] of Object.entries(byName)) {
    assert.ok(Array.isArray(errs) && errs.length, `${name} has no reasons`);
    for (const e of errs) assert.ok(typeof e === 'string' && e.trim(), `${name} has a blank reason`);
  }
});

/* Reloading must not accumulate, or a fixed widget would stay listed. */
test('reloading rebuilds the list rather than appending to it', () => {
  const before = widgets.getRejected().length;
  widgets.loadRegistry();
  assert.equal(widgets.getRejected().length, before);
});

test('fixing a manifest clears its entry', () => {
  writeWidget('badmanifest', { name: 'badmanifest', label: 'B', sizes: ['small'] });
  widgets.loadRegistry();
  const names = widgets.getRejected().map(r => r.name);
  assert.ok(!names.includes('badmanifest'), 'a repaired widget must stop being reported');
  assert.ok(widgets.getRegistry().badmanifest, 'and must now be registered');
});

/* Through the route, since the value of recording a reason is that Admin can
   read it. The registry could hold them and the endpoint still not send them. */
test('GET /api/widgets carries the rejections', async () => {
  const http = require('node:http');
  require('../src/routes');
  const { dispatch } = require('../src/router');

  /* Put a broken widget back so there is something to report. */
  writeWidget('badmanifest', { name: 'badmanifest', label: 'B', sizes: ['small'],
    viewField: 'veiw', views: { a: { src: 'a.html' } } });
  widgets.loadRegistry();

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const body = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/api/widgets' }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));

  assert.ok(Array.isArray(body.widgets), 'the widget list is still there');
  assert.ok(Array.isArray(body.rejected), 'rejections must travel with it');
  const bad = body.rejected.find(r => r.name === 'badmanifest');
  assert.ok(bad, `badmanifest should be reported: ${JSON.stringify(body.rejected)}`);
  assert.match(bad.errors.join(' '), /not a declared field/);

  /* Additive: a frontend that does not know about the field is unaffected. */
  assert.ok(!body.widgets.some(w => w.name === 'badmanifest'),
    'a rejected widget must not appear in the widget list');
});
