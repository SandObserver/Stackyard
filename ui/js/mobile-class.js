/* Sets the layout class before the first paint. Load it as a blocking classic
   script in <head>. A module runs after the page has painted, and the desktop
   sidebar flashes.

   The two queries and the user-agent test must stay identical to the ones in
   ui/js/layout.js. A parity test asserts it. */
(function () {
  try {
    const mobile =
      window.matchMedia('(max-width:768px)').matches ||
      (window.matchMedia('(orientation:portrait)').matches && /iPhone|iPod|Android/i.test(navigator.userAgent || ''));
    if (mobile) document.documentElement.classList.add('is-mobile');
  } catch {}
})();
