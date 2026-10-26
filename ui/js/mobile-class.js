/* Sets the layout class before the first paint. Load it as a blocking classic
   script in <head>. A module runs after the page has painted, and the desktop
   sidebar flashes.

   The queries, the screen size and the user-agent test must stay identical to the ones in
   ui/js/layout.js. A parity test asserts it. */
(function () {
  try {
    const mm = q => window.matchMedia(q).matches;
    const regular = mm('(min-width:600px)') && Math.min(screen.width, screen.height) >= 600;
    const mobile =
      !mm('(orientation:landscape) and (max-height:500px)') &&
      !regular &&
      (mm('(max-width:768px)') ||
        (mm('(orientation:portrait)') && /iPhone|iPod|Android/i.test(navigator.userAgent || '')));
    if (mobile) document.documentElement.classList.add('is-mobile');
  } catch {}
})();
