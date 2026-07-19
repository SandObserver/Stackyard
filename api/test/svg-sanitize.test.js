const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSvg } = require('../src/svg-sanitize');

test('script elements are removed', () => {
  const out = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<path/);
});

test('event-handler attributes are stripped', () => {
  const out = sanitizeSvg('<svg onload="evil()"><rect onclick="x()" onanimationstart="y()" width="10"/></svg>');
  assert.doesNotMatch(out, /onload/i);
  assert.doesNotMatch(out, /onclick/i);
  assert.doesNotMatch(out, /onanimationstart/i);
  assert.match(out, /width="10"/);
});

test('href / xlink:href / src attributes are stripped', () => {
  const out = sanitizeSvg('<svg><use xlink:href="http://evil" href="x"/><image src="http://evil"/></svg>');
  assert.doesNotMatch(out, /href/i);
  assert.doesNotMatch(out, /src=/i);
});

test('unknown/unsafe elements are removed', () => {
  const out = sanitizeSvg('<svg><iframe src="x"></iframe><foreignObject><body/></foreignObject><path d="M1 1"/></svg>');
  assert.doesNotMatch(out, /<iframe/i);
  assert.doesNotMatch(out, /<foreignObject/i);
  assert.doesNotMatch(out, /<body/i);
  assert.match(out, /<path d="M1 1"/);
});

test('safe elements and attributes are preserved', () => {
  const svg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="#f00"/></svg>';
  const out = sanitizeSvg(svg);
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /d="M0 0h24v24H0z"/);
  assert.match(out, /fill="#f00"/);
});

test('dangerous CSS in <style> is scrubbed', () => {
  const out = sanitizeSvg('<svg><style>@import url(http://evil); .a{background:url(javascript:alert(1))}</style></svg>');
  assert.doesNotMatch(out, /@import/i);
  assert.doesNotMatch(out, /javascript:/i);
});

test('dangerous CSS in a style attribute is scrubbed but the attribute stays', () => {
  const out = sanitizeSvg('<rect style="fill:red;background:url(javascript:alert(1))"/>');
  assert.match(out, /style=/);
  assert.doesNotMatch(out, /javascript:/i);
});

test('comments, processing instructions and DOCTYPE are removed', () => {
  const out = sanitizeSvg('<?xml version="1.0"?><!DOCTYPE svg><!-- c --><svg><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<\?xml/i);
  assert.doesNotMatch(out, /DOCTYPE/i);
  assert.doesNotMatch(out, /<!--/);
});

test('aria- and data- attributes are allowed', () => {
  const out = sanitizeSvg('<svg aria-label="icon" data-x="1"><path d="M0 0"/></svg>');
  assert.match(out, /aria-label="icon"/);
  assert.match(out, /data-x="1"/);
});

test('reconstruction via a split tag is stripped (multi-pass)', () => {
  const out = sanitizeSvg('<svg><scr<script>ipt>alert(1)</scr</script>ipt></svg>');
  assert.doesNotMatch(out, /<script/i);
});

test('nested comment reconstruction is fully removed', () => {
  const out = sanitizeSvg('<svg><!--<!-- -->--><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<!--/);
});

test('an unterminated comment is stripped to end of string', () => {
  const out = sanitizeSvg('<svg><path d="M0 0"/><!-- dangling');
  assert.doesNotMatch(out, /<!--/);
});

test('an unterminated processing instruction is stripped', () => {
  const out = sanitizeSvg('<svg></svg><?php echo 1');
  assert.doesNotMatch(out, /<\?/);
});

test('namespace-prefixed dangerous elements are stripped', () => {
  const out = sanitizeSvg('<svg><svg:script>alert(1)</svg:script><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<svg:script/i);
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<path d="M0 0"/);
});

test('element and attribute matching is case-insensitive', () => {
  const out = sanitizeSvg('<svg ONLOAD="x()"><ScRiPt>alert(1)</ScRiPt><PATH D="M0 0"/></svg>');
  assert.doesNotMatch(out, /onload/i);
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<PATH D="M0 0"/);
});

test('unquoted event-handler attributes are stripped', () => {
  const out = sanitizeSvg('<svg><rect onclick=alert(1) width="5"/></svg>');
  assert.doesNotMatch(out, /onclick/i);
  assert.match(out, /width="5"/);
});

test('CSS expression() is scrubbed from a style body', () => {
  const out = sanitizeSvg('<svg><style>.a{width:expression(alert(1))}</style></svg>');
  assert.doesNotMatch(out, /expression/i);
});

test('legacy script protocols are scrubbed from CSS', () => {
  const out = sanitizeSvg('<svg><style>.a{behavior:url(x.htc)}</style><rect style="x:vbscript:msgbox(1)"/></svg>');
  assert.doesNotMatch(out, /behavior/i);
  assert.doesNotMatch(out, /vbscript/i);
});

test('legitimate url(#id) references are preserved', () => {
  const attr = sanitizeSvg('<rect style="fill:url(#grad)"/>');
  assert.match(attr, /url\(#grad\)/);
  const grad = sanitizeSvg('<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect fill="url(#g)"/></svg>');
  assert.match(grad, /fill="url\(#g\)"/);
  assert.match(grad, /<linearGradient id="g"/);
});

test('SMIL animation elements are stripped', () => {
  const out = sanitizeSvg('<svg><animate attributeName="x"/><set attributeName="y"/><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<animate/i);
  assert.doesNotMatch(out, /<set/i);
  assert.match(out, /<path d="M0 0"/);
});
