/* The fake DOM must behave like a browser where page code depends on it. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, installDom } from './fake-dom.mjs';

test('capture listeners run top down before the target, then bubble listeners run bottom up', () => {
  const doc = createDocument('<div id="outer"><button id="b">Go</button></div>');
  const outer = doc.getElementById('outer');
  const b = doc.getElementById('b');
  const order = [];
  doc.addEventListener('click', () => order.push('doc bubble'));
  doc.addEventListener('click', () => order.push('doc capture'), true);
  outer.addEventListener('click', () => order.push('outer capture'), { capture: true });
  outer.addEventListener('click', () => order.push('outer bubble'));
  b.addEventListener('click', () => order.push('target'));
  b.onclick = () => order.push('target property');
  b.addEventListener('click', () => order.push('target capture'), true);
  b.click();
  assert.deepEqual(order, [
    'doc capture',
    'outer capture',
    'target capture',
    'target',
    'target property',
    'outer bubble',
    'doc bubble',
  ]);
});

test('an event that does not bubble still passes the capture phase', () => {
  const doc = createDocument('<div id="outer"><input id="i"></div>');
  const order = [];
  doc.getElementById('outer').addEventListener('focus', () => order.push('capture'), true);
  doc.getElementById('outer').addEventListener('focus', () => order.push('bubble'));
  doc.getElementById('i').dispatchEvent({ type: 'focus' });
  assert.deepEqual(order, ['capture']);
});

test('stopPropagation in the capture phase keeps the event from the target', () => {
  const doc = createDocument('<div id="outer"><button id="b">Go</button></div>');
  let reached = false;
  doc.getElementById('outer').addEventListener('click', e => e.stopPropagation(), true);
  doc.getElementById('b').addEventListener('click', () => {
    reached = true;
  });
  doc.getElementById('b').click();
  assert.equal(reached, false);
});

test('a capture and a bubble registration of one function are separate', () => {
  const doc = createDocument('<button id="b">Go</button>');
  const b = doc.getElementById('b');
  let n = 0;
  const fn = () => n++;
  b.addEventListener('click', fn, true);
  b.addEventListener('click', fn);
  b.addEventListener('click', fn);
  b.click();
  assert.equal(n, 2);
  b.removeEventListener('click', fn, true);
  b.click();
  assert.equal(n, 3);
});

test('createElement returns the class the tag has in a browser', () => {
  const dom = installDom({ markup: '<input id="i"><button id="b"></button><svg id="s"><path></path></svg>' });
  try {
    const input = dom.document.getElementById('i');
    const button = dom.document.getElementById('b');
    const svg = dom.document.getElementById('s');
    assert.ok(input instanceof HTMLInputElement);
    assert.ok(!(button instanceof HTMLInputElement));
    assert.ok(button instanceof HTMLButtonElement);
    assert.ok(button instanceof HTMLElement && button instanceof Element);
    assert.ok(svg instanceof SVGSVGElement);
    assert.ok(!(svg instanceof HTMLElement));
    assert.ok(!(svg.firstElementChild instanceof SVGSVGElement));
    assert.ok(svg.firstElementChild instanceof SVGElement);
  } finally {
    dom.restore();
  }
});

test('text nodes are child nodes, not children, and keep their order', () => {
  const doc = createDocument('<p id="p">one <b>two</b> three</p>');
  const p = doc.getElementById('p');
  assert.equal(p.children.length, 1);
  assert.equal(p.childNodes.length, 3);
  assert.equal(p.textContent, 'one two three');
  p.append(' four');
  assert.equal(p.textContent, 'one two three four');
  p.textContent = 'plain';
  assert.equal(p.children.length, 0);
  assert.equal(p.textContent, 'plain');
});

test('innerHTML reads the current tree, escaped', () => {
  const doc = createDocument('<ul id="u"><li>a</li></ul>');
  const u = doc.getElementById('u');
  const li = doc.createElement('li');
  li.textContent = 'b < c';
  li.setAttribute('title', 'say "hi"');
  u.appendChild(li);
  assert.equal(u.innerHTML, '<li>a</li><li title="say &quot;hi&quot;">b &lt; c</li>');
});

test('hidden and disabled reflect to their attributes', () => {
  const doc = createDocument('<button id="b" hidden></button>');
  const b = doc.getElementById('b');
  assert.equal(b.hidden, true);
  b.hidden = false;
  assert.equal(b.hasAttribute('hidden'), false);
  b.disabled = true;
  assert.equal(b.getAttribute('disabled'), '');
  assert.equal(doc.querySelector('button[disabled]'), b);
});

test('a MutationObserver gets every filtered attribute write in one microtask', async () => {
  const dom = installDom({ markup: '<div id="d"></div>' });
  try {
    const d = dom.document.getElementById('d');
    const seen = [];
    new MutationObserver(recs => seen.push(recs.map(r => [r.attributeName, r.oldValue]))).observe(d, {
      attributeFilter: ['data-x'],
      attributeOldValue: true,
    });
    d.setAttribute('data-x', '1');
    d.dataset.x = '2';
    d.setAttribute('title', 'skipped');
    d.dataset.x = '2';
    assert.deepEqual(seen, [], 'delivered before the microtask');
    await Promise.resolve();
    assert.deepEqual(seen, [
      [
        ['data-x', null],
        ['data-x', '1'],
        ['data-x', '2'],
      ],
    ]);
    d.classList.add('c');
    await Promise.resolve();
    assert.equal(seen.length, 1, 'class is outside the filter');
  } finally {
    dom.restore();
  }
});

test('a write of the same value is recorded, a toggle that changes nothing is not', async () => {
  const dom = installDom({ markup: '<div id="d" class="a" hidden></div>' });
  try {
    const d = dom.document.getElementById('d');
    const names = [];
    new MutationObserver(recs => names.push(...recs.map(r => r.attributeName))).observe(d, { attributes: true });
    d.setAttribute('id', 'd');
    d.classList.add('a');
    d.className = 'a';
    d.hidden = true;
    d.toggleAttribute('hidden', true);
    d.toggleAttribute('title', false);
    d.removeAttribute('title');
    d.toggleAttribute('hidden');
    await Promise.resolve();
    assert.deepEqual(names, ['id', 'class', 'class', 'hidden', 'hidden']);
  } finally {
    dom.restore();
  }
});

test('a MutationObserver sees a descendant only with subtree, and stops on disconnect', async () => {
  const dom = installDom({ markup: '<div id="p"><i id="c"></i></div>' });
  try {
    const p = dom.document.getElementById('p');
    const c = dom.document.getElementById('c');
    let flat = 0;
    let deep = 0;
    new MutationObserver(r => (flat += r.length)).observe(p, { attributes: true });
    const mo = new MutationObserver(r => (deep += r.length));
    mo.observe(p, { attributes: true, subtree: true });
    c.dataset.x = '1';
    await Promise.resolve();
    assert.deepEqual([flat, deep], [0, 1]);
    mo.disconnect();
    c.dataset.x = '2';
    await Promise.resolve();
    assert.equal(deep, 1);
  } finally {
    dom.restore();
  }
});

test('a MutationObserver refuses the options it does not record', () => {
  const dom = installDom({ markup: '<div id="d"></div>' });
  try {
    const d = dom.document.getElementById('d');
    assert.throws(() => new MutationObserver(() => {}).observe(d, { childList: true }), /attributes only/);
    assert.throws(() => new MutationObserver(() => {}).observe(d, { characterData: true }), /attributes only/);
    assert.throws(() => new MutationObserver(() => {}).observe(d, {}), TypeError);
  } finally {
    dom.restore();
  }
});

test('a ResizeObserver reports the first size and then only changes, in a frame', () => {
  const dom = installDom({ markup: '<div id="d"></div>' });
  try {
    const d = dom.document.getElementById('d');
    const seen = [];
    new ResizeObserver(entries =>
      seen.push(entries.map(e => `${e.contentRect.width}x${e.contentRect.height}`)),
    ).observe(d);
    assert.deepEqual(seen, []);
    dom.flushFrames();
    assert.deepEqual(seen, [['0x0']]);
    dom.resize(d, { width: 10, height: 20 });
    dom.resize(d, { width: 10, height: 20 });
    dom.flushFrames();
    assert.deepEqual(seen, [['0x0'], ['10x20']]);
    assert.equal(d.getBoundingClientRect().height, 20);
    dom.resize(d, { width: 10, height: 20 });
    dom.flushFrames();
    assert.equal(seen.length, 2, 'an unchanged size is not reported');
  } finally {
    dom.restore();
  }
});

test('a canvas with no context returns null, and link attributes reflect', () => {
  const doc = createDocument();
  const cv = doc.createElement('canvas');
  assert.equal(cv.getContext('2d'), null);
  const a = doc.createElement('a');
  Object.assign(a, { target: '_blank', rel: 'noopener', src: '/x' });
  assert.equal(a.outerHTML, '<a target="_blank" rel="noopener" src="/x"></a>');
  assert.ok(a.matches('a[target="_blank"]'));
});

test('a parsed SVG imports into the document with its namespace and children', () => {
  const dom = installDom();
  try {
    const parsed = new DOMParser().parseFromString(
      '<svg id="s"><symbol id="y"><path d="M0"/></symbol></svg>',
      'image/svg+xml',
    );
    const svg = dom.document.importNode(parsed.documentElement, true);
    dom.document.body.prepend(svg);
    assert.equal(dom.document.getElementById('s'), svg);
    assert.ok(svg instanceof SVGSVGElement);
    assert.equal(svg.querySelector('path').getAttribute('d'), 'M0');
    assert.ok(svg.querySelector('path').isConnected);
  } finally {
    dom.restore();
  }
});

test('an :is() list matches any of its selectors, and a comma inside it does not split the selector', () => {
  const doc = createDocument('<a id="x" class="di" target="_blank"></a><a id="y" class="icon"></a><b class="di"></b>');
  const found = doc.querySelectorAll('a[target="_blank"]:is(.icon, .di), b:is(.none)');
  assert.deepEqual(
    found.map(e => e.id),
    ['x'],
  );
  assert.ok(doc.getElementById('x').closest('a:is(.icon, .di)'));
});

test('a clone keeps the inline style', () => {
  const doc = createDocument();
  const a = doc.createElement('div');
  a.style.cssText = 'display:none;';
  a.style.setProperty('--x', '1px');
  const b = a.cloneNode(true);
  assert.equal(b.style.cssText, 'display:none;');
  assert.equal(b.style.getPropertyValue('--x'), '1px');
});

test('inserting a fragment moves its children in order and empties it', () => {
  const doc = createDocument('<ul id="l"><li id="z"></li></ul>');
  const frag = doc.createDocumentFragment();
  for (const id of ['a', 'b']) {
    const li = doc.createElement('li');
    li.id = id;
    frag.appendChild(li);
  }
  const list = doc.getElementById('l');
  list.insertBefore(frag, doc.getElementById('z'));
  assert.deepEqual(
    list.children.map(c => c.id),
    ['a', 'b', 'z'],
  );
  assert.equal(frag.childNodes.length, 0);
  assert.equal(doc.getElementById('a').parentElement, list);
});
