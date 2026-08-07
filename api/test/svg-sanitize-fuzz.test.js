const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSvg } = require('../src/svg-sanitize');

/* ── Deterministic fuzzing for the SVG sanitizer ──

   The sanitizer rebuilds its output from an allowlist rather than stripping
   patterns out of its input, so the property under test is about the output as a
   whole: whatever goes in, what comes out must contain no script element, no
   event handler, no URL attribute, and no script protocol inside a style. The
   old design could not have this property, because anything it failed to parse
   was copied across untouched; P3-2 was one instance of that.

   Assertions are scoped to emitted markup. `javascript:` sitting in text content
   is inert, because text is escaped on the way out, and flagging it would only
   train the test to be ignored.

   The generator is seeded from a constant so a failure reproduces identically
   here and in CI. Raising ITERATIONS or changing SEED explores new inputs; a
   failure found that way should be pinned as a fixed case in
   svg-sanitize.test.js rather than left to the generator to rediscover. */

const SEED = 0x5eed1e;
const ITERATIONS = 5000;
const TIME_BUDGET_MS = 5000;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Fragments chosen to collide: tag openers with no closer, separators, quote
   characters, and the payloads the sanitizer exists to remove. */
const TOKENS = [
  '<svg', '<path', '<rect', '<g', '<style>', '</style>', '<script', '</script>', '</svg>',
  '/', '>', '=', ' ', '\t', '\n',
  'onload=', 'onerror=', 'xlink:href=', 'href=', 'src=', 'style=', 'd=', 'fill=',
  '"alert(1)"', '"M0 0"', '"x:javascript:y"', "'", '"',
  '<!--', '-->', '<!', '<?', '?>', '<![CDATA[', ']]>',
  'url(javascript:x)', '@import url(evil)', 'expression(alert(1))',
  '&', '&lt;', '&#60;', '<', '#', 'a',
];

const STYLE_BODY = /<style>((?:(?!<\/style>)[\s\S])*)<\/style>/gi;
const TAG = /<[a-zA-Z][\w:.-]*((?:[^"<>]|"[^"]*")*)>/g;
const ATTR = /\s([\w:.-]+)="([^"]*)"/g;

/* Attribute names and values from the emitted tags only.

   Scanning with a flat pattern would report the contents of a path's `d` value
   as an event handler the moment a fuzz insertion put `onload=x` inside it,
   which is text in a quoted attribute and inert. This relies on one property of
   the output, which the unit suite also pins: every attribute is written as
   name="value" and every quote inside a value is escaped, so a raw `"` always
   ends the value. */
function emittedAttrs(out) {
  const found = [];
  TAG.lastIndex = 0;
  let tag;
  while ((tag = TAG.exec(out))) {
    ATTR.lastIndex = 0;
    let a;
    while ((a = ATTR.exec(tag[1]))) found.push({ name: a[1], value: a[2] });
  }
  return found;
}

/** @returns {string|null} why the output is unsafe, or null */
function unsafeReason(out) {
  if (/<script/i.test(out)) return 'script element';

  for (const { name, value } of emittedAttrs(out)) {
    const n = name.toLowerCase();
    if (/^on/.test(n)) return `event handler attribute (${name})`;
    if (/^(href|xlink:href|src|action|formaction|data)$/.test(n)) return `url attribute (${name})`;
    if (n === 'style' && /(javascript|vbscript|behavior)\s*:/i.test(value)) return 'script protocol in a style attribute';
  }

  STYLE_BODY.lastIndex = 0;
  let m;
  while ((m = STYLE_BODY.exec(out))) {
    if (/(javascript|vbscript|behavior)\s*:/i.test(m[1])) return 'script protocol in a style body';
    if (/@import/i.test(m[1])) return '@import in a style body';
    if (/expression\s*\(/i.test(m[1])) return 'expression() in a style body';
  }
  return null;
}

test('no assembled input produces dangerous output', () => {
  const rnd = mulberry32(SEED);
  const started = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    let input = '';
    const len = 1 + Math.floor(rnd() * 16);
    for (let j = 0; j < len; j++) input += TOKENS[Math.floor(rnd() * TOKENS.length)];

    let out;
    try {
      out = sanitizeSvg(input);
    } catch (e) {
      assert.fail(`threw on ${JSON.stringify(input)}: ${e.message}`);
    }
    assert.equal(typeof out, 'string');
    const why = unsafeReason(out);
    assert.equal(why, null, `${why} survived\n  in:  ${JSON.stringify(input)}\n  out: ${JSON.stringify(out)}`);
  }
  assert.ok(Date.now() - started < TIME_BUDGET_MS, 'sanitizer is too slow, or an input is pathological');
});

test('no byte-level corruption of a real icon produces dangerous output', () => {
  const rnd = mulberry32(SEED ^ 0xffff);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<style>.a{fill:url(#g)}</style>'
    + '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>'
    + '<path d="M0 0h24v24H0z" fill="#f00"/><g transform="rotate(45)"><use/></g></svg>';
  const noise = ['<', '>', '/', '"', "'", '=', ' ', 'onload=x', '<script', '&'];

  for (let i = 0; i < ITERATIONS; i++) {
    const at = Math.floor(rnd() * svg.length);
    const insert = noise[Math.floor(rnd() * noise.length)];
    const input = svg.slice(0, at) + insert + svg.slice(at);
    const out = sanitizeSvg(input);
    const why = unsafeReason(out);
    assert.equal(why, null, `${why} survived after inserting ${JSON.stringify(insert)} at ${at}\n  out: ${JSON.stringify(out)}`);
  }
});
