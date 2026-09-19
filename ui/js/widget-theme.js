/* Sets the theme on a widget document before the first paint. Load it as a
   blocking classic script in <head>. widget-toolbox.js reads the attribute this
   sets; a module runs after the page has painted, and the theme then arrives as
   a flash of the wrong one. */
(function () {
  try {
    const frame = window.frameElement;
    const dark =
      (frame && frame.closest('[data-appearance="dark"]')) ||
      window.parent.document.documentElement.getAttribute('data-theme') !== 'light';
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    /* A widget page that paints no background of its own would otherwise show
       the card through it, which is what a contrast check measures against. */
    if (getComputedStyle(root).backgroundColor === 'rgba(0, 0, 0, 0)')
      root.style.backgroundColor = dark ? '#1C1C1E' : '#FFFFFF';
  } catch {}
})();
