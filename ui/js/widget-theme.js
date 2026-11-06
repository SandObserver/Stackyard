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
  function apply() {
    try {
      const frame = window.frameElement;
      /* Read once. A widget marks its own card later, and that mark is not fixed. */
      if (fixedDark === null) fixedDark = Boolean(frame && frame.closest('[data-appearance="dark"]'));
      const dark = fixedDark || window.parent.document.documentElement.getAttribute('data-theme') !== 'light';
      const root = document.documentElement;
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      root.style.colorScheme = dark ? 'dark' : 'light';
      const zoom = frame && frame.getAttribute('data-zoom');
      if (zoom) root.style.zoom = zoom;
      if (painted) root.style.backgroundColor = '';
      /* A page with no background of its own shows the card through it. */
      if (getComputedStyle(root).backgroundColor === 'rgba(0, 0, 0, 0)') {
        root.style.backgroundColor = dark ? '#1C1C1E' : '#FFFFFF';
        painted = true;
      }
    } catch {}
  }
  apply();
  /* The dashboard calls this when its theme changes, so the frame is kept. */
  /** @type {any} */ (window).__applyHostTheme = apply;
})();
