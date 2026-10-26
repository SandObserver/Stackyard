/* Load as a blocking classic script in <head>. A module runs after the page has
   painted, and the theme then arrives as a flash of the wrong one. */
(function () {
  /* Keep. iOS Safari enlarges frame text on a sideways phone and the widgets clip. */
  document.documentElement.style.webkitTextSizeAdjust = '100%';
  try {
    const lang = new URLSearchParams(location.search).get('lang');
    if (lang) document.documentElement.lang = Intl.getCanonicalLocales(lang)[0];
  } catch {}
  try {
    const frame = window.frameElement;
    const dark =
      (frame && frame.closest('[data-appearance="dark"]')) ||
      window.parent.document.documentElement.getAttribute('data-theme') !== 'light';
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    const zoom = frame && frame.getAttribute('data-zoom');
    if (zoom) root.style.zoom = zoom;
    /* A page with no background of its own shows the card through it. */
    if (getComputedStyle(root).backgroundColor === 'rgba(0, 0, 0, 0)')
      root.style.backgroundColor = dark ? '#1C1C1E' : '#FFFFFF';
  } catch {}
})();
