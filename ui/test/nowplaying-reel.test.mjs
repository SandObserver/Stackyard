import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CENTRE,
  HUB_R,
  HUB_TURN_MS,
  PACK_MAX,
  packRadius,
  pickIndex,
  reelMarkup,
  reelRate,
  sessionKey,
  shouldAnnounce,
  spokenKey,
  stepsPerTurn,
  strandPath,
  transitionKind,
  Winding,
  withKeys,
} from '../widgets/nowplaying/reel-logic.js';

const film = (over = {}) => ({ id: 'a', title: 'Heat', player: 'TV', state: 'playing', progress: 0.2, ...over });

test('the pack grows by area from the hub to the full reel', () => {
  assert.ok(packRadius(0) > HUB_R);
  assert.equal(packRadius(1), PACK_MAX);
  assert.equal(packRadius(-1), packRadius(0));
  assert.equal(packRadius(2), PACK_MAX);
  const r0 = packRadius(0);
  const half = Math.sqrt((r0 * r0 + PACK_MAX * PACK_MAX) / 2);
  assert.ok(Math.abs(packRadius(0.5) - half) < 1e-9, 'half the tape is half the area');
  assert.equal(packRadius(null), packRadius(0.5), 'no progress shows a half-full pack');
});

test('a fuller reel turns slower, as the tape moves at one speed', () => {
  assert.ok(reelRate(packRadius(0)) > reelRate(packRadius(1)));
  assert.ok(Math.abs(HUB_TURN_MS - 2449) < 1, 'a bare 13 mm hub turns once in 2.4 s at SP speed');
});

test('without a graphics chip the reel draws at most 30 times a second and 8 times a turn', () => {
  for (const r of [packRadius(0), packRadius(0.5), packRadius(1)]) {
    const rate = reelRate(r);
    const turnS = HUB_TURN_MS / rate / 1000;
    const steps = stepsPerTurn(rate);
    assert.ok(steps / turnS <= 30.5, `${steps} steps in ${turnS} s`);
    assert.ok(steps >= 8);
  }
  assert.ok(
    stepsPerTurn(reelRate(PACK_MAX)) / (HUB_TURN_MS / reelRate(PACK_MAX)) <
      stepsPerTurn(reelRate(HUB_R)) / (HUB_TURN_MS / reelRate(HUB_R)),
    'a slow reel is drawn less often',
  );
});

test('the strand leaves the pack on its tangent and runs out past the window', () => {
  for (const p of [0, 0.5, 1]) {
    const r = packRadius(p);
    const [x, y] = strandPath(r).slice(1).split(' ').map(Number);
    assert.ok(Math.abs(Math.hypot(x - CENTRE.x, y - CENTRE.y) - r) < 0.01, 'starts on the pack');
    assert.ok(y > CENTRE.y, 'starts below the hub, on the outer side');
    assert.match(strandPath(r), /L167\.90 0\.00$/);
  }
});

test('the reel colours its leader clip from the provider tint', () => {
  assert.match(reelMarkup(), /fill="var\(--tint\)"/);
  assert.match(reelMarkup(), /aria-hidden="true"/);
});

test('sessions are told apart by id, else by player and title', () => {
  assert.equal(sessionKey(film()), 'a');
  assert.notEqual(sessionKey(film({ id: '' })), sessionKey(film({ id: '', title: 'Ronin' })));
});

test('an update keeps the shown session even when the list reorders', () => {
  const list = [film({ id: 'b' }), film({ id: 'a' })];
  assert.equal(pickIndex('a', list, 0), 1);
  assert.equal(pickIndex('gone', list, 1), 1, 'the session in its place');
  assert.equal(pickIndex('gone', [film()], 3), 0);
  assert.equal(pickIndex(null, [], 2), 0);
});

test('sessions the server cannot tell apart still get keys of their own', () => {
  const twin = over => film({ id: '', player: 'Chrome', title: 'Dune', ...over });
  const poll = (a, b) => withKeys([twin({ progress: a }), twin({ progress: b })]);
  const first = poll(0.6, 0.2);
  assert.notEqual(sessionKey(first[0]), sessionKey(first[1]));
  assert.deepEqual(poll(0.6, 0.2).map(sessionKey), first.map(sessionKey), 'the same keys on the next poll');
  assert.equal(sessionKey(withKeys([film()])[0]), 'a', 'a unique session keeps its own key');

  const w = new Winding();
  w.observe(first, 0);
  const next = poll(0.601, 0.201);
  w.observe(next, 10000);
  assert.ok(Math.abs(w.progress(next[0], 25000) - 0.6025) < 0.001, 'each winds at its own rate');
  assert.ok(Math.abs(w.progress(next[1], 25000) - 0.2025) < 0.001);
  assert.equal(pickIndex(sessionKey(first[1]), next, 1), 1, 'a paged session stays shown');
});

test('two players with the same name are two sessions', () => {
  const list = [film({ id: 'x', player: 'Chrome' }), film({ id: 'y', player: 'Chrome' })];
  assert.equal(pickIndex('y', list, 0), 1);
});

test('each change between views has its own label motion', () => {
  const v = (mode, key = null, title = null) => ({ mode, key, title });
  assert.equal(transitionKind(null, v('idle')), 'none');
  assert.equal(transitionKind(v('idle'), v('active', 'a', 'Heat')), 'arrive');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('idle')), 'leave');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('active', 'b', 'Heat'), true), 'page');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('active', 'b', 'Ronin')), 'fade', 'a new session in place');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('active', 'a', 'Ronin')), 'fade');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('active', 'a', 'Heat')), 'none');
  assert.equal(transitionKind(v('loading'), v('idle')), 'fade');
  assert.equal(transitionKind(v('active', 'a', 'Heat'), v('error', 'a', 'Heat')), 'fade');
  assert.equal(transitionKind(v('error0'), v('error0')), 'none');
});

test('a screen reader hears a change of what plays, never a progress tick', () => {
  const at = (mode, s, count = 1) => ({ mode, said: spokenKey(mode, s, count) });
  const playing = at('active', film());
  assert.equal(shouldAnnounce(playing, at('active', film({ progress: 0.3 }))), false);
  assert.equal(shouldAnnounce(playing, at('active', film({ state: 'paused' }))), true);
  assert.equal(shouldAnnounce(playing, at('active', film({ title: 'Ronin' }))), true);
  assert.equal(shouldAnnounce(playing, at('active', film(), 2)), true, 'a second session starts');
  assert.equal(shouldAnnounce(playing, at('idle', null, 0)), true);
  assert.equal(shouldAnnounce(at('loading', null, 0), playing), false, 'not the first data');
  assert.equal(shouldAnnounce(null, playing), false);
  assert.equal(shouldAnnounce(playing, at('error', film())), false, 'a failure renames the widget instead');
});

test('the pack winds between polls at the rate the polls showed', () => {
  const w = new Winding();
  w.observe([film({ progress: 0.2 })], 0);
  w.observe([film({ progress: 0.201 })], 10000);
  const s = film({ progress: 0.201 });
  assert.ok(Math.abs(w.progress(s, 15000) - 0.2015) < 1e-9);
  const wait = w.nextRedraw(s, 10000);
  assert.ok(wait >= 500 && wait <= 10000);
  assert.equal(w.nextRedraw(film({ progress: 0.201, state: 'paused' }), 10000), null);
});

test('a seek is not playback', () => {
  const w = new Winding();
  w.observe([film({ progress: 0.2 })], 0);
  w.observe([film({ progress: 0.8 })], 10000);
  assert.equal(w.progress(film({ progress: 0.8 }), 20000), 0.8);
});

test('the pack winds no further than 30 s past the last poll', () => {
  const w = new Winding();
  w.observe([film({ progress: 0.2 })], 0);
  w.observe([film({ progress: 0.21 })], 10000);
  const s = film({ progress: 0.21 });
  assert.equal(w.progress(s, 10000 + 3_600_000), w.progress(s, 40000));
  assert.equal(w.nextRedraw(s, 40000), null);
});

test('same-name players wind apart, and ended sessions are forgotten', () => {
  const w = new Winding();
  const a = p => film({ id: 'x', player: 'Chrome', progress: p });
  const b = p => film({ id: 'y', player: 'Chrome', progress: p, title: 'Ronin' });
  w.observe([a(0.1), b(0.5)], 0);
  w.observe([a(0.101), b(0.5)], 10000);
  assert.ok(w.progress(a(0.101), 20000) > 0.101);
  assert.equal(w.progress(b(0.5), 20000), 0.5);
  w.observe([a(0.102)], 20000);
  assert.equal(w.seen.size, 1);
});
