/* Load as a blocking classic script in <head>. A module runs after the page has
   painted, and the theme then arrives as a flash of the wrong one. */
(function () {
  try {
    const frame = window.frameElement;
    const dark =
      (frame && frame.closest('[data-appearance="dark"]')) ||
      window.parent.document.documentElement.getAttribute('data-theme') !== 'light';
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    /* A page with no background of its own shows the card through it. */
    if (getComputedStyle(root).backgroundColor === 'rgba(0, 0, 0, 0)')
      root.style.backgroundColor = dark ? '#1C1C1E' : '#FFFFFF';
  } catch {}
})();
