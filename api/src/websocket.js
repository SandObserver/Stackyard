const crypto = require('crypto');

/* Open connections only through proxy.js. It holds the outbound guard. */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MESSAGE_LIMIT = 4 * 1024 * 1024;
const WRITE_BACKLOG_LIMIT = 64 * 1024;

const OP = { CONTINUATION: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 };

const protocolError = message => Object.assign(new Error(message), { kind: 'upstream' });
const tooLarge = () => Object.assign(protocolError('Response too large'), { responseTooLarge: true });

const handshakeKey = () => crypto.randomBytes(16).toString('base64');

const acceptFor = key =>
  crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');

/** @param {number} opcode @param {Buffer} payload */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + 4 + len);
  out[0] = 0x80 | opcode;
  if (len < 126) out[1] = 0x80 | len;
  else if (len < 65536) {
    out[1] = 0x80 | 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 0x80 | 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = crypto.randomBytes(4);
  mask.copy(out, head);
  for (let i = 0; i < len; i++) out[head + 4 + i] = payload[i] ^ mask[i & 3];
  return out;
}

/** @param {number} limit
   @param {(fin: boolean, opcode: number, payload: Buffer) => void} onFrame */
function frameDecoder(limit, onFrame) {
  /** @type {Buffer[]} */
  let chunks = [];
  let size = 0;
  let need = 2;
  return (/** @type {Buffer} */ chunk) => {
    chunks.push(chunk);
    size += chunk.length;
    if (size < need) return;
    let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size);
    for (;;) {
      need = 2;
      if (buf.length < 2) break;
      if (buf[1] & 0x80) throw protocolError('The server sent a masked frame.');
      if (buf[0] & 0x70) throw protocolError('The server sent a frame with reserved bits set.');
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        need = 4;
        if (buf.length < need) break;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        need = 10;
        if (buf.length < need) break;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(limit)) throw tooLarge();
        len = Number(big);
        off = 10;
      }
      if (len > limit) throw tooLarge();
      need = off + len;
      if (buf.length < need) break;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const payload = buf.subarray(off, need);
      buf = buf.subarray(need);
      need = 2;
      onFrame(fin, opcode, payload);
    }
    chunks = buf.length ? [buf] : [];
    size = buf.length;
  };
}

/** @param {import('net').Socket} socket @param {Buffer} head
   @param {{ maxBytes?: number }} [opts] */
function wrapSocket(socket, head, opts = {}) {
  const limit = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : MESSAGE_LIMIT;
  /** @type {string[]} */
  const backlog = [];
  /** @type {((text: string) => void)|null} */
  let onMessage = null;
  /** @type {((err: Error|null) => void)|null} */
  let onClose = null;
  /** @type {Error|null|undefined} */
  let closedWith;
  let closed = false;
  let closing = false;
  /** @type {Buffer[]} */
  let parts = [];
  let partsSize = 0;
  let inMessage = false;

  const finish = (/** @type {Error|null} */ err) => {
    if (closed) return;
    closed = true;
    closedWith = err;
    socket.destroy();
    if (onClose) onClose(err);
  };

  const write = (/** @type {number} */ opcode, /** @type {Buffer} */ payload) => {
    if (closed || !socket.writable) return;
    socket.write(encodeFrame(opcode, payload));
    if (socket.writableLength > WRITE_BACKLOG_LIMIT)
      finish(protocolError('The service is not reading what it is sent.'));
  };

  const decode = frameDecoder(limit, (fin, opcode, payload) => {
    if (opcode >= OP.CLOSE) {
      if (!fin || payload.length > 125) throw protocolError('The server sent a bad control frame.');
      if (opcode === OP.PING) write(OP.PONG, payload);
      else if (opcode === OP.CLOSE) {
        if (!closing) write(OP.CLOSE, payload.subarray(0, 2));
        finish(closing ? null : protocolError('The service closed the connection.'));
      } else if (opcode !== OP.PONG) throw protocolError('The server sent an unknown frame type.');
      return;
    }
    if (opcode === OP.CONTINUATION) {
      if (!inMessage) throw protocolError('The server sent a continuation with no message.');
    } else if (opcode === OP.TEXT || opcode === OP.BINARY) {
      if (inMessage) throw protocolError('The server started a message inside another.');
      inMessage = true;
    } else throw protocolError('The server sent an unknown frame type.');
    partsSize += payload.length;
    if (partsSize > limit) throw tooLarge();
    parts.push(payload);
    if (!fin) return;
    const text = Buffer.concat(parts, partsSize).toString('utf8');
    parts = [];
    partsSize = 0;
    inMessage = false;
    if (onMessage) onMessage(text);
    else backlog.push(text);
  });

  const feed = (/** @type {Buffer} */ chunk) => {
    if (closed) return;
    try {
      decode(chunk);
    } catch (e) {
      finish(/** @type {Error} */ (e));
    }
  };

  socket.on('data', feed);
  socket.on('error', e => finish(e));
  socket.on('close', () => finish(closing ? null : protocolError('The service closed the connection.')));

  const conn = {
    /** @param {string} text */
    send(text) {
      write(OP.TEXT, Buffer.from(text, 'utf8'));
    },
    /** @param {(text: string) => void} fn */
    onMessage(fn) {
      onMessage = fn;
      for (const text of backlog.splice(0)) fn(text);
    },
    /** @param {(err: Error|null) => void} fn */
    onClose(fn) {
      onClose = fn;
      if (closed) fn(closedWith ?? null);
    },
    close() {
      if (closed) return;
      closing = true;
      write(OP.CLOSE, Buffer.from([0x03, 0xe8]));
      socket.end();
      /* A server that never answers the close must not hold the socket. */
      setTimeout(() => finish(null), 1000).unref();
    },
    /** @param {Error} err */
    destroy(err) {
      finish(err);
    },
  };
  if (head && head.length) feed(head);
  return conn;
}

/* Never put the service's text in the message. Logs print it. */
function rpcError(error) {
  const code = Number.isInteger(error?.code) ? error.code : null;
  return Object.assign(new Error(`JSON-RPC error ${code ?? 'without a code'}`), {
    kind: 'upstream',
    rpc: { code, message: error?.message, data: error?.data },
  });
}

/* Keep the catch. Every pending promise rejects when the connection ends. An
   unhandled rejection exits the process. */
const handled = (/** @type {Promise<any>} */ p) => {
  p.catch(() => {});
  return p;
};

/** @param {ReturnType<typeof wrapSocket>} conn */
function rpcSession(conn) {
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const pending = new Map();
  /** @type {Set<{ method: string, match: (p: any) => boolean, resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const waiters = new Set();
  /** @type {Error|null} */
  let ended = null;
  /** @type {(e: Error) => void} */
  let endWith = () => {};
  /** @type {Promise<never>} */
  const failed = new Promise((_, reject) => {
    endWith = reject;
  });
  failed.catch(() => {});

  conn.onMessage(text => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return conn.destroy(protocolError('The service sent a message that is not JSON.'));
    }
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(rpcError(msg.error));
      else p?.resolve(msg.result);
      return;
    }
    if (typeof msg.method !== 'string') return;
    for (const w of [...waiters]) {
      if (w.method !== msg.method || !w.match(msg.params)) continue;
      waiters.delete(w);
      w.resolve(msg.params);
    }
  });

  conn.onClose(err => {
    ended = err || protocolError('The connection closed.');
    for (const p of pending.values()) p.reject(ended);
    pending.clear();
    for (const w of waiters) w.reject(ended);
    waiters.clear();
    endWith(ended);
  });

  return {
    /** @param {string} method @param {unknown[]} [params] @returns {Promise<any>} */
    call(method, params = []) {
      if (ended) return Promise.reject(ended);
      const id = nextId++;
      return handled(
        new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          conn.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        }),
      );
    },
    /** @param {string} method @param {(params: any) => boolean} [match] @returns {Promise<any>} */
    notification(method, match = () => true) {
      if (ended) return Promise.reject(ended);
      return handled(
        new Promise((resolve, reject) => {
          waiters.add({ method, match, resolve, reject });
        }),
      );
    },
    /* Rejects when the connection ends. Never resolves. */
    failed,
  };
}

module.exports = {
  handshakeKey,
  acceptFor,
  encodeFrame,
  frameDecoder,
  wrapSocket,
  rpcSession,
  MESSAGE_LIMIT,
  OP,
};
