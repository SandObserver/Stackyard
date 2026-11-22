import {
  applyBackground,
  BACKDROP,
  decoded,
  parseWallpaperUrl,
  rememberBackground,
  resolveBackground,
} from '/js/background.js?v=51e46417';
import { glassWallpaper } from '/js/glass.js?v=7c376881';
import {
  applyLabelTones,
  averageColor,
  loadSamplingImage,
  sampleImage,
  toneForColor,
} from '/js/label-contrast.js?v=a160c6d1';
import { pageTheme } from '/js/palette.js?v=3fb8ae43';
import { creditPlacement, showPhotoCredit } from '/js/photo-credit.js?v=e6e79571';
import { el, titleWhenTruncated } from '/js/utils.js?v=457d9918';
import { saveBootHint } from '/js/wallpaper-cache.js?v=cd968718';

const CREDIT_EDGE = 20;

const themeTone = () => (pageTheme() === 'light' ? 'dark' : 'light');

function placeCredit() {
  const credit = el('photo-credit');
  if (!credit || credit.hidden) return;
  if (document.body.classList.contains('is-mob')) {
    credit.removeAttribute('data-place');
    credit.style.removeProperty('max-width');
    return;
  }
  const dock = document.body.classList.contains('no-dock') ? null : el('dock').getBoundingClientRect();
  const { place, maxWidth } = creditPlacement(
    window.innerWidth,
    dock,
    document.documentElement.dir === 'rtl',
    CREDIT_EDGE,
  );
  credit.dataset.place = place;
  credit.style.maxWidth = `${maxWidth}px`;
}

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash */
export function createWallpaper(dash) {
  /* A sampled wallpaper grid, or one tone for a solid colour. Null on both leaves
     the labels as they are. */
  let bgTone = { grid: null, tone: null };
  /* Held so a resize re-samples without fetching the image again. */
  let _bgSample = null;
  let _shownWallpaper = '';
  let _bgCall = 0;

  function retone() {
    requestAnimationFrame(() => {
      placeCredit();
      applyLabelTones(bgTone);
      /* Same frame: both need the layout the build produced, and both re-run on a
         rebuild and a resize for the same reason. */
      titleWhenTruncated();
    });
  }

  async function sampleWallpaper(url, brightness, fit, call) {
    const sameOrigin = parseWallpaperUrl(url)?.origin === location.origin;
    const img = await (sameOrigin ? decoded(url) : loadSamplingImage(url));
    if (call !== _bgCall) return;
    _bgSample = img ? { img, brightness, fit } : null;
    resampleBg();
    if (img) saveBootHint({ color: averageColor(img, brightness) });
  }

  function resampleBg() {
    if (!_bgSample) return retone();
    bgTone = {
      grid: sampleImage(
        _bgSample.img,
        window.innerWidth,
        window.innerHeight,
        _bgSample.brightness,
        _bgSample.fit,
        BACKDROP,
      ),
      tone: themeTone(),
    };
    retone();
  }

  /** @param {HTMLElement} root @param {any} bg @param {number} call */
  async function showWallpaper(root, bg, call) {
    const prev = _shownWallpaper;
    await decoded(bg.url);
    if (call !== _bgCall) return;
    _shownWallpaper = bg.url;
    const style = root.style;
    if (prev) {
      for (const k of ['image', 'size', 'brightness'])
        style.setProperty(`--bg-prev-${k}`, style.getPropertyValue(`--bg-${k}`));
    }
    applyBackground(root, bg);
    root.classList.remove('wall-in', 'wall-swap');
    if (!prev && !document.body.classList.contains('ready')) return;
    const cls = prev ? 'wall-swap' : 'wall-in';
    void root.offsetWidth;
    root.classList.add(cls);
    if (prev) setTimeout(() => root.classList.remove('wall-swap'), 450);
  }

  async function applyBg() {
    const call = ++_bgCall;
    const root = document.documentElement;
    bgTone = { grid: null, tone: themeTone() };
    retone();
    let bg = null;
    try {
      bg = await resolveBackground(dash.S.background || {});
    } catch {}
    if (call !== _bgCall) return;
    if (!bg) {
      root.style.removeProperty('--boot-bg');
      if (_shownWallpaper) return resampleBg();
      rememberBackground(dash.S.background, null);
      showPhotoCredit(el('photo-credit'), null);
      return;
    }
    rememberBackground(dash.S.background, bg);
    showPhotoCredit(el('photo-credit'), bg.credit ?? null);
    if (bg.url && bg.url !== _shownWallpaper) await showWallpaper(root, bg, call);
    else applyBackground(root, bg);
    if (call !== _bgCall) return;
    glassWallpaper(bg.url ? await decoded(bg.url) : null, bg.size);
    if (call !== _bgCall) return;
    if (bg.url) {
      sampleWallpaper(bg.url, Number(bg.brightness), bg.fit, call);
      return;
    }
    bgTone = { grid: null, tone: toneForColor(bg.color) ?? themeTone() };
    retone();
  }

  return { applyBg, retone, resampleBg };
}

/** @typedef {ReturnType<typeof createWallpaper>} Wallpaper */
