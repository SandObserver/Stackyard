const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { jsonRpcChecked, jsonRpcUnchecked, SsrfBlockedError, _internals } = require('../src/proxy');
const { acceptFor, frameDecoder, encodeFrame, OP } = require('../src/websocket');

function serverFrame(opcode, payload, fin = true) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = body.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + len);
  out[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) out[1] = len;
  else if (len < 65536) {
    out[1] = 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  body.copy(out, head);
  return out;
}

function unmask(frame) {
  const len = frame[1] & 0x7f;
  const off = len === 126 ? 4 : len === 127 ? 10 : 2;
  const mask = frame.subarray(off, off + 4);
  const body = Buffer.from(frame.subarray(off + 4));
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return { opcode: frame[0] & 0x0f, masked: (frame[1] & 0x80) !== 0, body };
}

function wsServer(t, { onMessage = () => {}, accept, refuse, onControl } = {}) {
  return new Promise(resolve => {
    const s = http.createServer((_, res) => {
      res.writeHead(refuse || 404);
      res.end();
    });
    s.on('upgrade', (req, socket) => {
      if (refuse) {
        socket.end(`HTTP/1.1 ${refuse} No\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      const key = req.headers['sec-websocket-key'];
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept ?? acceptFor(key)}\r\n\r\n`,
      );
      let buf = Buffer.alloc(0);
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const len = buf[1] & 0x7f;
          const off = len === 126 ? 4 : len === 127 ? 10 : 2;
          const size = len === 126 ? buf.readUInt16BE(2) : len === 127 ? Number(buf.readBigUInt64BE(2)) : len;
          if (buf.length < off + 4 + size) return;
          const frame = unmask(buf.subarray(0, off + 4 + size));
          buf = buf.subarray(off + 4 + size);
          if (frame.opcode === OP.TEXT) onMessage(frame.body.toString(), socket);
          else if (onControl) onControl(frame, socket);
          else if (frame.opcode === OP.CLOSE) socket.end(serverFrame(OP.CLOSE, frame.body));
        }
      });
      socket.on('error', () => {});
    });
    s.listen(0, '127.0.0.1', () => {
      t.after(() => s.close());
      resolve(`http://127.0.0.1:${s.address().port}/api/current`);
    });
  });
}

const reply = (socket, obj) => socket.write(serverFrame(OP.TEXT, JSON.stringify(obj)));

const echoRpc = (text, socket) => {
  const msg = JSON.parse(text);
  if (msg.method === 'fail')
    reply(socket, { jsonrpc: '2.0', id: msg.id, error: { code: -32001, data: { errname: 'EACCES' } } });
  else reply(socket, { jsonrpc: '2.0', id: msg.id, result: { method: msg.method, params: msg.params } });
};

test('a call gets the result with its own id', async t => {
  const url = await wsServer(t, { onMessage: echoRpc });
  const out = await jsonRpcUnchecked(url, { timeout: 3000 }, async s => [await s.call('a.b', [1]), await s.call('c')]);
  assert.deepEqual(out, [
    { method: 'a.b', params: [1] },
    { method: 'c', params: [] },
  ]);
});

test('an error reply rejects with the service fields on rpc, not in the message', async t => {
  const url = await wsServer(t, { onMessage: echoRpc });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('fail')),
    e => e.rpc.code === -32001 && e.rpc.data.errname === 'EACCES' && !/EACCES/.test(e.message),
  );
});

test('notification waits for a matching one', async t => {
  const url = await wsServer(t, {
    onMessage: (text, socket) => {
      const msg = JSON.parse(text);
      reply(socket, { jsonrpc: '2.0', id: msg.id, result: 'sub-1' });
      reply(socket, { jsonrpc: '2.0', method: 'collection_update', params: { collection: 'other' } });
      reply(socket, { jsonrpc: '2.0', method: 'collection_update', params: { collection: 'wanted', n: 2 } });
    },
  });
  const params = await jsonRpcUnchecked(url, { timeout: 3000 }, async s => {
    const next = s.notification('collection_update', p => p?.collection === 'wanted');
    await s.call('core.subscribe', ['wanted']);
    return next;
  });
  assert.deepEqual(params, { collection: 'wanted', n: 2 });
});

test('a message split over fragments and a 64 KiB frame both arrive whole', async t => {
  const big = 'x'.repeat(70000);
  const url = await wsServer(t, {
    onMessage: (text, socket) => {
      const msg = JSON.parse(text);
      const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'big' ? big : 'joined' });
      if (msg.method === 'big') return socket.write(serverFrame(OP.TEXT, body));
      const cut = Math.floor(body.length / 2);
      socket.write(serverFrame(OP.TEXT, body.slice(0, cut), false));
      socket.write(serverFrame(OP.PING, 'hi'));
      socket.write(serverFrame(OP.CONTINUATION, body.slice(cut)));
    },
  });
  const out = await jsonRpcUnchecked(url, { timeout: 3000 }, async s => [await s.call('split'), await s.call('big')]);
  assert.equal(out[0], 'joined');
  assert.equal(out[1].length, big.length);
});

test('a ping is answered with a pong carrying the same payload', async t => {
  let pong = null;
  const url = await wsServer(t, {
    onMessage: (text, socket) => {
      socket.write(serverFrame(OP.PING, 'beat'));
      setTimeout(() => reply(socket, { jsonrpc: '2.0', id: JSON.parse(text).id, result: true }), 50);
    },
    onControl: (frame, socket) => {
      if (frame.opcode === OP.PONG) pong = frame;
      if (frame.opcode === OP.CLOSE) socket.end();
    },
  });
  await jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x'));
  assert.equal(pong.masked, true);
  assert.equal(pong.body.toString(), 'beat');
});

test('a message over the size limit ends the session', async t => {
  const url = await wsServer(t, { onMessage: (_, socket) => socket.write(serverFrame(OP.TEXT, 'y'.repeat(2048))) });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000, maxBytes: 1024 }, s => s.call('x')),
    e => e.responseTooLarge === true,
  );
});

test('empty continuation frames count toward the size limit', async t => {
  const url = await wsServer(t, {
    onMessage: (_, socket) => {
      socket.write(serverFrame(OP.TEXT, '', false));
      socket.write(Buffer.concat(Array.from({ length: 2000 }, () => serverFrame(OP.CONTINUATION, '', false))));
    },
  });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000, maxBytes: 1024 * 1024 }, s => s.call('x')),
    e => e.responseTooLarge === true,
  );
});

test('a masked frame from the server ends the session', async t => {
  const url = await wsServer(t, { onMessage: (_, socket) => socket.write(encodeFrame(OP.TEXT, Buffer.from('{}'))) });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e.kind === 'upstream' && /masked/.test(e.message),
  );
});

test('a reply that is not JSON ends the session', async t => {
  const url = await wsServer(t, { onMessage: (_, socket) => socket.write(serverFrame(OP.TEXT, '<html>')) });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e.kind === 'upstream',
  );
});

test('the service closing mid-call rejects the call', async t => {
  const url = await wsServer(t, { onMessage: (_, socket) => socket.destroy() });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e.kind === 'upstream' || e.code === 'ECONNRESET',
  );
});

test('a wait and a call left pending when the session fails reject without an unhandled rejection', async t => {
  const unhandled = [];
  const onUnhandled = e => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const url = await wsServer(t, {
    onMessage: (text, socket) => {
      if (JSON.parse(text).method === 'fail') echoRpc(text, socket);
    },
  });
  await assert.rejects(
    () =>
      jsonRpcUnchecked(url, { timeout: 3000 }, s => {
        s.notification('collection_update');
        s.call('never');
        return s.call('fail');
      }),
    e => e.rpc?.code === -32001,
  );
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(unhandled, []);
});

test('a service that sends pings but reads no pongs ends the session', async t => {
  const url = await wsServer(t, {
    onMessage: (_, socket) => {
      socket.pause();
      const ping = serverFrame(OP.PING, 'p'.repeat(125));
      socket.write(Buffer.concat(Array(40000).fill(ping)));
    },
  });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 5000 }, s => s.call('x')),
    e => e.kind === 'upstream' && /not reading/.test(e.message),
  );
});

test('a reserved control frame ends the session', async t => {
  const url = await wsServer(t, { onMessage: (_, socket) => socket.write(serverFrame(0x0b, '')) });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e.kind === 'upstream' && /unknown frame/.test(e.message),
  );
});

test('a refused upgrade reports its HTTP status', async t => {
  const url = await wsServer(t, { refuse: 404 });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e.status === 404 && e.kind === 'upstream',
  );
});

test('a wrong accept key fails the handshake', async t => {
  const url = await wsServer(t, { accept: crypto.randomBytes(20).toString('base64') });
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x')),
    e => /handshake/.test(e.message),
  );
});

test('a service that never replies times out within the budget', async t => {
  const url = await wsServer(t);
  const started = Date.now();
  await assert.rejects(
    () => jsonRpcUnchecked(url, { timeout: 300 }, s => s.call('x')),
    e => e.message === 'Timed out',
  );
  assert.ok(Date.now() - started < 2000);
});

test('the session is closed after the callback returns', async t => {
  let closed = false;
  const url = await wsServer(t, {
    onMessage: echoRpc,
    onControl: (frame, socket) => {
      if (frame.opcode === OP.CLOSE) {
        closed = true;
        socket.end(serverFrame(OP.CLOSE, frame.body));
      }
    },
  });
  await jsonRpcUnchecked(url, { timeout: 3000 }, s => s.call('x'));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(closed, true);
});

test('jsonRpcChecked blocks a private address before connecting', async t => {
  let upgraded = false;
  const url = await wsServer(t, { onMessage: () => (upgraded = true) });
  await assert.rejects(
    () => jsonRpcChecked(url, { timeout: 3000 }, s => s.call('x')),
    e => e instanceof SsrfBlockedError && e.status === 403,
  );
  assert.equal(upgraded, false);
});

test('only http and https addresses are opened', async () => {
  await assert.rejects(
    () => _internals.openWebSocket('ws://127.0.0.1:1/', {}),
    e => e.kind === 'blocked',
  );
});

test('the decoder waits for a frame split across chunks', () => {
  const seen = [];
  const decode = frameDecoder(1 << 20, (fin, opcode, payload) => seen.push([fin, opcode, payload.toString()]));
  const frame = serverFrame(OP.TEXT, 'z'.repeat(300));
  decode(frame.subarray(0, 1));
  decode(frame.subarray(1, 3));
  decode(frame.subarray(3, 200));
  assert.equal(seen.length, 0);
  decode(Buffer.concat([frame.subarray(200), serverFrame(OP.TEXT, 'b')]));
  assert.deepEqual(seen, [
    [true, OP.TEXT, 'z'.repeat(300)],
    [true, OP.TEXT, 'b'],
  ]);
});
