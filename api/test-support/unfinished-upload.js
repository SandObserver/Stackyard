const http = require('node:http');

/** Sends `sent` bytes of a multipart body declared as `declared` bytes and
    never finishes it. Resolves with the answer, which only comes if the route
    stops reading at its cap.
    @param {string} url @param {number} declared @param {number} sent
    @param {Record<string,string>} [headers] replace the multipart type
    @returns {Promise<{status:number, body:any}>} */
function unfinishedUpload(url, declared, sent, headers = {}) {
  const b = '----sytest';
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${b}`,
          'Content-Length': declared,
          Origin: u.origin,
          ...headers,
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          r.destroy();
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        });
      },
    );
    r.on('error', e => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? null : reject(e)));
    r.write(Buffer.alloc(sent));
  });
}

module.exports = { unfinishedUpload };
