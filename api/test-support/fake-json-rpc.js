/* A stand-in for ctx.jsonRpc. `methods` maps a method name to its result, or
   to a function of the params that returns or throws one. `events` maps an
   event name to the params of the notification core.subscribe sends for it. */

const denied = () =>
  Object.assign(new Error('JSON-RPC error -32001'), {
    kind: 'upstream',
    rpc: { code: -32001, data: { errname: 'EACCES' } },
  });

function fakeJsonRpc(methods = {}, events = {}) {
  const calls = [];
  const opened = [];
  const jsonRpc = async (url, opts, fn) => {
    opened.push({ url, opts });
    /** @type {Array<{ method: string, match: Function, resolve: Function, reject: Function }>} */
    const waiters = [];
    const session = {
      async call(method, params = []) {
        calls.push({ method, params });
        if (method === 'core.subscribe' && params[0] in events) {
          const p = events[params[0]];
          setImmediate(() => {
            for (const w of waiters.splice(0)) if (w.method === 'collection_update' && w.match(p)) w.resolve(p);
          });
          return 'sub-1';
        }
        if (!(method in methods))
          throw Object.assign(new Error('JSON-RPC error -32601'), { kind: 'upstream', rpc: { code: -32601 } });
        const m = methods[method];
        return typeof m === 'function' ? m(params) : m;
      },
      notification(method, match = () => true) {
        const p = new Promise((resolve, reject) => waiters.push({ method, match, resolve, reject }));
        p.catch(() => {});
        return p;
      },
    };
    try {
      return await fn(session);
    } finally {
      for (const w of waiters.splice(0)) w.reject(new Error('The connection closed.'));
    }
  };
  return { jsonRpc, calls, opened };
}

const refusedUpgrade = status =>
  Object.assign(new Error(`WebSocket upgrade refused (HTTP ${status})`), { kind: 'upstream', status });

module.exports = { fakeJsonRpc, denied, refusedUpgrade };
