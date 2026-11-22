const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
const root = tmpDir('inline-script');
const widgetsDir = path.join(root, 'widgets');

const HEAD = '<!doctype html><html><head><script src="/js/widget-theme.js"></script></head><body>';
function writeWidget(name, pages, extra = {}) {
  const dir = path.join(widgetsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'widget.json'), JSON.stringify({ name, label: name, sizes: ['small'], ...extra }));
  for (const [file, body] of Object.entries(pages))
    fs.writeFileSync(path.join(dir, file), `${HEAD}${body}</body></html>`);
}

writeWidget('clean', { 'index.html': '<div id="r"></div><script type="module" src="widget.js?v=1"></script>' });
writeWidget('inline', {
  'index.html': '<script type="module">\nimport { poll } from "/js/widget-toolbox.js";\n</script>',
});
writeWidget('handler', { 'index.html': '<button onclick="go()">Go</button>' });
writeWidget('scripturl', { 'index.html': '<a href="javascript:go()">Go</a>' });
writeWidget('data', {
  'index.html': '<script type="application/json" id="d">{"a":1}</script><script src="widget.js"></script>',
});
writeWidget(
  'views',
  { 'one.html': '<script src="one.js"></script>', 'two.html': '<script>go()</script>' },
  {
    views: { one: { src: 'one.html' }, two: { src: 'two.html' }, again: { src: 'two.html' } },
    fields: [
      {
        key: 'view',
        type: 'select',
        label: 'View',
        options: [
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
          { value: 'again', label: 'Again' },
        ],
      },
    ],
    viewField: 'view',
  },
);
writeWidget('outside', { 'index.html': '<p>x</p>' }, { views: { a: { src: '../inline/index.html' } } });

process.env.WIDGETS_PATH = widgetsDir;
process.env.CONFIG_PATH = path.join(root, 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const widgets = require('../src/widget-registry');

const lines = [];
const write = process.stdout.write;
process.stdout.write = (chunk, ...rest) => {
  if (/^\d{4}-\d\d-\d\dT\S+ WRN msg=/.test(String(chunk))) lines.push(String(chunk));
  return write.call(process.stdout, chunk, ...rest);
};
let registry;
try {
  registry = widgets.loadRegistry();
} finally {
  process.stdout.write = write;
}
const notices = lines.filter(l => l.includes('inline script found'));
const noticeFor = name => notices.filter(l => l.includes(` widget=${name} `));

test('a widget with inline script still loads', () => {
  for (const name of ['inline', 'handler', 'scripturl', 'views']) assert.ok(registry[name], name);
});

test('one notice per widget names the folder and each page with inline script', () => {
  assert.equal(noticeFor('inline').length, 1);
  assert.match(noticeFor('inline')[0], /files=index\.html /);
  assert.equal(noticeFor('views').length, 1);
  assert.match(noticeFor('views')[0], /files=two\.html /, 'a page used by two views is named once');
  assert.match(noticeFor('handler')[0], /files=index\.html/);
  assert.match(noticeFor('scripturl')[0], /files=index\.html/);
});

test('the notice says what changes and where to read how to fix it', () => {
  const [line] = noticeFor('inline');
  assert.match(line, /msg="widget registry: inline script found, the next release blocks it"/);
  assert.equal(/ see (\S+?)"/.exec(line)?.[1], 'https://stackyard.sandobserver.com/docs/create-a-widget/', line);
});

test('a page that loads its script from a file, or holds only data, raises no notice', () => {
  assert.deepEqual(noticeFor('clean'), []);
  assert.deepEqual(noticeFor('data'), []);
  assert.deepEqual(noticeFor('outside'), [], 'a page outside the widget folder is not read');
  assert.equal(notices.length, 4);
});

test('the scan tells inline script from a loaded file', () => {
  const { hasInlineScript } = widgets;
  assert.equal(hasInlineScript('<script src="a.js"></script>'), false);
  assert.equal(hasInlineScript('<script\n  type="module"\n  src="a.js"></script>'), false);
  assert.equal(hasInlineScript('<script type="importmap">{}</script>'), true);
  assert.equal(hasInlineScript('<SCRIPT>x()</SCRIPT>'), true);
  assert.equal(hasInlineScript('<script type="text/template"><b></b></script>'), false);
  assert.equal(hasInlineScript('<img src="x.png" onerror="x()">'), true);
  assert.equal(hasInlineScript('<p>Turn the oven on = done</p>'), false);
  assert.equal(hasInlineScript('<form action="javascript:void 0">'), true);
});

test('the scan knows every script type a browser runs, and handlers after a slash or quote', () => {
  const { hasInlineScript } = widgets;
  for (const type of [
    'text/ecmascript',
    'application/x-javascript',
    'application/ecmascript',
    'application/x-ecmascript',
    'text/javascript1.5',
    'text/jscript',
    'text/livescript',
    'text/x-ecmascript',
    'text/x-javascript',
    'TEXT/JavaScript',
    ' text/javascript ',
    'text/javascript; charset=utf-8',
    'MODULE',
  ]) {
    assert.equal(hasInlineScript(`<script type="${type}">x()</script>`), true, type);
    assert.equal(hasInlineScript(`<script type='${type}'>x()</script>`), true, type);
  }
  assert.equal(hasInlineScript('<script type=text/ecmascript>x()</script>'), true);
  assert.equal(hasInlineScript('<script language="javascript">x()</script>'), true);
  assert.equal(hasInlineScript('<script language="vbscript">x()</script>'), false);
  assert.equal(hasInlineScript('<script type="text/javascript2">x()</script>'), false);
  assert.equal(hasInlineScript('<svg/onload=x()>'), true);
  assert.equal(hasInlineScript('<img src="x.png"onerror="x()">'), true);
  assert.equal(hasInlineScript("<img src='x.png'onerror=x()>"), true);
  assert.equal(hasInlineScript('<img\tonerror=x()>'), true);
});

test('no bundled widget page has inline script', () => {
  const bundled = path.join(__dirname, '../../ui/widgets');
  const pages = [];
  for (const name of fs.readdirSync(bundled)) {
    const dir = path.join(bundled, name);
    if (!fs.existsSync(path.join(dir, 'widget.json'))) continue;
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.html'))) pages.push(path.join(dir, f));
  }
  assert.ok(pages.length >= 15, `found ${pages.length} pages`);
  for (const page of pages) assert.equal(widgets.hasInlineScript(fs.readFileSync(page, 'utf8')), false, page);
  const template = path.join(__dirname, '../../docs/widget-template/index.html');
  assert.equal(widgets.hasInlineScript(fs.readFileSync(template, 'utf8')), false, 'the widget template');
});
