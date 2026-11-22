import { poll, fetchData, getConfig, reducedMotion, softwareRendering, linkTo, parseMarkup, raw, loadStrings, wt, wtCount, errorState, errorLine, localiseDigits, placeholder, whileOnScreen, failureName } from '/js/widget-toolbox.js?v=039ea657';
import { CENTRE, FLANGE_R, HUB_TURN_MS, LEADER_R, PACK_MAX, REEL_BOX, Winding, packRadius, pickIndex, reelMarkup, reelRate, sessionKey, shouldAnnounce, spokenKey, stepsPerTurn, strandPath, transitionKind, withKeys } from './reel-logic.js';

await loadStrings();
const $ = id => document.getElementById(id);
const wEl = $('w'), linkEl = $('np-link'), windowEl = $('window');
const lblEl = $('lbl'), titleEl = $('title'), subEl = $('sub'), capEl = $('np-cap');
const playerEl = $('player'), ctlEl = $('ctl'), countEl = $('count'), srEl = $('sr');
const strandEl = $('strand'), tapeEl = $('tape'), clearEl = $('clear'), ringEl = $('ring'), reelEl = $('reel');
wEl.setAttribute('aria-label', wt('widget.label', 'Now Playing'));
$('prev').setAttribute('aria-label', wt('ui.previous', 'Previous item'));
$('next').setAttribute('aria-label', wt('ui.next', 'Next item'));

const TICK_MS = 10000;
const COLORS = { plex: '#e5a00d', jellyfin: '#007ca6', emby: '#4caf50', navidrome: '#0091FF' };
const PROVIDER_NAME = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby', navidrome: 'Navidrome' };
/* White on Plex, Emby and Navidrome is below 4.5:1. */
const INK = { plex: '#1C1C1E', jellyfin: '#FFFFFF', emby: '#1C1C1E', navidrome: '#1C1C1E' };

const box = (el, x, y, size) => Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
for (const el of [tapeEl, clearEl, ringEl]) box(el, CENTRE.x - PACK_MAX, CENTRE.y - PACK_MAX, 2 * PACK_MAX);
const ringSvg = ringEl.firstElementChild, ringCircle = ringSvg.firstElementChild;
ringSvg.setAttribute('viewBox', `0 0 ${2 * PACK_MAX} ${2 * PACK_MAX}`);
ringSvg.setAttribute('width', 2 * PACK_MAX);
ringSvg.setAttribute('height', 2 * PACK_MAX);
for (const [k, v] of [['cx', PACK_MAX], ['cy', PACK_MAX], ['r', PACK_MAX - 0.25]]) ringCircle.setAttribute(k, v);
box(reelEl, CENTRE.x - FLANGE_R - 1, CENTRE.y - FLANGE_R - 1, REEL_BOX);
reelEl.append(document.importNode(parseMarkup(raw(reelMarkup()), 'image/svg+xml').documentElement, true));

let calm = reducedMotion(on => {
  calm = on;
  if (on) stopReel();
  else if (spinning) {
    spinning = false;
    spin(true);
  }
});
const soft = softwareRendering();
let onScreen = true;

const PACK_MS = 450, PACK_EASE = 'cubic-bezier(.33,1,.68,1)', JUMP_PX = 1.5;
const STRAND_OUT = 0.2, STRAND_IN = 0.75;
let packR = null, packAnims = [], strandTimer = 0;
const clipAt = r => `circle(${r.toFixed(2)}px at 50% 50%)`;
const scaleAt = r => `scale(${(r / PACK_MAX).toFixed(4)})`;
function packTo(r, animate, bothLayers) {
  if (packR !== null && Math.abs(r - packR) < 0.05) return;
  const from = packR;
  packR = r;
  for (const a of packAnims) a.cancel();
  packAnims = [];
  clearTimeout(strandTimer);
  const clip = clipAt(r);
  tapeEl.style.clipPath = clip;
  clearEl.style.clipPath = clip;
  ringEl.style.transform = scaleAt(r);
  if (from === null || !animate || calm || Math.abs(r - from) < JUMP_PX) {
    strandEl.setAttribute('d', strandPath(r));
    return;
  }
  const timing = { duration: PACK_MS, easing: PACK_EASE };
  const layers = bothLayers ? [tapeEl, clearEl] : [wEl.classList.contains('leader') ? clearEl : tapeEl];
  for (const el of layers) packAnims.push(el.animate({ clipPath: [clipAt(from), clip] }, timing));
  packAnims.push(ringEl.animate({ transform: [scaleAt(from), scaleAt(r)] }, timing));
  packAnims.push(strandEl.animate([{ opacity: 1 }, { opacity: 0, offset: STRAND_OUT }, { opacity: 0, offset: STRAND_IN }, { opacity: 1 }], { duration: PACK_MS }));
  strandTimer = setTimeout(() => strandEl.setAttribute('d', strandPath(r)), (PACK_MS * (STRAND_OUT + STRAND_IN)) / 2);
}

/* Each /3 below matches its curve's end slope of 3. Change them together or the reel jumps. */
const DEG_PER_MS = 360 / HUB_TURN_MS;
const SPIN_UP_MS = 600, SPIN_UP_EASE = 'cubic-bezier(.32,0,.67,0)';
const SPIN_DOWN_MS = 350, SPIN_DOWN_EASE = 'cubic-bezier(.33,1,.68,1)';
let loop = null, segment = null, spinning = false, rate = 1, loopSteps = 0;
const turn = deg => ({ rotate: `${deg.toFixed(2)}deg` });
function stopReel() {
  const now = Number.parseFloat(getComputedStyle(reelEl).rotate);
  const angle = Number.isFinite(now) ? now : 0;
  loop?.cancel();
  segment?.cancel();
  loop = segment = null;
  reelEl.style.rotate = `${angle.toFixed(2)}deg`;
  return angle;
}
function startLoop(from) {
  const timing = { duration: HUB_TURN_MS, iterations: Infinity };
  loopSteps = soft ? stepsPerTurn(rate) : 0;
  if (loopSteps) timing.easing = `steps(${loopSteps})`;
  loop = reelEl.animate([turn(from), turn(from + 360)], timing);
  loop.playbackRate = rate;
  if (!onScreen) loop.pause();
}
function runSegment(from, to, duration, easing, then) {
  const anim = reelEl.animate([turn(from), turn(to)], { duration, easing, fill: 'forwards' });
  segment = anim;
  anim.onfinish = () => {
    if (segment !== anim) return;
    reelEl.style.rotate = `${to.toFixed(2)}deg`;
    anim.cancel();
    segment = null;
    then?.(to);
  };
  if (!onScreen) anim.pause();
}
function spin(want) {
  if (calm) {
    if (loop || segment) stopReel();
  } else if (want && !spinning) {
    const from = stopReel();
    runSegment(from, from + (DEG_PER_MS * rate * SPIN_UP_MS) / 3, SPIN_UP_MS, SPIN_UP_EASE, startLoop);
  } else if (!want && spinning && (loop || segment)) {
    const speed = DEG_PER_MS * (loop ? loop.playbackRate : rate);
    const from = stopReel();
    runSegment(from, from + (speed * SPIN_DOWN_MS) / 3, SPIN_DOWN_MS, SPIN_DOWN_EASE, null);
  } else if (want && loop && Math.abs(loop.playbackRate - rate) > rate * 0.005) {
    if (soft && Math.abs(stepsPerTurn(rate) - loopSteps) > loopSteps * 0.08) startLoop(stopReel());
    else loop.updatePlaybackRate(rate);
  }
  spinning = want;
}

const EASE_EXIT = 'cubic-bezier(.23,1,.32,1)', EASE_ENTER = 'cubic-bezier(.32,.72,0,1)';
const MOVES = {
  page: d => [`${-6 * d}px 0`, `${6 * d}px 0`],
  arrive: () => ['0 -4px', '0 4px'],
  leave: () => ['0 4px', '0 -4px'],
  fade: () => ['0 0', '0 0'],
};
let swapId = 0, running = [];
function swapLabel(kind, dir, apply) {
  if (kind === 'none') {
    apply();
    return;
  }
  const rtl = getComputedStyle(wEl).direction === 'rtl' ? -1 : 1;
  const [outTo, inFrom] = MOVES[calm ? 'fade' : kind](dir * rtl);
  const mine = ++swapId, busy = running.length > 0;
  for (const a of running) a.cancel();
  running = [];
  const els = [lblEl, playerEl];
  const enter = () => {
    apply();
    running = els.map(el => el.animate([{ opacity: 0, translate: inFrom }, { opacity: 1, translate: '0 0' }], { duration: 200, easing: EASE_ENTER }));
    Promise.all(running.map(a => a.finished)).then(() => { if (mine === swapId) running = []; }).catch(() => {});
  };
  if (busy) {
    enter();
    return;
  }
  const outs = els.map(el => el.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: outTo }], { duration: 160, easing: EASE_EXIT, fill: 'forwards' }));
  running = outs;
  Promise.all(outs.map(a => a.finished)).then(() => {
    if (mine !== swapId) return;
    enter();
    for (const a of outs) a.cancel();
  }).catch(() => {});
}
const setText = (el, text) => { if (el.firstElementChild || el.textContent !== text) el.textContent = text; };

let sessions = [], index = 0, provider = '', href = '', baseLink = '', linked = false;
let lastData = null, failure = null, shown = null, redrawTimer = 0;
const winding = new Winding();
const errorUi = errorState({ root: wEl, content: [windowEl], caption: capEl });

function describe(s) {
  if (!s) return wt('ui.nothingPlaying', 'Nothing playing');
  let t = wt('ui.describeTitle', 'Now playing: {title}', { title: s.title || '' });
  if (s.subtitle) t = wt('ui.describeSubtitle', '{text}, {subtitle}', { text: t, subtitle: s.subtitle });
  if (s.player) t = wt('ui.describePlayer', '{text} on {player}', { text: t, player: s.player });
  if (PROVIDER_NAME[provider]) t = wt('ui.describeProvider', '{text}, {provider}', { text: t, provider: PROVIDER_NAME[provider] });
  if (s.state === 'paused') t = wt('ui.describePaused', '{text} (paused)', { text: t });
  return t;
}
function name(text) {
  wEl.setAttribute('aria-label', text);
  if (linked) linkEl.setAttribute('aria-label', wt('ui.linkName', '{text}. Activate to open link.', { text }));
}
function failureLine() {
  return failureName(errorLine(failure.error), failure.since);
}
function showText(on) {
  for (const el of [titleEl, subEl]) el.hidden = !on;
}

function show(mode, { instant = false, dir = 1, paged = false } = {}) {
  const session = mode === 'active' || mode === 'error' ? sessions[index] || null : null;
  const next = { mode, key: session ? sessionKey(session) : null, title: session ? session.title : null };
  const kind = instant ? 'none' : transitionKind(shown, next, paged);
  const failed = mode === 'error' || mode === 'error0';
  const tint = COLORS[provider] || '#8E8E93';
  wEl.style.setProperty('--tint', tint);
  wEl.style.setProperty('--band', tint);
  wEl.style.setProperty('--band-ink', INK[provider] || '#FFFFFF');
  wEl.classList.toggle('err', failed);

  swapLabel(kind, dir, () => {
    wEl.classList.toggle('idle', mode !== 'active' && mode !== 'error');
    if (failed) {
      showText(false);
      errorUi.fail(failure.error, { since: failure.since, inert: mode === 'error' });
      capEl.setAttribute('aria-hidden', 'true');
    } else {
      errorUi.ok();
      capEl.removeAttribute('aria-hidden');
      showText(true);
      if (mode === 'loading') {
        titleEl.replaceChildren(placeholder(96, 12));
        subEl.replaceChildren(placeholder(58, 9));
      } else {
        setText(titleEl, session ? session.title || '' : wt('ui.nothingPlaying', 'Nothing playing'));
        setText(subEl, session ? session.subtitle || '' : '');
      }
    }
    setText(playerEl, (session && session.player) || PROVIDER_NAME[provider] || '');
  });

  const many = mode === 'active' && sessions.length > 1;
  ctlEl.classList.toggle('off', !many);
  if (many) setText(countEl, localiseDigits(`${index + 1}/${sessions.length}`));

  const wasLeader = wEl.classList.contains('leader');
  if (session) {
    wEl.classList.remove('leader');
    const r = packRadius(winding.progress(session, performance.now()));
    packTo(r, !instant && packR !== null && Math.abs(r - packR) >= JUMP_PX, wasLeader);
    rate = reelRate(r);
    spin(mode === 'active' && session.state === 'playing');
  } else {
    wEl.classList.add('leader');
    packTo(LEADER_R, !instant, !wasLeader);
    spin(false);
  }

  linked = linkTo(linkEl, (session && session.link) || baseLink || href);
  const line = failed ? failureLine() : mode === 'loading' ? wt('widget.label', 'Now Playing') : describe(session);
  name(line);

  next.said = spokenKey(mode, session, sessions.length);
  const announce = !instant && shouldAnnounce(shown, next);
  const spoken = many && (!shown || shown.count !== sessions.length)
    ? wtCount('ui.describeSessions', sessions.length, { one: '{text}. {count} session playing', other: '{text}. {count} sessions playing' }, { text: line })
    : line;
  if (announce && srEl.textContent !== spoken) srEl.textContent = spoken;
  shown = { ...next, count: sessions.length };
  scheduleRedraw();
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  const session = shown && shown.mode === 'active' && onScreen ? sessions[index] : null;
  const wait = session ? winding.nextRedraw(session, performance.now()) : null;
  if (wait == null) return;
  redrawTimer = setTimeout(() => {
    const r = packRadius(winding.progress(session, performance.now()));
    packTo(r, false, false);
    rate = reelRate(r);
    spin(true);
    scheduleRedraw();
  }, wait);
}

function apply(d) {
  provider = d.provider || provider;
  baseLink = d.link || '';
  const list = withKeys(Array.isArray(d.sessions) ? d.sessions : []);
  if (d !== lastData) winding.observe(list, performance.now());
  lastData = d;
  index = pickIndex(shown && shown.key, list, index);
  sessions = list;
  show(sessions.length ? 'active' : 'idle');
}

function go(step) {
  if (sessions.length < 2 || !shown || shown.mode !== 'active') return;
  index = (index + step + sessions.length) % sessions.length;
  show('active', { dir: step, paged: true });
}
$('prev').addEventListener('click', e => { e.stopPropagation(); go(-1); });
$('next').addEventListener('click', e => { e.stopPropagation(); go(1); });

async function boot() {
  const c = await getConfig().catch(() => null);
  href = c?.widgetConfig?.href || '';
  provider = c?.widgetConfig?.provider || '';
  linked = linkTo(linkEl, href);
  show('loading', { instant: true });
  whileOnScreen(wEl, visible => {
    onScreen = visible;
    for (const a of [loop, segment]) if (a) visible ? a.play() : a.pause();
    scheduleRedraw();
  });
  poll({
    fetch: () => fetchData(),
    interval: TICK_MS,
    render: d => {
      if (failure && d === lastData) return;
      failure = null;
      apply(d);
    },
    onError: ({ error, everOk, stale, since }) => {
      if (everOk && !stale) return;
      failure = { error, since: everOk ? since : '' };
      show(everOk ? 'error' : 'error0');
    },
  });
}
boot();
