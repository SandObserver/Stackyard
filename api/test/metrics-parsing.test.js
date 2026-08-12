const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeCpu } = require('../src/metrics');
const { parseNetDev } = require('../src/routes/system');

/* ── CPU: NaN passed the guard ────────────────────────────────────────────── */

/* Fields after softirq were added to /proc/stat over time, so a kernel reporting
   fewer yields undefined, which coerces to NaN. The guard was `dt <= 0`, and NaN
   fails every comparison, so NaN went straight through and reached the widget. */
test('a malformed CPU sample reports zero rather than NaN', () => {
  const bad = { total: NaN, busy: NaN, iowait: NaN };
  assert.deepEqual(computeCpu(bad, bad), { cpu: 0, iowait: 0 });
});

test('any NaN in either snapshot is caught', () => {
  const good = { total: 100, busy: 50, iowait: 5 };
  for (const bad of [
    { total: NaN, busy: 1, iowait: 1 },
    { total: 200, busy: NaN, iowait: 1 },
  ]) {
    const r = computeCpu(good, bad);
    assert.ok(Number.isFinite(r.cpu), `cpu was ${r.cpu}`);
    assert.ok(Number.isFinite(r.iowait), `iowait was ${r.iowait}`);
  }
});

test('an ordinary pair of samples still computes correctly', () => {
  assert.deepEqual(computeCpu({ total: 100, busy: 50, iowait: 5 }, { total: 200, busy: 120, iowait: 10 }), {
    cpu: 70,
    iowait: 5,
  });
});

test('two identical samples report zero, not a division by zero', () => {
  const s = { total: 100, busy: 50, iowait: 5 };
  assert.deepEqual(computeCpu(s, s), { cpu: 0, iowait: 0 });
});

test('a counter that went backwards does not produce a negative percentage', () => {
  const r = computeCpu({ total: 200, busy: 120, iowait: 10 }, { total: 100, busy: 50, iowait: 5 });
  assert.deepEqual(r, { cpu: 0, iowait: 0 });
});

/* ── /proc/net/dev: the field shift ───────────────────────────────────────── */

const HEADER =
  'Inter-|   Receive                                                |  Transmit\n' +
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n';

test('an ordinary line reads bytes, not packets', () => {
  const text = `${HEADER}  eth0: 1234567    890    0    0    0     0          0         0   987654    321    0    0    0     0       0          0\n`;
  assert.deepEqual(parseNetDev(text, 'eth0'), { rx: 1234567, tx: 987654 });
});

/* The kernel pads the name to a fixed width, so once the receive counter is wide
   enough the value runs into the colon and every whitespace-split field shifts by
   one. That happens after about 10 MB of traffic, so it is the normal case on any
   real machine, not an edge case: the widget was reporting packets per second as
   though they were bytes. */
test('a counter glued to the colon still reads correctly', () => {
  const text = `${HEADER}  eth0:123456789012    890    0    0    0     0          0         0   987654    321    0    0    0     0       0          0\n`;
  assert.deepEqual(parseNetDev(text, 'eth0'), { rx: 123456789012, tx: 987654 });
});

test('both counters glued still read correctly', () => {
  const text = `${HEADER}  eth0:123456789012 890 0 0 0 0 0 0 999888777666 321 0 0 0 0 0 0\n`;
  assert.deepEqual(parseNetDev(text, 'eth0'), { rx: 123456789012, tx: 999888777666 });
});

/* ── /proc/net/dev: the interface name ────────────────────────────────────── */

test('the interface name is matched exactly, not by prefix', () => {
  const text = `${HEADER}  eth0.100: 111 1 0 0 0 0 0 0 222 2 0 0 0 0 0 0\n  eth0: 333 3 0 0 0 0 0 0 444 4 0 0 0 0 0 0\n`;
  assert.deepEqual(parseNetDev(text, 'eth0'), { rx: 333, tx: 444 }, 'a VLAN listed first must not be picked');
  assert.deepEqual(parseNetDev(text, 'eth0.100'), { rx: 111, tx: 222 });
});

test('a partial name matches nothing', () => {
  const text = `${HEADER}  eth0: 333 3 0 0 0 0 0 0 444 4 0 0 0 0 0 0\n`;
  assert.equal(parseNetDev(text, 'eth'), null);
  assert.equal(parseNetDev(text, 'th0'), null);
});

test('an interface that is not present yields nothing', () => {
  assert.equal(parseNetDev(`${HEADER}  lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n`, 'eth0'), null);
});

test('the header lines are never mistaken for an interface', () => {
  assert.equal(parseNetDev(HEADER, 'face'), null, 'the header contains a colon too');
  assert.equal(parseNetDev(HEADER, 'Inter-|   Receive'), null);
});

test('junk input yields nothing rather than throwing', () => {
  for (const v of ['', null, undefined, 'no colons here', 'eth0:']) {
    assert.doesNotThrow(() => parseNetDev(v, 'eth0'));
    assert.equal(parseNetDev(v, 'eth0'), null, `for ${JSON.stringify(v)}`);
  }
});

test('a line with non-numeric counters yields nothing', () => {
  assert.equal(parseNetDev(`${HEADER}  eth0: abc def 0 0 0 0 0 0 ghi jkl\n`, 'eth0'), null);
});

/* ── RAM: a missing MemAvailable read as zero ─────────────────────────────── */

/* MemAvailable is absent on kernels before 3.14 and in some container setups.
   The lookup returned 0, so (total - 0) / total reported 100% memory used on
   every such machine. */

const fs = require('node:fs');

/* ramPercent reads /proc/meminfo directly, so exercise it by pointing readFileSync
   at prepared text for the duration of the call. */
function ramWith(meminfo) {
  const real = fs.readFileSync;
  fs.readFileSync = (p, ...rest) => (String(p).endsWith('meminfo') ? meminfo : real(p, ...rest));
  try {
    delete require.cache[require.resolve('../src/metrics')];
    return require('../src/metrics').ramPercent();
  } finally {
    fs.readFileSync = real;
    delete require.cache[require.resolve('../src/metrics')];
  }
}

test('MemAvailable is used when the kernel provides it', () => {
  const pct = ramWith('MemTotal: 8000000 kB\nMemFree: 2000000 kB\nMemAvailable: 5500000 kB\n');
  assert.ok(Math.abs(pct - 31.25) < 0.01, `got ${pct}`);
});

test('a kernel without MemAvailable does not report 100% used', () => {
  const pct = ramWith('MemTotal: 8000000 kB\nMemFree: 2000000 kB\nBuffers: 500000 kB\nCached: 3000000 kB\n');
  assert.ok(pct > 20 && pct < 45, `expected roughly a third used, got ${pct}`);
});

test('SReclaimable counts towards available when falling back', () => {
  const without = ramWith('MemTotal: 8000000 kB\nMemFree: 2000000 kB\nCached: 3000000 kB\n');
  const with_ = ramWith('MemTotal: 8000000 kB\nMemFree: 2000000 kB\nCached: 3000000 kB\nSReclaimable: 1000000 kB\n');
  assert.ok(with_ < without, 'reclaimable slab is available memory');
});

test('meminfo without a total reports zero rather than dividing by it', () => {
  assert.equal(ramWith('MemFree: 2000000 kB\n'), 0);
  assert.equal(ramWith(''), 0);
});

test('an implausible reading reports zero rather than a number that looks real', () => {
  assert.equal(ramWith('MemTotal: 100 kB\nMemAvailable: 999999 kB\n'), 0, 'available above total');
});
