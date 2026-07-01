const http = require('http');
const log  = require('./log');

const _port = parseInt(process.env.PORT, 10);
if (process.env.PORT !== undefined && (isNaN(_port) || _port < 1 || _port > 65535))
  throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);
const PORT = isNaN(_port) ? 3000 : _port;

require('./routes');
require('./widgets');
require('./widget-data');

const { dispatch } = require('./router');

http.createServer(dispatch).listen(PORT, () => {
  const { CONFIG_PATH, ICONS_PATH } = require('./config');
  const { getRegistry } = require('./widgets');
  const pkg = require('../package.json');
  const version = process.env.APP_VERSION || pkg.version;
  const widgets = Object.keys(getRegistry());
  const W = 47;
  const bar = c => c + '─'.repeat(W) + (c === '┌' ? '┐' : '┘');
  const mid = t => '│ ' + t.padEnd(W - 2) + ' │';
  const wlist = widgets.slice(0, 4).join(', ') + (widgets.length > 4 ? ', ...' : '');
  const lines = [
    '',
    '  ' + bar('┌'),
    '  ' + mid('STACKYARD'),
    '  ' + mid('self-hosted dashboard · v' + version),
    '  ' + bar('└'),
    `  ➜  Web UI:    http://localhost:${PORT}`,
    `  ➜  Config:    ${CONFIG_PATH}`,
    `  ➜  Icons:     ${ICONS_PATH}`,
    `  ➜  Widgets:   ${widgets.length} loaded (${wlist})`,
    `  ➜  Node:      ${process.version}`,
    '',
  ];
  console.log(lines.join('\n'));
});
