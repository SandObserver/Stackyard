const http = require('http');
const log  = require('./log');

const _port = parseInt(process.env.PORT, 10);
if (process.env.PORT !== undefined && (isNaN(_port) || _port < 1 || _port > 65535))
  throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);
const PORT = isNaN(_port) ? 3000 : _port;

require('./routes');

const { dispatch } = require('./router');

http.createServer(dispatch).listen(PORT, () => {
  const { CONFIG_PATH, ICONS_PATH } = require('./config');
  log.info('started', { port:PORT, config:CONFIG_PATH, icons:ICONS_PATH, node:process.version });
});
