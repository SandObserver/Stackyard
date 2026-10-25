const MAX_ITEMS = 12;
const FINISHED_WINDOW_MS = 48 * 3600 * 1000;
const MAX_FINISHED = 100;
const MIB = 1024 * 1024;

/** A finite number, or null. Some clients send numbers as text. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const nonNeg = v => {
  const n = num(v);
  return n != null && n >= 0 ? n : 0;
};
const str = v => (typeof v === 'string' ? v : '');
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []);
/* NZBGet splits 64-bit sizes into two 32-bit halves. */
const hiLo = (hi, lo) => nonNeg(hi) * 2 ** 32 + nonNeg(lo);

/** One download. `eta` is seconds, or null when the client has no estimate.
    `state` is run, stall or error; `reason` names a stall or error. */
function makeItem({ name, size, left, speed, eta, state = 'run', reason = '' }) {
  const total = nonNeg(size);
  const remaining = Math.min(nonNeg(left), total);
  const progress = total > 0 ? (total - remaining) / total : 0;
  const e = num(eta);
  return {
    name: clean(name),
    size: Math.round(total),
    progress: Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 1000,
    speed: Math.round(nonNeg(speed)),
    eta: state === 'run' && e != null && e >= 0 ? Math.round(e) : null,
    state,
    ...(reason ? { reason } : {}),
  };
}

/* Direction controls can make a name read as something else: "evil\u202Eexe.txt". */
const DISGUISE = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
const control = n => n < 0x20 || (n >= 0x7f && n <= 0x9f);
const clean = name =>
  [...String(name || '')].filter(c => !control(c.codePointAt(0)) && !DISGUISE.has(c.codePointAt(0))).join('');

const RANK = { run: 0, stall: 1, error: 2 };

/** What the heading says, over every download, not only the ones shown.
    `time`: `seconds` until the last moving one finishes, or null without an
    estimate from each. `stall` and `error`: nothing moves; the first problem. */
function summarize(items) {
  const moving = items.filter(i => i.state === 'run');
  const stalled = items.filter(i => i.state === 'stall').length;
  const failed = items.filter(i => i.state === 'error').length;
  if (moving.length) {
    const etas = moving.map(i => i.eta);
    const seconds = etas.every(e => typeof e === 'number') ? Math.max(...etas) : null;
    const speed = moving.reduce((t, i) => t + i.speed, 0);
    return { kind: 'time', seconds, moving: moving.length, speed, stalled, failed };
  }
  const problem = items.find(i => i.state === 'error') || items.find(i => i.state === 'stall');
  if (problem) return { kind: problem.state, reason: problem.reason || '' };
  return { kind: 'done' };
}

/** Closest to done first, then stalled, then failed; at most MAX_ITEMS. */
function arrange(items) {
  const sorted = items
    .filter(i => i.name)
    .sort((a, b) => {
      if (a.state !== b.state) return RANK[a.state] - RANK[b.state];
      if (a.eta == null || b.eta == null) return (a.eta == null) - (b.eta == null) || b.progress - a.progress;
      return a.eta - b.eta;
    });
  return { items: sorted.slice(0, MAX_ITEMS), summary: summarize(sorted) };
}

/** Completion times in epoch ms within the window, newest first. Which ones
    count as today is decided in the browser, in the reader's time zone. */
function finishedTimes(seconds, now = Date.now()) {
  return seconds
    .map(s => num(s))
    .filter(s => s != null && s > 0)
    .map(s => s * 1000)
    .filter(ms => ms <= now + 60000 && now - ms <= FINISHED_WINDOW_MS)
    .sort((a, b) => b - a)
    .slice(0, MAX_FINISHED);
}

const QBIT_RUN = new Set(['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'allocating']);
const QBIT_STALL = new Set(['stalledDL']);
const QBIT_ERROR = { error: 'error', missingFiles: 'missingFiles' };
const QBIT_NO_ETA = 8640000;

function qbitItems(torrents) {
  const out = [];
  for (const t of list(torrents)) {
    const state = str(t.state);
    const base = {
      name: str(t.name),
      size: t.size ?? t.total_size,
      left: t.amount_left,
      speed: t.dlspeed,
      eta: num(t.eta) === QBIT_NO_ETA ? null : t.eta,
    };
    if (QBIT_RUN.has(state)) out.push(makeItem(base));
    else if (QBIT_STALL.has(state)) out.push(makeItem({ ...base, state: 'stall', reason: 'noPeers' }));
    else if (Object.hasOwn(QBIT_ERROR, state))
      out.push(makeItem({ ...base, state: 'error', reason: QBIT_ERROR[state] }));
  }
  return out;
}

const qbitFinished = torrents => list(torrents).map(t => t.completion_on);

/* Transmission error 3 is a local error. Errors 1 and 2 are tracker messages on
   a download that still runs. */
const tField = (t, snake, camel) => (t[snake] !== undefined ? t[snake] : t[camel]);

function transmissionItems(torrents) {
  const out = [];
  for (const t of list(torrents)) {
    const base = {
      name: str(t.name),
      size: tField(t, 'size_when_done', 'sizeWhenDone'),
      left: tField(t, 'left_until_done', 'leftUntilDone'),
      speed: tField(t, 'rate_download', 'rateDownload'),
      eta: tField(t, 'eta', 'eta'),
    };
    if (num(t.error) === 3) out.push(makeItem({ ...base, state: 'error', reason: 'error' }));
    else if (num(t.status) === 4) {
      out.push(
        tField(t, 'is_stalled', 'isStalled') === true
          ? makeItem({ ...base, state: 'stall', reason: 'noPeers' })
          : makeItem(base),
      );
    }
  }
  return out;
}

const transmissionFinished = torrents =>
  list(torrents)
    .filter(t => num(tField(t, 'percent_done', 'percentDone')) === 1)
    .map(t => tField(t, 'done_date', 'doneDate'));

function delugeItems(torrents) {
  const out = [];
  const all = torrents && typeof torrents === 'object' ? Object.values(torrents) : [];
  for (const t of list(all)) {
    const state = str(t.state);
    const wanted = nonNeg(t.total_wanted);
    const base = {
      name: str(t.name),
      size: wanted,
      left: wanted - nonNeg(t.total_done),
      speed: t.download_payload_rate,
      eta: num(t.eta) > 0 ? t.eta : null,
    };
    if (state === 'Error') out.push(makeItem({ ...base, state: 'error', reason: 'error' }));
    else if (state === 'Downloading') {
      const idle = nonNeg(t.download_payload_rate) === 0 && nonNeg(t.num_seeds) === 0;
      out.push(idle ? makeItem({ ...base, state: 'stall', reason: 'noPeers' }) : makeItem(base));
    }
  }
  return out;
}

const delugeFinished = torrents =>
  list(torrents && typeof torrents === 'object' ? Object.values(torrents) : [])
    .filter(t => t.is_finished === true)
    .map(t => t.completed_time);

/** "1:02:03" or "2:01:02:03" as seconds, or null. */
function clockSeconds(text) {
  if (typeof text !== 'string' || !/^\d+(:\d{1,2}){2,3}$/.test(text.trim())) return null;
  return text
    .trim()
    .split(':')
    .map(Number)
    .reduce((acc, n, i, all) => acc + n * [1, 60, 3600, 86400][all.length - 1 - i], 0);
}

/* SABnzbd reports one speed for the whole queue. It belongs to the first job.
   Each slot's time left already counts the jobs ahead of it. */
function sabItems(queue) {
  if (!queue || typeof queue !== 'object' || queue.paused === true) return [];
  const speed = nonNeg(queue.kbpersec) * 1024;
  let speedGiven = false;
  const out = [];
  for (const s of list(queue.slots)) {
    if (str(s.status) !== 'Downloading') continue;
    const mySpeed = speedGiven ? 0 : speed;
    speedGiven = true;
    out.push(
      makeItem({
        name: str(s.filename),
        size: nonNeg(s.mb) * MIB,
        left: nonNeg(s.mbleft) * MIB,
        speed: mySpeed,
        eta: speed > 0 ? clockSeconds(s.timeleft) : null,
      }),
    );
  }
  return out;
}

const sabFinished = history =>
  list(history && history.slots)
    .filter(h => str(h.status) === 'Completed')
    .map(h => h.completed);

/* NZBGet reports one rate for the whole queue. It belongs to the first job.
   Jobs download in turn, so each one finishes after the jobs ahead of it.
   Paused files are repair files NZBGet fetches only when needed. */
function nzbgetItems(groups, status) {
  const rate =
    status && typeof status === 'object'
      ? hiLo(status.DownloadRateHi, status.DownloadRateLo) || nonNeg(status.DownloadRate)
      : 0;
  const paused = !!(status && status.DownloadPaused === true);
  let rateGiven = false;
  let ahead = 0;
  const out = [];
  for (const g of list(groups)) {
    if (paused || str(g.Status) !== 'DOWNLOADING') continue;
    const mySpeed = rateGiven ? 0 : rate;
    rateGiven = true;
    const held = hiLo(g.PausedSizeHi, g.PausedSizeLo);
    const left = Math.max(0, hiLo(g.RemainingSizeHi, g.RemainingSizeLo) - held);
    ahead += left;
    out.push(
      makeItem({
        name: str(g.NZBName),
        size: Math.max(0, hiLo(g.FileSizeHi, g.FileSizeLo) - held),
        left,
        speed: mySpeed,
        eta: rate > 0 ? ahead / rate : null,
      }),
    );
  }
  return out;
}

const nzbgetFinished = history =>
  list(history)
    .filter(h => str(h.Status).startsWith('SUCCESS'))
    .map(h => h.HistoryTime);

module.exports = {
  MAX_ITEMS,
  arrange,
  finishedTimes,
  clockSeconds,
  qbitItems,
  qbitFinished,
  transmissionItems,
  transmissionFinished,
  delugeItems,
  delugeFinished,
  sabItems,
  sabFinished,
  nzbgetItems,
  nzbgetFinished,
};
