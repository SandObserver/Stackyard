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
  const out = sanitizeSvg(
    '<svg><style>@import url(http://evil); .a{background:url(javascript:alert(1))}</style></svg>',
  );
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
  const grad = sanitizeSvg(
    '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect fill="url(#g)"/></svg>',
  );
  assert.match(grad, /fill="url\(#g\)"/);
  assert.match(grad, /<linearGradient id="g"/);
});

test('SMIL animation elements are stripped', () => {
  const out = sanitizeSvg('<svg><animate attributeName="x"/><set attributeName="y"/><path d="M0 0"/></svg>');
  assert.doesNotMatch(out, /<animate/i);
  assert.doesNotMatch(out, /<set/i);
  assert.match(out, /<path d="M0 0"/);
});

/* ── P3-2: separators other than whitespace ───────────────────────────────────
   Browsers accept `/` between attributes, so `<path/onload=x>` is an event
   handler. The old attribute pattern required whitespace before a name, matched
   nothing here, and copied the handler straight through. The sanitizer rebuilds
   its output now rather than editing the input, so an attribute it does not
   recognise is never written out at all. */

test('a slash-separated event handler is stripped', () => {
  const out = sanitizeSvg('<svg><path/onload="alert(1)" d="M0 0"/></svg>');
  assert.doesNotMatch(out, /onload/i);
  assert.match(out, /d="M0 0"/, 'the legitimate attribute survives');
});

test('a slash-separated handler on the root element is stripped', () => {
  assert.doesNotMatch(sanitizeSvg('<svg/onload=alert(1)></svg>'), /onload/i);
  assert.doesNotMatch(sanitizeSvg('<svg xmlns="x"/onload="alert(1)"></svg>'), /onload/i);
});

test('repeated and multiple slashes do not hide a handler', () => {
  const out = sanitizeSvg('<svg//onload=alert(1)//onerror=x></svg>');
  assert.doesNotMatch(out, /onload|onerror/i);
});

test('tabs and newlines separate attributes as whitespace does', () => {
  assert.doesNotMatch(sanitizeSvg('<svg\tonload="x"></svg>'), /onload/i);
  assert.doesNotMatch(sanitizeSvg('<svg\nonload="x"></svg>'), /onload/i);
});

test('a self-closing slash is still recognised as one', () => {
  assert.match(sanitizeSvg('<svg><path d="M0 0"/></svg>'), /<path d="M0 0"\/>/);
});

/* ── rebuilding, rather than stripping ────────────────────────────────────── */

test('text content is escaped, so dropped markup cannot be reassembled', () => {
  const out = sanitizeSvg('<svg><script>if (a < b) alert(1)</script></svg>');
  assert.doesNotMatch(out, /<script/i);
  assert.ok(!out.includes('<b'), 'a bare < in text must not look like a tag');
  assert.match(out, /&lt;/);
});

test('an attribute value cannot break out of its quotes', () => {
  const out = sanitizeSvg('<svg><path d=\'M0 0" onload="alert(1)\'/></svg>');
  assert.doesNotMatch(out, /onload="alert/i, 'the value must not reopen as an attribute');
  assert.match(out, /&quot;/);
});

test('an unquoted attribute value is quoted on output', () => {
  assert.match(sanitizeSvg('<svg><rect width=5 height=6/></svg>'), /width="5" height="6"/);
});

test('a second pass never reintroduces anything dangerous', () => {
  /* Not full idempotency: escaping is not idempotent by design, since a second
     pass escapes the ampersands the first one wrote. What must hold is that
     re-sanitizing cannot turn safe output back into markup. */
  const inputs = [
    '<svg><path/onload=x d="M0 0"/></svg>',
    '<svg><scr<script>ipt>alert(1)</scr</script>ipt></svg>',
    '<svg><!--<!-- -->--><path d="M0 0"/></svg>',
    '<svg><style>.a{fill:url(#g)}</style><rect style="fill:red"/></svg>',
  ];
  for (const i of inputs) {
    const twice = sanitizeSvg(sanitizeSvg(i));
    assert.doesNotMatch(twice, /\son\w+\s*=/i, `handler after two passes: ${i}`);
    assert.doesNotMatch(twice, /<script/i, `script after two passes: ${i}`);
  }
});

test('output with nothing to escape is stable across passes', () => {
  const inputs = [
    '<svg><path d="M0 0"/></svg>',
    '<svg aria-label="x" data-y="1"><g transform="rotate(45)"><use/></g></svg>',
    '<svg><style>.a{fill:url(#g)}</style><rect style="fill:red"/></svg>',
  ];
  for (const i of inputs) {
    const once = sanitizeSvg(i);
    assert.ok(!once.includes('&'), `precondition: ${once} should need no escaping`);
    assert.equal(sanitizeSvg(once), once, `not stable for ${i}`);
  }
});

/* ── malformed input ──────────────────────────────────────────────────────── */

test('truncated input never yields a handler or a script', () => {
  const seeds = [
    '<svg><path d="M0 0" onload',
    '<svg><path d="unterminated',
    '<svg><path onload="alert(1)',
    '<svg><style>.a{',
    '<svg><![CDATA[<script>alert(1)</script>',
    '<svg <path onload=x>',
    '<>< ><svg>',
    '<svg><path d=',
  ];
  for (const s of seeds) {
    const out = sanitizeSvg(s);
    assert.doesNotMatch(out, /\son\w+\s*=/i, `handler survived: ${s} -> ${out}`);
    assert.doesNotMatch(out, /<script/i, `script survived: ${s} -> ${out}`);
  }
});

/* Truncating a known-good document at every offset should never produce
   something dangerous. Cheap to run and covers cut points nobody would pick. */
test('no truncation of a realistic icon produces a handler or a script', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="evil()">' +
    '<style>.a{fill:url(#g)}</style><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
    '<path d="M0 0h24v24H0z" fill="#f00" onclick="evil()"/><script>alert(1)</script></svg>';
  for (let i = 0; i <= svg.length; i++) {
    const out = sanitizeSvg(svg.slice(0, i));
    assert.doesNotMatch(out, /\son\w+\s*=/i, `handler at cut ${i}: ${out}`);
    assert.doesNotMatch(out, /<script/i, `script at cut ${i}: ${out}`);
  }
});

test('non-string input does not throw', () => {
  for (const v of [null, undefined, 0, {}, []]) assert.equal(typeof sanitizeSvg(v), 'string');
});
