const http = require('http');
const log = require('./log');

const _port = parseInt(process.env.PORT ?? '', 10);
if (process.env.PORT !== undefined && (Number.isNaN(_port) || _port < 1 || _port > 65535))
  throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);
const PORT = Number.isNaN(_port) ? 3000 : _port;

function fatal(kind) {
  return err => {
    try {
      log.error('fatal: ' + kind, { error: (err && err.message) || String(err), stack: err && err.stack });
    } catch {
      /* must not mask the original failure */
    }
    process.exit(1);
  };
}
process.on('uncaughtException', fatal('uncaughtException'));
process.on('unhandledRejection', fatal('unhandledRejection'));

require('./routes');
require('./widgets');
require('./widget-data');

const { dispatch } = require('./router');

/* Loopback only. Any other bind exposes the API around nginx, and without the
   client address nginx resolves rate limiting counts every caller as one. */
const HOST = '127.0.0.1';

http.createServer(dispatch).listen(PORT, HOST, () => {
  const { CONFIG_PATH, ICONS_PATH } = require('./config');
  const { getRegistry } = require('./widgets');
  const pkg = require('../package.json');
  const version = process.env.APP_VERSION || pkg.version;
  const widgets = Object.keys(getRegistry());
  const row = (label, value) => '  ' + label.padEnd(11) + value;
  const lines = [
    '',
    `  Stackyard ${version} · Node ${process.version}`,
    row('Dashboard', ':80 in the container'),
    row('Config', CONFIG_PATH),
    row('Icons', ICONS_PATH),
    row('Widgets', `${widgets.length} loaded`),
  ];
  try {
    const ll = require('./config').loadConfig().settings.logLevel;
    if (ll) log.setLevel(ll);
  } catch {}
  log.print(lines.join('\n'));

  log.info('server ready', {
    version,
    port: PORT,
    widgets: widgets.length,
    node: process.version,
  });

  if (process.env.TRUST_PROXY === 'true') {
    if (process.env.TRUSTED_PROXY)
      log.warn(
        'TRUST_PROXY is on, so forwarded headers are trusted; this is only safe behind a reverse proxy you control.',
      );
    else
      log.warn(
        'TRUST_PROXY without TRUSTED_PROXY trusts forwarded headers from any client and rate-limits all traffic as one; set TRUSTED_PROXY to the proxy address.',
      );
  }
});
