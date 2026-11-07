/* Load as a blocking classic script in <head>. Never show a stored layout, icon
   or photo from here. These values may be out of date. The storage key must match
   ui/js/wallpaper-cache.js. */
(function () {
  try {
    const hint = JSON.parse(localStorage.getItem('sy-boot') || '{}');
    const root = document.documentElement;
    if (typeof hint.color === 'string' && /^(#[0-9a-f]{3,8}|rgb\(\d+,\d+,\d+\))$/i.test(hint.color)) {
      root.style.setProperty('--boot-bg', hint.color);
    }
    if (typeof hint.url === 'string' && hint.url) {
      const img = new Image();
      img.fetchPriority = 'high';
      img.src = hint.url;
      /** @type {any} */ (window).__wallpaperHint = img;
    }
    if (typeof hint.lang === 'string' && hint.lang !== 'en') root.classList.add('lang-pending');
  } catch {}
})();
