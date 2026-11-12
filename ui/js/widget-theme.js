/* Load as a blocking classic script in <head>. A module runs after the page has
   painted, and the theme then arrives as a flash of the wrong one. */
(function () {
  /* Keep. iOS Safari enlarges frame text on a sideways phone and the widgets clip. */
  document.documentElement.style.webkitTextSizeAdjust = '100%';
  try {
    const lang = new URLSearchParams(location.search).get('lang');
    if (lang) document.documentElement.lang = Intl.getCanonicalLocales(lang)[0];
  } catch {}
  let painted = false;
  /** @type {boolean|null} */
  let fixedDark = null;
  /** @param {string} query @returns {boolean} */
  const media = query => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  /* Text on a glass card. Each clears 4.5:1 on the card at its worst, over a
     white or black wallpaper; ink-3 clears 3:1 for icons and dots.
     ui/test/glass-widget-ink.test.mjs measures them. */
  const GLASS_INK = {
    dark: { '--glass-ink-2': '#AEAEB2', '--glass-ink-3': 'rgba(235,235,245,.45)', '--glass-red': '#FF8A84' },
    light: { '--glass-ink-2': '#48484A', '--glass-ink-3': 'rgba(0,0,0,.45)', '--glass-red': '#B8001A' },
  };
  function apply() {
    const root = document.documentElement;
    let reduce = false;
    try {
      reduce = window.parent.document.documentElement.getAttribute('data-transparency') === 'reduce';
    } catch {}
    if (reduce) root.setAttribute('data-transparency', 'reduce');
    else root.removeAttribute('data-transparency');
    try {
      const frame = window.frameElement;
      /* Read once. A widget marks its own card later, and that mark is not fixed. */
      if (fixedDark === null) fixedDark = Boolean(frame && frame.closest('[data-appearance="dark"]'));
      const dark = fixedDark || window.parent.document.documentElement.getAttribute('data-theme') !== 'light';
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      root.style.colorScheme = dark ? 'dark' : 'light';
      const zoom = frame && frame.getAttribute('data-zoom');
      if (zoom) root.style.zoom = zoom;
      /* The card is glass while its own fill lets the wallpaper through. */
      const card = frame && frame.closest('.widget, .mob-widget-card');
      const fill = card
        ? (window.parent.getComputedStyle(card).backgroundColor.match(/[\d.]+/g) ?? []).map(Number)
        : [];
      const glass = fill.length === 4 && fill[3] > 0 && fill[3] < 1 && !media('(forced-colors: active)');
      root.toggleAttribute('data-glass', glass);
      const inks = GLASS_INK[fill[0] + fill[1] + fill[2] > 382 ? 'light' : 'dark'];
      for (const [name, value] of Object.entries(inks)) {
        if (glass) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
      if (painted) root.style.backgroundColor = '';
      painted = false;
      /* A page with no background of its own shows the card through it. */
      if (!glass && getComputedStyle(root).backgroundColor === 'rgba(0, 0, 0, 0)') {
        root.style.backgroundColor = dark ? '#1C1C1E' : '#FFFFFF';
        painted = true;
      }
    } catch {}
  }
  apply();
  for (const query of ['(prefers-contrast: more)', '(forced-colors: active)']) {
    try {
      window.matchMedia(query).addEventListener('change', apply);
    } catch {}
  }
  /* The dashboard calls this when its theme changes, so the frame is kept. */
  /** @type {any} */ (window).__applyHostTheme = apply;
})();
