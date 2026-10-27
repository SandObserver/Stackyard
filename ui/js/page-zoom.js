/* Safari reports safe-area insets in screen points at every page zoom. Load
   this as a blocking classic script in <head>, before the stylesheets. */
(function () {
  try {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let width = -1;
    /* Read the scale only when the layout width changes. A pinch changes the
       scale but not the width, and must not move the insets. */
    const read = () => {
      if (root.clientWidth === width) return;
      width = root.clientWidth;
      root.style.setProperty('--inset-scale', String(1 / vv.scale));
    };
    read();
    window.addEventListener('resize', read);
  } catch {}
})();
