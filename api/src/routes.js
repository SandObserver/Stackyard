const { on, setPreflightHeaders } = require('./router');

require('./routes/auth');
require('./routes/config');
require('./routes/health');
require('./routes/badges');
require('./routes/system');
require('./routes/icons');
require('./routes/backup');

on('OPTIONS', '*', (_, res) => { setPreflightHeaders(res); res.writeHead(204); res.end(); });
