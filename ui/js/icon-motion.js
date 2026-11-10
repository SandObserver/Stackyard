// @ts-check

import { ICONS, symbol } from '/js/icon-set.js?v=b7e5d7d1';

const IN_OUT = 'cubic-bezier(.77,0,.175,1)';
const CUBIC = 'cubic-bezier(.65,0,.35,1)';
const SEG = 'cubic-bezier(.33,0,.2,1)';

/** @typedef {{ accent: string }} Ctx */
/** @typedef {Keyframe[] | PropertyIndexedKeyframes | ((ctx: Ctx) => Keyframe[] | PropertyIndexedKeyframes)} Frames */
/** @typedef {{ morph: string, reverse?: boolean }} Morph */
/** @typedef {[part: string, frames: Frames | Morph, timing: KeyframeAnimationOptions & { spline?: string, trail?: boolean }]} Step */
/** @typedef {{ origin?: Record<string, [box: string, origin: string]>, go: Step[], back: Step[] }} Motion */

const px = (x, y) => `${x}px ${y}px`;

/** @param {string} part @param {Record<string, string>} from @param {Record<string, string>} to @param {number} ms
    @returns {{ go: Step[], back: Step[] }} */
function trip(part, from, to, ms, easing = IN_OUT) {
  const kf = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, [a[k], b[k]]]));
  return {
    go: [[part, kf(from, to), { duration: ms, easing }]],
    back: [[part, kf(to, from), { duration: ms, easing }]],
  };
}

/** @param {number} from @param {number} step @param {number} count @returns {Keyframe[]} */
function ticks(from, step, count) {
  const out = [];
  let prev = from;
  for (let i = 0; i < count; i++) {
    const st = i / count;
    const w = 1 / count;
    const a = from + (i + 1) * step;
    out.push(
      { rotate: `${prev}deg`, offset: st, easing: 'ease-out' },
      { rotate: `${a + step * 0.2}deg`, offset: st + w * 0.38, easing: 'ease-in-out' },
      { rotate: `${a}deg`, offset: st + w * 0.62, easing: 'linear' },
    );
    prev = a;
  }
  out.push({ rotate: `${prev}deg`, offset: 1 });
  return out;
}

const BRANCH = [
  [17, 14],
  [11, 14],
  [7, 14],
  [7, 10],
];
const onBranch = t =>
  [0, 1].map(
    k =>
      (1 - t) ** 3 * BRANCH[0][k] +
      3 * (1 - t) ** 2 * t * BRANCH[1][k] +
      3 * (1 - t) * t ** 2 * BRANCH[2][k] +
      t ** 3 * BRANCH[3][k],
  );
const easeInOut3 = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const r3 = n => +n.toFixed(3);
const merge = Array.from({ length: 17 }, (_, i) => {
  const u = i / 16;
  const [x, y] = onBranch(easeInOut3(u));
  const a = u < 0.72 ? 1 : Math.max(0, 1 - (u - 0.72) / 0.28);
  return {
    commit: {
      translate: px(r3(x - 17), r3(y - 14)),
      scale: `${r3(0.4 + 0.6 * a)}`,
      opacity: `${r3(a)}`,
      offset: u,
      easing: 'linear',
    },
    branch: { clipPath: `inset(-3px ${r3(((17 - x) / 10) * 100)}% -3px -3px)`, offset: u, easing: 'linear' },
  };
});
const GROWN = 'inset(-3px 0% -3px -3px)';
const GONE = 'inset(-3px 100% -3px -3px)';

const SLOT = { c: [7, 4, 10, 16, 3], l: [2, 7, 3, 10, 1], r: [19, 7, 3, 10, 1] };
/** @param {'c'|'l'|'r'} k */
const slot = k => {
  const [x, y, width, height, rx] = SLOT[k].map(n => `${n}px`);
  return { x, y, width, height, rx };
};
/** @param {'c'|'l'|'r'} a @param {'c'|'l'|'r'} b @param {'lit'|'unlit'|'fade'} how @returns {Frames} */
const turn = (a, b, how) => ctx => {
  const fill = { lit: ['currentColor', ctx.accent], unlit: [ctx.accent, 'currentColor'] }[how];
  const ends = [slot(a), slot(b)].map((s, i) => ({ ...s, ...(fill ? { fill: fill[i] } : {}) }));
  if (how !== 'fade') return [{ ...ends[0], easing: IN_OUT }, ends[1]];
  return [
    { ...ends[0], opacity: 1, offset: 0, easing: IN_OUT },
    { opacity: 0, offset: 0.3, easing: 'ease' },
    { opacity: 0, offset: 0.7, easing: 'ease' },
    { ...ends[1], opacity: 1, offset: 1 },
  ];
};

const PAUSE = 'M9 9L10 9L10 15L9 15ZM14 9L15 9L15 15L14 15Z';

const books = t => `translate(17px, 21px) rotate(${t}deg) translate(-17px, -21px)`;
/** @type {[string, string]} */
const CENTRE = ['fill-box', 'center'];
const corners = { tl: [4.5, 4.5], tr: [-4.5, 4.5], bl: [4.5, -4.5], br: [-4.5, -4.5] };

/** @type {Record<string, Motion>} */
export const MOTION = {
  general: {
    origin: { knob: ['fill-box', 'center'] },
    go: [
      ['knob', { translate: ['0px 0px', '-9px 0px'] }, { duration: 400, easing: IN_OUT }],
      ['knob', { scale: ['1 1', '1.26 0.9', '1 1'], easing: 'ease-in-out' }, { duration: 400 }],
    ],
    back: [
      ['knob', { translate: ['-9px 0px', '0px 0px'] }, { duration: 400, easing: IN_OUT }],
      ['knob', { scale: ['1 1', '1.18 0.93', '1 1'], easing: 'ease-in-out' }, { duration: 400 }],
    ],
  },
  appearance: {
    origin: { half: ['view-box', '12px 12px'] },
    go: [
      ['half', { rotate: ['0deg', '90deg'] }, { duration: 420, easing: IN_OUT }],
      [
        'half',
        {
          transform: ['rotate(0deg)', 'rotate(9deg)', 'rotate(-5deg)', 'rotate(2deg)', 'rotate(0deg)'],
          offset: [0, 0.22, 0.5, 0.76, 1],
          easing: 'ease-in-out',
        },
        { duration: 750, delay: 340, trail: true },
      ],
    ],
    back: [['half', { rotate: ['90deg', '0deg'] }, { duration: 420, easing: IN_OUT }]],
  },
  dashboard: {
    go: [
      ...trip('left', { translate: '0px 0px' }, { translate: '10px 0px' }, 440).go,
      ...trip('right', { translate: '0px 0px' }, { translate: '-10px 0px' }, 440).go,
    ],
    back: [
      ...trip('left', { translate: '0px 0px' }, { translate: '10px 0px' }, 440).back,
      ...trip('right', { translate: '0px 0px' }, { translate: '-10px 0px' }, 440).back,
    ],
  },
  app: {
    origin: { body: CENTRE, badge: CENTRE },
    go: [
      ...trip('body', { translate: '0px 0px', scale: '1' }, { translate: '1.5px -1.5px', scale: '1.333' }, 440).go,
      ...trip(
        'badge',
        { translate: '0px 0px', scale: '1', opacity: '1' },
        { translate: '-3px 3px', scale: '0.5', opacity: '0' },
        440,
      ).go,
    ],
    back: [
      ...trip('body', { translate: '0px 0px', scale: '1' }, { translate: '1.5px -1.5px', scale: '1.333' }, 440).back,
      ...trip(
        'badge',
        { translate: '0px 0px', scale: '1', opacity: '1' },
        { translate: '-3px 3px', scale: '0.5', opacity: '0' },
        440,
      ).back,
    ],
  },
  folder: {
    origin: { tl: CENTRE, tr: CENTRE, bl: CENTRE, br: CENTRE },
    go: Object.entries(corners).flatMap(([part, [x, y]]) => [
      [part, { translate: ['0px 0px', px(x, y)] }, { duration: 400, easing: IN_OUT }],
      [part, { scale: ['1', '1.57'] }, { duration: 260, delay: 360, easing: IN_OUT }],
    ]),
    back: Object.entries(corners).flatMap(([part, [x, y]]) => [
      [part, { scale: ['1.57', '1'] }, { duration: 240, easing: IN_OUT }],
      [part, { translate: [px(x, y), '0px 0px'] }, { duration: 400, delay: 200, easing: IN_OUT }],
    ]),
  },
  backup: {
    origin: { minute: ['view-box', '12px 12px'] },
    go: [
      ['hands', { visibility: ['hidden', 'hidden'] }, { duration: 800 }],
      ['hour', { visibility: ['visible', 'visible'] }, { duration: 800 }],
      ['minute', [...ticks(0, -60, 3)].map(k => ({ ...k, visibility: 'visible' })), { duration: 800 }],
    ],
    back: [
      ['hands', { visibility: ['hidden', 'hidden'] }, { duration: 800 }],
      ['hour', { visibility: ['visible', 'visible'] }, { duration: 800 }],
      ['minute', [...ticks(-180, -60, 3)].map(k => ({ ...k, visibility: 'visible' })), { duration: 800 }],
    ],
  },
  books: {
    origin: { lean: ['view-box', '0px 0px'] },
    go: [
      ['tall', { translate: ['0px 0px', '0px -1.5px'] }, { duration: 380, easing: IN_OUT }],
      [
        'lean',
        [
          { transform: books(-15), easing: 'ease-out' },
          { transform: books(-13.5), offset: 0.4, easing: 'ease-in-out' },
          { transform: books(-15) },
        ],
        { duration: 380 },
      ],
    ],
    back: [['tall', { translate: ['0px -1.5px', '0px 0px'] }, { duration: 400, easing: IN_OUT }]],
  },
  clock: {
    origin: { minute: ['view-box', '12px 12px'] },
    go: [['minute', { rotate: ['0deg', '180deg'] }, { duration: 750, easing: 'cubic-bezier(.4,0,.6,1)' }]],
    back: [['minute', { rotate: ['180deg', '360deg'] }, { duration: 750, easing: 'cubic-bezier(.4,0,.6,1)' }]],
  },
  connections: {
    origin: { server: CENTRE },
    go: [
      [
        'server',
        [{ scale: '1', easing: 'ease-out' }, { scale: '1.3', offset: 0.45, easing: 'ease-in-out' }, { scale: '1.15' }],
        { duration: 600 },
      ],
    ],
    back: [['server', { scale: ['1.15', '1'] }, { duration: 400, easing: IN_OUT }]],
  },
  switcher: {
    go: [
      ['card', turn('c', 'l', 'unlit'), { duration: 550 }],
      ['right', turn('r', 'c', 'lit'), { duration: 550 }],
      ['left', turn('l', 'r', 'fade'), { duration: 550 }],
    ],
    back: [
      ['card', turn('l', 'r', 'fade'), { duration: 550 }],
      ['right', turn('c', 'l', 'unlit'), { duration: 550 }],
      ['left', turn('r', 'c', 'lit'), { duration: 550 }],
    ],
  },
  disk: {
    origin: { bay: CENTRE },
    ...trip('bay', { scale: '1' }, { scale: '1.25' }, 300),
  },
  github: {
    origin: { commit: CENTRE },
    go: [
      ['commit', merge.map(f => f.commit), { duration: 600 }],
      ['branch', merge.map(f => f.branch), { duration: 600 }],
    ],
    back: [
      [
        'commit',
        [
          { translate: '-10px -4px', scale: '0.4', opacity: '0', offset: 0, easing: 'steps(1, end)' },
          { translate: '0px 0px', scale: '0.4', opacity: '0', offset: 0.01 },
          { translate: '0px 0px', scale: '0.4', opacity: '0', offset: 0.58, easing: 'cubic-bezier(.23,1,.32,1)' },
          { translate: '0px 0px', scale: '1.15', opacity: '1', offset: 0.84, easing: 'ease-in-out' },
          { translate: '0px 0px', scale: '1', opacity: '1', offset: 1 },
        ],
        { duration: 750 },
      ],
      [
        'branch',
        [
          { clipPath: GONE, offset: 0, easing: 'cubic-bezier(.4,0,.2,1)' },
          { clipPath: GROWN, offset: 0.62 },
          { clipPath: GROWN, offset: 1 },
        ],
        { duration: 750 },
      ],
    ],
  },
  downloads: {
    go: [['parcel', { translate: ['0px 0px', '2px 0px'] }, { duration: 450, easing: IN_OUT }]],
    back: [
      [
        'parcel',
        [
          { translate: '2px 0px', offset: 0, easing: 'cubic-bezier(.55,0,1,.45)' },
          { translate: '20px 0px', offset: 0.46 },
          { translate: '-20px 0px', offset: 0.4601, easing: 'cubic-bezier(0,.55,.45,1)' },
          { translate: '0px 0px', offset: 1 },
        ],
        { duration: 900 },
      ],
    ],
  },
  nowplaying: {
    go: [
      ['rest', { visibility: ['hidden', 'hidden'] }, { duration: 250 }],
      ['play', { visibility: ['visible', 'visible'] }, { duration: 250 }],
      ['play', { morph: PAUSE }, { duration: 250, spline: '.23 1 .32 1' }],
    ],
    back: [
      ['rest', { visibility: ['hidden', 'hidden'] }, { duration: 250 }],
      ['play', { visibility: ['visible', 'visible'] }, { duration: 250 }],
      ['play', { morph: PAUSE, reverse: true }, { duration: 250, spline: '.23 1 .32 1' }],
    ],
  },
  upnext: {
    go: [
      ['page', { translate: ['0px 0px', '0px -13px'] }, { duration: 600, easing: CUBIC }],
      [
        'next',
        { translate: ['0px 0px', '0px -13px'], visibility: ['visible', 'visible'] },
        { duration: 600, easing: CUBIC },
      ],
    ],
    back: [
      ['page', { translate: ['0px 13px', '0px 0px'] }, { duration: 600, easing: CUBIC }],
      [
        'next',
        { translate: ['0px -13px', '0px -26px'], visibility: ['visible', 'visible'] },
        { duration: 600, easing: CUBIC },
      ],
    ],
  },
  system: {
    go: [
      ['line', { visibility: ['hidden', 'hidden'] }, { duration: 450 }],
      [
        'trend',
        { translate: ['0px 0px', '-4px 0.444px'], visibility: ['visible', 'visible'] },
        { duration: 450, easing: IN_OUT },
      ],
      ['dot', { translate: ['0px 0px', '0px 8.444px'] }, { duration: 450, easing: IN_OUT }],
    ],
    back: [
      ['line', { visibility: ['hidden', 'hidden'] }, { duration: 500 }],
      [
        'trend',
        { translate: ['-4px 0.444px', '-9px 1px'], visibility: ['visible', 'visible'] },
        { duration: 500, easing: IN_OUT },
      ],
      ['dot', { translate: ['0px 8.444px', '0px 0px'] }, { duration: 500, easing: IN_OUT }],
    ],
  },
  weather: trip('cloud', { translate: '0px 0px' }, { translate: '-2.5px 0px' }, 600),
  start: {
    go: [
      [
        'bar',
        [
          { width: '6px', offset: 0, easing: SEG },
          { width: '9px', offset: 0.28 },
          { width: '9px', offset: 0.4, easing: SEG },
          { width: '12px', offset: 0.66 },
          { width: '12px', offset: 0.76, easing: SEG },
          { width: '14px', offset: 1 },
        ],
        { duration: 700 },
      ],
    ],
    back: [['bar', { width: ['14px', '6px'] }, { duration: 400, easing: IN_OUT }]],
  },
  run: trip('prompt', { translate: '0px 0px' }, { translate: '1px 0px' }, 300),
  widget: trip('line', { translate: '0px 0px' }, { translate: '4px 0px' }, 400, 'cubic-bezier(.23,1,.32,1)'),
  create: {
    origin: { plus: ['view-box', '19px 5px'] },
    ...trip('plus', { scale: '1' }, { scale: '1.15' }, 300),
  },
};

let seq = 0;

/** @param {SVGSVGElement} svg @param {string} id @returns {boolean} */
function inline(svg, id) {
  const sid = `sy-solid-${id}`;
  const uid = `${sid}-x${seq++}`;
  const { defs, sym } = symbol(id, ICONS[id], 'solid', false, 2, { motion: true });
  /* Mask and clip ids must be unique per copy. A repeated id paints every copy with the first one's mask. */
  const body = `<defs>${defs}</defs>${sym.replace(/^<symbol[^>]*>|<\/symbol>$/g, '')}`.split(sid).join(uid);
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return false;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.replaceChildren(...Array.from(doc.documentElement.childNodes, n => svg.ownerDocument.importNode(n, true)));
  return true;
}

/* Safari cannot animate `d` with CSS. Keep SMIL here. */
/** @param {Element} el @param {Morph} m @param {number} ms @param {string} spline
    @returns {{ finished: Promise<unknown>, cancel: () => void }} */
function morph(el, m, ms, spline) {
  const own = el.getAttribute('d') || '';
  const a = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'animate');
  const values = m.reverse ? [m.morph, own] : [own, m.morph];
  for (const [k, v] of Object.entries({
    attributeName: 'd',
    values: values.join(';'),
    dur: `${ms}ms`,
    begin: 'indefinite',
    fill: 'freeze',
    calcMode: 'spline',
    keyTimes: '0;1',
    keySplines: spline,
  }))
    a.setAttribute(k, v);
  el.append(a);
  /** @type {any} */ (a).beginElement();
  return { finished: new Promise(r => setTimeout(r, ms)), cancel: () => a.remove() };
}

/** @type {{ hover: MediaQueryList, reduce: MediaQueryList, resets: Map<SVGSVGElement, () => void> } | null} */
let media = null;
const env = () => {
  if (media) return media;
  const m = {
    hover: matchMedia('(hover: hover) and (pointer: fine)'),
    reduce: matchMedia('(prefers-reduced-motion: reduce)'),
    resets: new Map(),
  };
  m.reduce.addEventListener('change', () => {
    if (!m.reduce.matches) return;
    for (const [svg, reset] of m.resets) if (svg.isConnected) reset();
  });
  media = m;
  return m;
};
const canPlay = () => env().hover.matches && !env().reduce.matches;

/** @param {SVGSVGElement} svg @param {string} id @param {Element} [trigger] */
export function animateIcon(svg, id, trigger = svg) {
  const m = MOTION[id];
  if (!m || !ICONS[id] || typeof svg.animate !== 'function' || !inline(svg, id)) return;
  for (const [part, [box, origin]] of Object.entries(m.origin || {})) {
    for (const el of svg.querySelectorAll(`[data-part="${part}"]`)) {
      const s = /** @type {SVGElement} */ (el).style;
      s.transformBox = box;
      s.transformOrigin = origin;
    }
  }
  /** @type {Ctx | null} */
  let ctx = null;
  let want = false;
  let at = false;
  let busy = false;
  let epoch = 0;
  /** @type {{ finished: Promise<unknown>, cancel: () => void }[]} */
  let live = [];
  const settle = () => {
    for (const a of live) a.cancel();
    live = [];
  };
  const run = async () => {
    if (busy || want === at) return;
    const dir = want;
    if (!canPlay() || (!dir && !live.length)) {
      settle();
      at = dir;
      return;
    }
    busy = true;
    const mine = epoch;
    if (!ctx) {
      const a = svg.querySelector('.sy-a');
      ctx = { accent: a ? getComputedStyle(a).fill : 'currentColor' };
    }
    const c = ctx;
    /** @type {{ finished: Promise<unknown>, cancel: () => void }[]} */
    const leg = [];
    for (const [part, frames, timing] of dir ? m.go : m.back) {
      const { spline = '', trail = false, ...t } = timing;
      for (const el of svg.querySelectorAll(`[data-part="${part}"]`)) {
        const a =
          'morph' in frames
            ? morph(el, /** @type {Morph} */ (frames), Number(t.duration), spline)
            : el.animate(/** @type {Keyframe[]} */ (typeof frames === 'function' ? frames(c) : frames), {
                ...t,
                fill: 'forwards',
              });
        live.push(a);
        if (!trail) leg.push(a);
      }
    }
    await Promise.all(leg.map(a => a.finished)).catch(() => {});
    if (mine !== epoch) return;
    if (!dir) {
      await Promise.all(live.map(a => a.finished)).catch(() => {});
      if (mine !== epoch) return;
      settle();
    }
    at = dir;
    busy = false;
    run();
  };
  const reset = () => {
    epoch++;
    busy = false;
    settle();
    at = want;
  };
  trigger.addEventListener('pointerenter', e => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'touch' || !canPlay()) return;
    const { resets } = env();
    for (const old of resets.keys()) if (!old.isConnected) resets.delete(old);
    resets.set(svg, reset);
    want = true;
    run();
  });
  trigger.addEventListener('pointerleave', () => {
    want = false;
    run();
  });
}
