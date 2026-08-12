/* A widget is an iframe that loads no shared stylesheet, so the reduced-motion
   rule in tokens.css cannot reach it and a rule in the widget's own <style>
   cannot reach a transition set as an inline style. barFill sets one, so it has
   to ask for the preference itself.

   Every shipped widget draws its own bars today. This is the toolkit helper the
   next one is meant to reuse. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };

/* Enough of a DOM for an element that carries a style string and a child. */
function stubDom() {
  globalThis.document = {
    createElement: () => ({
      style: { cssText: '' },
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    }),
  };
}

/** @param {boolean|null} reduce null means the browser answers no matchMedia */
function setMotionPreference(reduce) {
  globalThis.window = reduce === null ? {} : { matchMedia: query => ({ matches: reduce && query.includes('reduce') }) };
}

stubDom();
const { barFill } = await import('../js/widget-toolbox.js');

const fillOf = track => track.children[0];

test('the bar animates when no reduced-motion preference is set', () => {
  setMotionPreference(false);
  assert.match(fillOf(barFill(40)).style.cssText, /transition:width \.4s ease/);
});

test('the bar does not animate when reduced motion is asked for', () => {
  setMotionPreference(true);
  const css = fillOf(barFill(40)).style.cssText;
  assert.doesNotMatch(css, /transition/);
  assert.match(css, /width:40%/, 'the bar still reaches its value, it just does not travel there');
});

/* The preference is read per call, so a widget that redraws after the setting
   changes picks up the new answer. */
test('the preference is read on each call, not once at load', () => {
  setMotionPreference(true);
  assert.doesNotMatch(fillOf(barFill(10)).style.cssText, /transition/);
  setMotionPreference(false);
  assert.match(fillOf(barFill(10)).style.cssText, /transition/);
});

/* A browser without matchMedia must still draw a bar. */
test('a missing matchMedia is treated as no preference', () => {
  setMotionPreference(null);
  assert.match(fillOf(barFill(55)).style.cssText, /transition:width \.4s ease/);
});

test('a throwing matchMedia does not break the bar', () => {
  globalThis.window = {
    matchMedia: () => {
      throw new Error('unsupported');
    },
  };
  const css = fillOf(barFill(55)).style.cssText;
  assert.match(css, /width:55%/);
});
