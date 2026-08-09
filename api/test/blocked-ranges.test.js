/* Regression tests for P3-4: ranges missing from the outbound guard.

   Carrier-grade NAT, multicast, the reserved 240/4 block including the broadcast
   address, IETF protocol assignments, benchmarking, and IPv6 multicast were all
   accepted as outbound targets.

   The check was one regular expression that listed the IPv4 ranges twice, once
   alone and once inside its ::ffff: branch, so a range had to be added in two
   places. That is how these were missed. It is a numeric CIDR comparison now,
   one line per range.

   Every entry is tested at both edges and one address outside each, because an
   off-by-one in a range check fails silently and in the permissive direction. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateAddress, isBlockedIPv4, BLOCKED_IPV4 } = require('../src/proxy');

/* first and last address of each CIDR, then the address either side of it. */
const CASES = [
  { cidr: '0.0.0.0/8', first: '0.0.0.0', last: '0.255.255.255', after: '1.0.0.0' },
  { cidr: '10.0.0.0/8', first: '10.0.0.0', last: '10.255.255.255', before: '9.255.255.255', after: '11.0.0.0' },
  {
    cidr: '100.64.0.0/10',
    first: '100.64.0.0',
    last: '100.127.255.255',
    before: '100.63.255.255',
    after: '100.128.0.0',
  },
  { cidr: '127.0.0.0/8', first: '127.0.0.0', last: '127.255.255.255', before: '126.255.255.255', after: '128.0.0.0' },
  {
    cidr: '169.254.0.0/16',
    first: '169.254.0.0',
    last: '169.254.255.255',
    before: '169.253.255.255',
    after: '169.255.0.0',
  },
  { cidr: '172.16.0.0/12', first: '172.16.0.0', last: '172.31.255.255', before: '172.15.255.255', after: '172.32.0.0' },
  { cidr: '192.0.0.0/24', first: '192.0.0.0', last: '192.0.0.255', before: '191.255.255.255', after: '192.0.1.0' },
  {
    cidr: '192.168.0.0/16',
    first: '192.168.0.0',
    last: '192.168.255.255',
    before: '192.167.255.255',
    after: '192.169.0.0',
  },
  { cidr: '198.18.0.0/15', first: '198.18.0.0', last: '198.19.255.255', before: '198.17.255.255', after: '198.20.0.0' },
  { cidr: '224.0.0.0/4', first: '224.0.0.0', last: '239.255.255.255', before: '223.255.255.255', after: null },
  /* 240/4 abuts 224/4 below it and ends the address space above, so it has no
     allowed neighbour on either side. */
  { cidr: '240.0.0.0/4', first: '240.0.0.0', last: '255.255.255.255', before: null, after: null },
];

test('every range in the table is covered by a test here', () => {
  const declared = BLOCKED_IPV4.map(([base, bits]) => `${base}/${bits}`).sort();
  assert.deepEqual(
    CASES.map(c => c.cidr).sort(),
    declared,
    'a range was added or removed without updating these tests',
  );
});

test('every range blocks its first and last address', () => {
  for (const c of CASES) {
    assert.ok(isBlockedIPv4(c.first), `${c.first} (first of ${c.cidr}) should be blocked`);
    assert.ok(isBlockedIPv4(c.last), `${c.last} (last of ${c.cidr}) should be blocked`);
  }
});

test('no range blocks the address either side of it', () => {
  for (const c of CASES) {
    if (c.before) assert.ok(!isBlockedIPv4(c.before), `${c.before} is outside ${c.cidr} and should be allowed`);
    if (c.after) assert.ok(!isBlockedIPv4(c.after), `${c.after} is outside ${c.cidr} and should be allowed`);
  }
});

/* The specific additions this branch is about. */
test('carrier-grade NAT is blocked', () => {
  assert.ok(isPrivateAddress('100.64.0.1'));
  assert.ok(isPrivateAddress('100.100.100.100'));
});

test('multicast is blocked, including SSDP discovery', () => {
  assert.ok(isPrivateAddress('224.0.0.1'));
  assert.ok(isPrivateAddress('239.255.255.250'));
});

test('the reserved block and the broadcast address are blocked', () => {
  assert.ok(isPrivateAddress('240.0.0.1'));
  assert.ok(isPrivateAddress('255.255.255.255'));
});

test('IETF protocol assignments and benchmarking ranges are blocked', () => {
  assert.ok(isPrivateAddress('192.0.0.1'));
  assert.ok(isPrivateAddress('198.18.0.1'));
});

/* ── IPv6 ─────────────────────────────────────────────────────────────────── */

test('IPv6 multicast is blocked', () => {
  for (const a of ['ff02::1', 'ff05::1:3', 'FF02::FB']) assert.ok(isPrivateAddress(a), `${a} should be blocked`);
});

/* A group written 'ff' is 0x00ff, not 0xff00, so it is not multicast. 0xff02 can
   only be written 'ff02', which is why the check needs all four hex digits. */
test('a short first group is not mistaken for multicast', () => {
  assert.ok(!isPrivateAddress('ff::1'));
});

test('the existing IPv6 ranges still work', () => {
  for (const a of ['::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'feb0::1'])
    assert.ok(isPrivateAddress(a), `${a} should be blocked`);
  for (const a of ['2001:db8::1', '2606:4700::1111']) assert.ok(!isPrivateAddress(a), `${a} should be allowed`);
});

/* ── the new ranges through the IPv4-in-IPv6 wrappers ─────────────────────── */

/* The wrappers decode to IPv4 and then use the same table, so a range added to
   the table is covered through them without a second edit. That was the point
   of replacing the duplicated regular expression. */
test('a new range is blocked through an IPv4-mapped wrapper too', () => {
  assert.ok(isPrivateAddress('::ffff:100.64.0.1'), 'CGNAT via ::ffff: dotted');
  assert.ok(isPrivateAddress('::ffff:6440:1'), 'CGNAT via ::ffff: hex');
  assert.ok(isPrivateAddress('64:ff9b::e000:1'), 'multicast via NAT64');
  assert.ok(isPrivateAddress('::ffff:255.255.255.255'), 'broadcast via ::ffff:');
});

/* ── input handling ──────────────────────────────────────────────────────── */

test('a non-address is not treated as blocked', () => {
  for (const v of ['', 'example.com', 'not-an-ip', '10.0.0', '10.0.0.256', '999.999.999.999'])
    assert.equal(isBlockedIPv4(v), false, `${JSON.stringify(v)} is not an IPv4 address`);
});

test('isPrivateAddress tolerates non-string input', () => {
  for (const v of [null, undefined, 0, {}, []]) assert.equal(isPrivateAddress(v), false);
});

test('a public address is still reachable', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '203.0.113.5'])
    assert.ok(!isPrivateAddress(ip), `${ip} should be allowed`);
});

/* ── the documented list ──────────────────────────────────────────────────── */

/* Operators read docs/security.md to decide whether they need ALLOW_PRIVATE_IPS,
   so a table that drifts from the code is worse than no table. */
test('docs/security.md lists exactly the ranges the code blocks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const doc = fs.readFileSync(path.join(__dirname, '../../docs/security.md'), 'utf8');
  const documented = [...doc.matchAll(/^\| `(\d[\d.]*\/\d+)` \|/gm)].map(m => m[1]).sort();
  const inCode = BLOCKED_IPV4.map(([base, bits]) => `${base}/${bits}`).sort();
  assert.deepEqual(documented, inCode, 'the table in docs/security.md is out of date');
});
