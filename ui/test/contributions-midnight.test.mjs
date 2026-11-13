import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as calendar from '../js/contribution-calendar.js';

const TZ = process.env.TZ;
after(() => {
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

const TOOLBOX_IMPORT = /^import \{([^}]+)\} from '\/js\/widget-toolbox\.js\?v=[0-9a-z]+';$/m;
const CALENDAR_IMPORT = /^import \{([^}]+)\} from '\/js\/contribution-calendar\.js\?v=[0-9a-z]+';$/m;
const DAY_MAP = 'const dayOf = new WeakMap();';

function pageScript() {
  const src = fs.readFileSync(new URL('../widgets/github/contributions.html', import.meta.url), 'utf8');
  const body = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  assert.match(body, TOOLBOX_IMPORT);
  assert.match(body, CALENDAR_IMPORT);
  assert.ok(body.includes(DAY_MAP), 'the cell-to-day map moved');
  return body
    .replace(TOOLBOX_IMPORT, (_m, names) => `const {${names}} = __toolbox;`)
    .replace(CALENDAR_IMPORT, (_m, names) => `const {${names}} = __calendar;`)
    .replace(DAY_MAP, 'const dayOf = __dayOf;');
}

function element() {
  const el = {
    className: '',
    textContent: '',
    attrs: {},
    children: [],
    classList: { add() {}, remove() {} },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    removeAttribute(k) {
      delete el.attrs[k];
    },
    addEventListener() {},
    append(...c) {
      el.children.push(...c);
    },
    replaceChildren() {
      el.children.length = 0;
    },
  };
  return el;
}

const RealDate = Date;
let clock = 0;
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(clock);
  }
  static now() {
    return clock;
  }
}

async function boot() {
  const els = new Map();
  const byId = id => els.get(id) || els.set(id, element()).get(id);
  const dayOf = new WeakMap();
  let render = null;
  const globals = {
    Date: FixedDate,
    location: { search: '?id=g1&size=medium' },
    document: {
      getElementById: byId,
      createElement: element,
      documentElement: { addEventListener() {} },
      addEventListener() {},
      body: element(),
    },
    window: { addEventListener() {} },
    __calendar: calendar,
    __dayOf: dayOf,
    __toolbox: {
      poll: opts => {
        render = opts.render;
      },
      fetchData: async () => ({}),
      linkTo() {},
      loadStrings: async () => {},
      wt: (_k, fallback) => fallback,
      formatNumber: n => String(n),
      errorState: () => ({ ok() {}, fail() {} }),
      fitText() {},
      cssZoom: () => 1,
    },
  };
  const saved = {};
  const swap = () => {
    for (const k of Object.keys(globals)) {
      saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
      Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true });
    }
  };
  const restore = () => {
    for (const k of Object.keys(globals)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  };
  const AsyncFunction = (async () => {}).constructor;
  swap();
  try {
    await new AsyncFunction(pageScript())();
  } finally {
    restore();
  }
  const plot = byId('widget').children.find(c => c.className === 'plot');
  return {
    draw(data) {
      swap();
      try {
        render(data);
      } finally {
        restore();
      }
      const cells = plot.children.flatMap(band => band.children.flatMap(week => week.children));
      return {
        total: byId('widget').children[0].children[1].children[0].textContent,
        days: cells.map(c => dayOf.get(c)).filter(Boolean),
        future: cells.filter(c => c.className === 'cell future').length,
      };
    },
  };
}

const at = (y, m, d, h, min = 0) => new RealDate(y, m - 1, d, h, min).getTime();

test('a page left open past midnight draws the new day as a real cell and counts it once', async () => {
  process.env.TZ = 'Europe/Berlin';
  clock = at(2026, 11, 12, 23, 50);
  const page = await boot();
  const slots = [[at(2026, 11, 12, 10) / 1000, 2]];

  const before = page.draw({ slots });
  assert.equal(before.total, '2');
  assert.equal(before.days.at(-1).date, '2026-11-12');

  clock = at(2026, 11, 13, 0, 10);
  const afterMidnight = page.draw({ slots: [...slots, [at(2026, 11, 13, 0, 5) / 1000, 3]] });
  assert.equal(afterMidnight.total, '5');
  const today = afterMidnight.days.filter(d => d.date === '2026-11-13');
  assert.deepEqual(today, [{ date: '2026-11-13', count: 3 }]);
  assert.equal(afterMidnight.days.at(-1).date, '2026-11-13');
  const drawn = afterMidnight.days.reduce((sum, d) => sum + d.count, 0);
  assert.equal(String(drawn), afterMidnight.total, 'the grid and the total agree');
  assert.equal(afterMidnight.future, 1, 'only Saturday is still to come');
});
