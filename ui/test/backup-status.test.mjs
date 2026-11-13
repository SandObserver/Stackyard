import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { relativeLuminance, toneForLuminances } from '../js/label-contrast.js';

const page = fs.readFileSync(new URL('../widgets/backup/backup.html', import.meta.url), 'utf8');
const lift = re => {
  const m = re.exec(page)?.[0];
  assert.ok(m, `${re} is gone from the widget`);
  return m;
};

const rgbOf = hex => [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16));
const toneForColor = c => toneForLuminances([relativeLuminance(...rgbOf(c))]);
const NAMED = new Function(`${lift(/const NAMED = \{[^}]*\};/)}; return NAMED;`)();
const TINTS = lift(/const IDLE_TINT = [^;]*;/);
const statusInk = new Function('toneForColor', `${lift(/const statusInk = [^\n]*/)}; return statusInk;`)(toneForColor);

/* The rule the widget used before it took the shared one: whichever ink scores higher. */
function oldNeedsDark(hex) {
  const L = relativeLuminance(...rgbOf(hex));
  return (L + 0.05) / 0.0617 > 1.05 / (L + 0.05);
}

test('the four status colours keep the ink they had', () => {
  assert.deepEqual(Object.keys(NAMED).sort(), ['blue', 'green', 'red', 'yellow']);
  for (const [name, hex] of Object.entries(NAMED)) {
    assert.equal(statusInk(hex), oldNeedsDark(hex) ? '#1c1c1e' : '#fff', name);
  }
  assert.equal(statusInk(null), '#fff');
});

test('the widget keeps no luminance rule of its own', () => {
  assert.doesNotMatch(page, /function needsDark|Math\.pow\(\(v\+0\.055\)/);
});

function fakeEl() {
  const attrs = new Map();
  const props = new Map();
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    dir: '',
    clientWidth: 100,
    scrollWidth: 0,
    attrs,
    props,
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: k => props.delete(k),
    },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute(k) {
      attrs.delete(k);
      this[k] = '';
    },
  };
}

function backupCards(jobSlots) {
  const els = new Map();
  const document = {
    getElementById: id => {
      if (!els.has(id)) els.set(id, fakeEl());
      return els.get(id);
    },
  };
  const fns = [
    lift(/function slotList\(\) \{[\s\S]*?\n\}/),
    lift(/function fitName\([\s\S]*?\n\}/),
    lift(/function applyCard\(idx, job\) \{[\s\S]*?\n\}/),
    lift(/function applyCardIdle\(idx\) \{[\s\S]*?\n\}/),
    lift(/function applyError\(line\) \{[\s\S]*?\n\}/),
    lift(/function applyCardError\(idx, line\) \{[\s\S]*?\n\}/),
  ].join('\n');
  const api = new Function(
    'document',
    '_jobSlots',
    'CARD_COUNT',
    'html',
    'setHtml',
    'errorLine',
    'linkTo',
    'paintTimes',
    `let _isMobile=false, _shownJobs=null, _links=[], _canvases={};
     const cardLink=()=>'', statusColor=()=>null, statusInk=()=>'#fff', drawPh=()=>{};
     ${TINTS}
     ${fns}
     return { applyCard, applyError };`,
  )(
    document,
    jobSlots,
    jobSlots.length,
    (s, ...v) => s.reduce((out, part, i) => out + part + (i < v.length ? v[i] : ''), ''),
    (el, v) => {
      el.innerHTML = v;
    },
    () => 'Out of reach',
    () => {},
    (idx, job) => {
      const front = document.getElementById(`front-${idx}`);
      front.setAttribute('role', 'img');
      front.setAttribute('aria-label', job.name);
    },
  );
  return { ...api, el: id => document.getElementById(id) };
}

test('after a failure recovers, empty and unreported slots drop the error', () => {
  const cards = backupCards(['job-a', 'job-b', null]);
  cards.applyError('Out of reach');
  for (const idx of [0, 1, 2]) {
    assert.equal(cards.el(`front-${idx}`).attrs.get('aria-label'), 'Out of reach');
  }
  cards.applyCard(0, { name: 'Photos', status: 'healthy' });
  cards.applyCard(1, null);
  cards.applyCard(2, null);

  assert.equal(cards.el('front-0').attrs.get('aria-label'), 'Photos');
  for (const idx of [1, 2]) {
    const front = cards.el(`front-${idx}`);
    assert.equal(front.attrs.has('role'), false, `slot ${idx} keeps role=img`);
    assert.equal(front.attrs.has('aria-label'), false, `slot ${idx} keeps the old error`);
    assert.equal(cards.el(`back-meta-${idx}`).innerHTML, '&nbsp;<br>&nbsp;');
  }
  assert.equal(cards.el('front-name-1').textContent, '—');
  assert.equal(cards.el('back-name-1').textContent, '—');
  assert.equal(cards.el('front-name-2').textContent, '', 'an empty slot shows a dash');
  assert.equal(cards.el('back-name-2').textContent, '');
  assert.equal(cards.el('front-1').props.get('--status-color'), 'rgba(100,100,110,0.28)');
  assert.equal(cards.el('front-2').props.get('--status-color'), 'rgba(100,100,110,0.14)');
});

test('a backup card takes a finger through the shared two-tap reveal', () => {
  assert.match(page, /twoTap\(wrap, \{[^\n]*open: \(\) => openUrl\(cardLink\(idx\)\), timeout: 3000 \}\)/);
  assert.doesNotMatch(page, /addEventListener\('touch(start|move|end)'/);
});
