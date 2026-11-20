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
