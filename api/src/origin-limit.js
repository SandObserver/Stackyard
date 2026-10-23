/* Wrap outside the deadline wrapper. Inside it, a queued request spends its
   timeout before it is sent. */
/** @param {(url: string, ...rest: any[]) => Promise<any>} fetch @param {number} max */
function limitPerOrigin(fetch, max) {
  /** @type {Map<string, { active: number, waiting: Array<() => void> }>} */
  const lanes = new Map();

  const originOf = url => {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  };

  return (url, ...rest) => {
    const key = originOf(url);
    let lane = lanes.get(key);
    if (!lane) {
      lane = { active: 0, waiting: [] };
      lanes.set(key, lane);
    }
    const release = () => {
      const next = lane.waiting.shift();
      if (next) return next();
      lane.active--;
      if (lane.active === 0) lanes.delete(key);
    };
    const run = () => {
      let p;
      try {
        p = Promise.resolve(fetch(url, ...rest));
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(release, release);
      return p;
    };
    if (lane.active < max) {
      lane.active++;
      return run();
    }
    return new Promise((resolve, reject) => {
      lane.waiting.push(() => run().then(resolve, reject));
    });
  };
}

module.exports = { limitPerOrigin };
