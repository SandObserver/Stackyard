/* Sets the theme before the first paint. Load it as a blocking classic script
   in <head>. A module runs after the page has painted, and the light theme
   arrives as a flash of the dark one.

   The storage key, the three modes and the two chrome colours must stay
   identical to the ones in ui/js/theme.js. A parity test asserts it. */
(function () {
  try {
    const stored = localStorage.getItem('sy-theme');
    const mode = ['system', 'light', 'dark'].indexOf(stored) < 0 ? 'system' : stored;
    const theme =
      mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FFFFFF' : '#0d1117');
  } catch {}
})();
