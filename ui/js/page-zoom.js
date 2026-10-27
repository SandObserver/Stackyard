/* Safari reports safe-area insets in screen points at every page zoom. Load
   this as a blocking classic script in <head>, before the stylesheets. */
(function () {
  try {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let width = -1;
    /* The scale is the page zoom only while the visual viewport spans the
       layout width. A pinch narrows it, so a width change during a pinch is
       read when the pinch ends. */
    const read = () => {
      if (root.clientWidth === width || vv.width < root.clientWidth - 2) return;
      width = root.clientWidth;
      root.style.setProperty('--inset-scale', String(1 / vv.scale));
    };
    read();
    window.addEventListener('resize', read);
    vv.addEventListener('resize', read);
  } catch {}
})();
