// @ts-check

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ id?: string, key?: string, title: string, subtitle?: string, progress: number|null,
    state: 'playing'|'paused', player?: string }} Session */
/** @typedef {'loading'|'idle'|'active'|'error'|'error0'} Mode */
/** @typedef {'none'|'arrive'|'leave'|'page'|'fade'} Transition */

const FULL_PACK_MM = 42;
const HUB_MM = 13;
const FLANGE_MM = 45;
const ROLLER_MM = 3;
const TAPE_MM_S = 33.35;

export const PACK_MAX = 55;
const PX_PER_MM = PACK_MAX / FULL_PACK_MM;
export const CENTRE = Object.freeze({ x: 85, y: 99 });
export const HUB_R = HUB_MM * PX_PER_MM;
export const FLANGE_R = Math.min(FLANGE_MM * PX_PER_MM, PACK_MAX + 4);
export const REEL_BOX = FLANGE_R * 2 + 2;
const ROLLER = Object.freeze({ x: 164, y: 153 });
const ROLLER_R = ROLLER_MM * PX_PER_MM;
const RUN_TO = Object.freeze({ x: 167.9, y: 0 });
const EMPTY_R = HUB_R + 0.8 * PX_PER_MM;
export const LEADER_R = HUB_R + 0.5 * PX_PER_MM;
/** One turn of the bare hub. */
export const HUB_TURN_MS = ((2 * Math.PI * HUB_MM) / TAPE_MM_S) * 1000;

const CLIP_RADIUS = HUB_R * 0.83;
const MAX_STEP_PX = 0.5;
const MAX_STEPS_PER_S = 30;
const MIN_STEPS_PER_TURN = 8;

const fixed = (/** @type {number} */ n) => (+n).toFixed(2);

/** The pack radius for a progress of 0..1. A session with no progress shows a
    half-full pack.
    @param {number|null|undefined} progress @returns {number} */
export function packRadius(progress) {
  const p = progress == null ? 0.5 : Math.min(1, Math.max(0, progress));
  return Math.sqrt(EMPTY_R * EMPTY_R + p * (PACK_MAX * PACK_MAX - EMPTY_R * EMPTY_R));
}

/** Turns per hub turn for a pack of this radius: the tape moves at one speed.
    @param {number} radius @returns {number} */
export function reelRate(radius) {
  return HUB_R / radius;
}

/** Steps per turn without a graphics chip.
    @param {number} rate from reelRate @returns {number} */
export function stepsPerTurn(rate) {
  const turnS = HUB_TURN_MS / Math.max(rate, 0.01) / 1000;
  const needed = (2 * Math.PI * CLIP_RADIUS) / MAX_STEP_PX / turnS;
  return Math.max(MIN_STEPS_PER_TURN, Math.round(Math.min(MAX_STEPS_PER_S, needed) * turnS));
}

/** The strand from the outside of the pack, round the roller to the front of
    the window, as an SVG path.
    @param {number} radius @returns {string} */
export function strandPath(radius) {
  const C = CENTRE;
  const dx = ROLLER.x - C.x;
  const dy = ROLLER.y - C.y;
  const len = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  const spread = Math.acos(Math.max(-1, Math.min(1, (radius - ROLLER_R) / len)));
  const a = Math.sin(heading + spread) >= Math.sin(heading - spread) ? heading + spread : heading - spread;
  const n = { x: Math.cos(a), y: Math.sin(a) };
  const p1 = { x: C.x + radius * n.x, y: C.y + radius * n.y };
  const p2 = { x: ROLLER.x + ROLLER_R * n.x, y: ROLLER.y + ROLLER_R * n.y };
  const front = { x: ROLLER.x + ROLLER_R, y: ROLLER.y };
  const sweep = n.y < 0 ? 1 : 0;
  return (
    `M${fixed(p1.x)} ${fixed(p1.y)} L${fixed(p2.x)} ${fixed(p2.y)} ` +
    `A${fixed(ROLLER_R)} ${fixed(ROLLER_R)} 0 0 ${sweep} ${fixed(front.x)} ${fixed(front.y)} ` +
    `L${fixed(RUN_TO.x)} ${fixed(RUN_TO.y)}`
  );
}

/** @param {number} ri @param {number} ro @param {number} a0 @param {number} a1 degrees */
function sector(ri, ro, a0, a1) {
  const at = (/** @type {number} */ r, /** @type {number} */ a) =>
    `${fixed(r * Math.cos((a * Math.PI) / 180))} ${fixed(r * Math.sin((a * Math.PI) / 180))}`;
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${at(ro, a0)} A${fixed(ro)} ${fixed(ro)} 0 ${big} 1 ${at(ro, a1)} L${at(ri, a1)} A${fixed(ri)} ${fixed(ri)} 0 ${big} 0 ${at(ri, a0)} Z`;
}

/** The reel: a clear top flange with cut-outs, a white hub with six knobs, and
    the leader clip in the provider's colour (--tint).
    @returns {string} SVG markup */
export function reelMarkup() {
  const r = HUB_R;
  const f = FLANGE_R;
  let cutouts = '';
  for (let k = 0; k < 3; k++) cutouts += sector(r * 1.18, r * 1.62, k * 120 - 116, k * 120 - 64) + ' ';
  for (let k = 0; k < 3; k++) cutouts += sector(f * 0.62, f * 0.8, k * 120 - 44, k * 120 - 16) + ' ';
  const disc = `M${fixed(f)} 0 A${fixed(f)} ${fixed(f)} 0 1 1 ${fixed(-f)} 0 A${fixed(f)} ${fixed(f)} 0 1 1 ${fixed(f)} 0 Z`;
  let knobs = '';
  for (let k = 0; k < 6; k++) {
    const a = ((k * 60 + 30) * Math.PI) / 180;
    const x = r * 0.46 * Math.cos(a);
    const y = r * 0.46 * Math.sin(a);
    const kr = r * 0.13;
    knobs +=
      `<circle cx="${fixed(x)}" cy="${fixed(y)}" r="${fixed(kr)}" fill="#D9D9DE"/>` +
      `<circle cx="${fixed(x - kr * 0.3)}" cy="${fixed(y - kr * 0.32)}" r="${fixed(kr * 0.42)}" fill="#FFFFFF" opacity=".75"/>`;
  }
  const o = fixed(-f - 1);
  const b = fixed(REEL_BOX);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${b} ${b}" width="${b}" height="${b}" aria-hidden="true">` +
    `<path fill-rule="evenodd" d="${disc} ${cutouts}" fill="rgba(255,255,255,.028)" stroke="rgba(255,255,255,.15)" stroke-width=".7"/>` +
    `<circle r="${fixed(r)}" fill="#ECECF0" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>` +
    `<circle r="${fixed(r * 0.7)}" fill="#E2E2E7" stroke="rgba(0,0,0,.18)" stroke-width=".5"/>` +
    `<path d="${sector(r * 0.66, r * 0.995, 64, 116)}" fill="var(--tint)" stroke="rgba(0,0,0,.45)" stroke-width=".5"/>` +
    knobs +
    `<circle r="${fixed(r * 0.16)}" fill="#D9D9DE"/>` +
    `<circle cx="${fixed(-r * 0.05)}" cy="${fixed(-r * 0.05)}" r="${fixed(r * 0.07)}" fill="#FFFFFF" opacity=".75"/>` +
    `</svg>`
  );
}

/** What tells two sessions apart. Older servers send no id.
    @param {Session} s @returns {string} */
export function sessionKey(s) {
  return s.key || s.id || `${s.player || ''}\u0000${s.title}`;
}

/** The sessions of one poll, each with a key no other session in it shares.
    @param {Session[]} sessions @returns {Session[]} */
export function withKeys(sessions) {
  const seen = new Map();
  return sessions.map(s => {
    const base = sessionKey({ ...s, key: undefined });
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return { ...s, key: n ? `${base}\u0000${n}` : base };
  });
}

/** The session to show after an update: the same one if it is still playing,
    else the one now in its place.
    @param {string|null} shownKey @param {Session[]} sessions @param {number} index
    @returns {number} */
export function pickIndex(shownKey, sessions, index) {
  const same = shownKey == null ? -1 : sessions.findIndex(s => sessionKey(s) === shownKey);
  if (same >= 0) return same;
  return Math.max(0, Math.min(index, sessions.length - 1));
}

/** @typedef {{ mode: Mode, key: string|null, title: string|null }} Shown */

/** The label animation between two views. Only paging by hand slides sideways.
    @param {Shown|null} from @param {Shown} to @param {boolean} [paged] @returns {Transition} */
export function transitionKind(from, to, paged = false) {
  if (!from) return 'none';
  if (from.mode !== to.mode) {
    if (from.mode === 'idle' && to.mode === 'active') return 'arrive';
    if (from.mode === 'active' && to.mode === 'idle') return 'leave';
    return 'fade';
  }
  if (to.mode !== 'active') return 'none';
  if (to.key !== from.key) return paged ? 'page' : 'fade';
  if (to.title !== from.title) return 'fade';
  return 'none';
}

/** What a screen reader is told about. Progress is not part of it.
    @param {Mode} mode @param {Session|null} session @param {number} count @returns {string} */
export function spokenKey(mode, session, count) {
  return session ? `${mode}|${sessionKey(session)}|${session.title}|${session.state}|${count}` : `${mode}|${count}`;
}

/** Announce a change of what plays, not the first data after loading and not a
    failure, which renames the widget instead.
    @param {{ mode: Mode, said?: string }|null} from @param {{ mode: Mode, said?: string }} to
    @returns {boolean} */
export function shouldAnnounce(from, to) {
  if (!from || from.mode === 'loading') return false;
  if (to.mode !== 'active' && to.mode !== 'idle') return false;
  return from.said !== to.said;
}

const MAX_RATE = 1 / 20;
const MIN_GAP_S = 0.5;
const GROW_STEP_PX = 0.3;
const TICK_MIN_MS = 500;
const TICK_MAX_MS = 10000;
const MAX_AHEAD_MS = 30000;

/** Winds the pack between polls at the rate the last polls showed. */
export class Winding {
  constructor() {
    /** @type {Map<string, { p: number, t: number, rate: number, title: string, playing: boolean }>} */
    this.seen = new Map();
  }

  /** Records one poll. Sessions that ended are forgotten.
      @param {Session[]} sessions @param {number} now ms */
  observe(sessions, now) {
    const keep = new Set();
    for (const s of sessions) {
      const key = sessionKey(s);
      keep.add(key);
      if (s.progress == null) {
        this.seen.delete(key);
        continue;
      }
      const last = this.seen.get(key);
      const playing = s.state === 'playing';
      let rate = 0;
      if (last && last.title === s.title && last.playing && playing) {
        const gap = (now - last.t) / 1000;
        if (gap > MIN_GAP_S) {
          const r = (s.progress - last.p) / gap;
          rate = r >= 0 && r < MAX_RATE ? (last.rate ? (last.rate + r) / 2 : r) : 0;
        } else rate = last.rate;
      }
      this.seen.set(key, { p: s.progress, t: now, rate, title: s.title, playing });
    }
    for (const key of this.seen.keys()) if (!keep.has(key)) this.seen.delete(key);
  }

  /** @param {Session} s @param {number} now @returns {number|null} */
  progress(s, now) {
    const e = this.seen.get(sessionKey(s));
    if (!e || s.progress == null) return s.progress;
    if (s.state !== 'playing' || !e.rate) return e.p;
    return Math.min(1, e.p + (e.rate * Math.min(now - e.t, MAX_AHEAD_MS)) / 1000);
  }

  /** Milliseconds until the pack has grown enough to redraw, or null when it
      is not growing.
      @param {Session} s @param {number} now @returns {number|null} */
  nextRedraw(s, now) {
    const e = this.seen.get(sessionKey(s));
    if (!e || !e.rate || s.state !== 'playing' || now - e.t >= MAX_AHEAD_MS) return null;
    const r = packRadius(this.progress(s, now));
    const pxPerS = ((PACK_MAX * PACK_MAX - EMPTY_R * EMPTY_R) / (2 * r)) * e.rate;
    return Math.min(TICK_MAX_MS, Math.max(TICK_MIN_MS, (GROW_STEP_PX / Math.max(pxPerS, 1e-6)) * 1000));
  }

  clear() {
    this.seen.clear();
  }
}
