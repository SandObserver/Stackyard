const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMultipartFile } = require('../src/parse-multipart');

const B = 'X-BOUNDARY-123';

/* Assemble a multipart/form-data body from parts. A part with `filename` set
   becomes a file part; `body` may be a Buffer to exercise binary handling. */
function build(parts) {
  const chunks = [];
  for (const p of parts) {
    const disp = p.filename !== undefined
      ? `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"`
      : `Content-Disposition: form-data; name="${p.name}"`;
    chunks.push(Buffer.from(`--${B}\r\n${disp}\r\n\r\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body, 'utf8'));
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${B}--\r\n`, 'latin1'));
  return Buffer.concat(chunks);
}

test('extracts a single file part with its bytes and a count of one', () => {
  const r = parseMultipartFile(build([{ name:'icon', filename:'logo.svg', body:'<svg></svg>' }]), B);
  assert.equal(r.filename, 'logo.svg');
  assert.equal(r.data.toString('utf8'), '<svg></svg>');
  assert.equal(r.fileParts, 1);
});

test('counts multiple file parts so the route can reject them', () => {
  const r = parseMultipartFile(build([
    { name:'a', filename:'one.svg', body:'<svg>1</svg>' },
    { name:'b', filename:'two.svg', body:'<svg>2</svg>' },
  ]), B);
  assert.equal(r.fileParts, 2);
  assert.equal(r.filename, 'two.svg');
});

test('ignores non-file fields: no filename means no file found', () => {
  const r = parseMultipartFile(build([{ name:'plain', body:'just a value' }]), B);
  assert.equal(r.filename, '');
  assert.equal(r.data, null);
  assert.equal(r.fileParts, 0);
});

test('strips path components from the filename', () => {
  const r = parseMultipartFile(build([{ name:'icon', filename:'../../etc/passwd', body:'x' }]), B);
  assert.equal(r.filename, 'passwd');
});

test('preserves binary bodies that contain CRLF up to the next boundary', () => {
  const body = Buffer.from([0x89, 0x50, 0x0d, 0x0a, 0x4e, 0x47, 0x00, 0xff]);
  const r = parseMultipartFile(build([{ name:'icon', filename:'x.png', body }]), B);
  assert.deepEqual(r.data, body);
  assert.equal(r.fileParts, 1);
});

test('stops at the closing terminator without consuming trailing bytes', () => {
  const buf = Buffer.concat([
    build([{ name:'icon', filename:'x.svg', body:'<svg/>' }]),
    Buffer.from('trailing junk that must not be read', 'latin1'),
  ]);
  const r = parseMultipartFile(buf, B);
  assert.equal(r.data.toString('utf8'), '<svg/>');
  assert.equal(r.fileParts, 1);
});
