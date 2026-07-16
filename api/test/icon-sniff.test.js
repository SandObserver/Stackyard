const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sniffIconType } = require('../src/icon-sniff');

const png = (extra = []) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...extra]);
const ico = (extra = []) => Buffer.from([0x00, 0x00, 0x01, 0x00, ...extra]);

test('sniffIconType identifies PNG and ICO signatures', () => {
  assert.equal(sniffIconType(png([0, 0, 0, 13])), 'png');
  assert.equal(sniffIconType(ico([1, 0])), 'ico');
});

test('sniffIconType rejects non-image payloads', () => {
  for (const body of ['<script>alert(1)</script>', '<!DOCTYPE html><html></html>', 'GIF89a', '%PDF-1.4', ''])
    assert.equal(sniffIconType(Buffer.from(body)), null, `${body.slice(0, 12)} should be rejected`);
});

test('sniffIconType rejects a cursor claiming to be an icon', () => {
  assert.equal(sniffIconType(Buffer.from([0x00, 0x00, 0x02, 0x00, 0x01, 0x00])), null);
});

test('sniffIconType rejects buffers shorter than a signature', () => {
  assert.equal(sniffIconType(Buffer.from([0x89, 0x50])), null);
  assert.equal(sniffIconType(Buffer.alloc(0)), null);
  assert.equal(sniffIconType(null), null);
});
