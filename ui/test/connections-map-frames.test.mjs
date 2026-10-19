/* The map pulses a point service by asking for a frame from inside each frame.
   Every poll and resize also asks for one, so unless those requests share one
   handle, each refresh starts another endless loop. Counting frames pending at
   once is the point: one loop keeps exactly one. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './connections-map-mount.mjs';

const PULSING = { services: [{ id: 'vpn', kind: 'point', lat: 52.5, lng: 13.4, name: 'VPN' }] };

test('repeated polls and resizes keep one animation frame pending', async () => {
  const map = await mount();
  try {
    for (let i = 0; i < 5; i++) {
      map.render(PULSING);
      map.runFrames();
      map.resize();
      map.runFrames();
    }
    assert.equal(map.frames.size, 1, `expected one pulse loop, found ${map.frames.size} frames pending`);
  } finally {
    map.restore();
  }
});

test('the pulse keeps animating after a refresh', async () => {
  const map = await mount();
  try {
    map.render(PULSING);
    for (let i = 0; i < 3; i++) map.runFrames();
    assert.equal(map.frames.size, 1);
  } finally {
    map.restore();
  }
});

test('off screen, a refresh paints once and starts no pulse loop', async () => {
  const map = await mount({ onScreen: false });
  try {
    map.render(PULSING);
    map.runFrames();
    assert.ok(map.painted().length > 0, 'the refresh still paints');
    assert.equal(map.frames.size, 0);
  } finally {
    map.restore();
  }
});

test('the pulse resumes when the map comes back on screen', async () => {
  const map = await mount({ onScreen: false });
  try {
    map.render(PULSING);
    map.runFrames();
    map.setOnScreen(true);
    map.runFrames();
    assert.equal(map.frames.size, 1);
  } finally {
    map.restore();
  }
});
