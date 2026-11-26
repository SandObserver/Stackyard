/* Load as a blocking classic script in <head>. Never show a stored layout, icon
   or photo from here. These values may be out of date. The storage key must match
   ui/js/wallpaper-cache.js. */
(function () {
  let savedLang = '';
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
      img.decode().catch(() => {});
      /** @type {any} */ (window).__wallpaperHint = img;
    }
    if (typeof hint.lang === 'string') savedLang = hint.lang;
    if (typeof hint.lang === 'string' && hint.lang !== 'en') root.classList.add('lang-pending');
  } catch {}
  /* A backend that accepts the connection and never answers would otherwise
     leave the boot veil up forever. Generous: this only has to beat a hang.
     dashboard.js takes it from window. */
  const timeoutMs = 15000;
  /** @type {any} */ (window).__bootTimeoutMs = timeoutMs;
  /* dashboard-boot.js reads window.__early once and clears it. */
  const script = document.currentScript;
  if (script && 'early' in script.dataset) {
    const get = (url, timed) => {
      const p = fetch(
        url,
        timed ? { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) } : { cache: 'no-store' },
      );
      p.catch(() => {});
      return p;
    };
    /** @type {any} */ (window).__early = {
      auth: get('/api/auth/check', true),
      config: get('/api/config', true),
      widgets: get('/api/widgets', false),
    };
  }

  /* The page's entry module sets __bootStarted first. Without this, a module
     that never runs leaves the veil up or the page blank forever. */
  const LANGS = ['en', 'de', 'es', 'fa', 'fr', 'zh-Hans'];
  const ENGLISH = {
    title: "Stackyard Couldn't Start",
    why: 'This browser could not run Stackyard. Reload the page. If that does not help, update the browser or open Stackyard in another one.',
    reload: 'Reload',
  };
  /** @param {string} tag @returns {string} */
  const supported = tag => {
    const want = String(tag).toLowerCase();
    return (
      LANGS.find(c => c.toLowerCase() === want) ||
      LANGS.find(c => c.toLowerCase().split('-')[0] === want.split('-')[0]) ||
      ''
    );
  };
  const pickLang = () => {
    if (supported(savedLang)) return supported(savedLang);
    for (const tag of navigator.languages || [navigator.language]) if (supported(tag)) return supported(tag);
    return 'en';
  };
  let failed = false;
  const fail = () => {
    if (failed || /** @type {any} */ (window).__bootStarted) return;
    failed = true;
    const root = document.documentElement;
    root.classList.remove('lang-pending');
    root.classList.add('boot-failed');
    document.body.classList.add('load-stopped');
    const screen = document.createElement('div');
    screen.className = 'cfg-recovery';
    screen.setAttribute('role', 'alert');
    const card = document.createElement('div');
    card.className = 'cfg-recovery-card';
    const title = document.createElement('h1');
    title.className = 'cfg-recovery-title';
    const why = document.createElement('p');
    why.className = 'cfg-recovery-why';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cfg-recovery-btn';
    button.addEventListener('click', () => location.reload());
    /** @param {Record<string, string>} text */
    const fill = text => {
      title.textContent = text.title || ENGLISH.title;
      why.textContent = text.why || ENGLISH.why;
      button.textContent = text.reload || ENGLISH.reload;
    };
    fill(ENGLISH);
    card.append(title, why, button);
    screen.append(card);
    document.body.append(screen);
    const lang = pickLang();
    if (lang === 'en') return;
    fetch(`/i18n/${lang}.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(catalog => {
        const text = catalog && catalog.bootFailed;
        if (!text || typeof text !== 'object') return;
        screen.lang = lang;
        screen.dir = lang === 'fa' ? 'rtl' : 'ltr';
        fill(text);
      })
      .catch(() => {});
  };
  try {
    window.addEventListener(
      'error',
      e => {
        const target = /** @type {any} */ (e.target);
        if (target instanceof HTMLScriptElement && target.type === 'module') fail();
      },
      true,
    );
    window.addEventListener('load', () => setTimeout(fail, 3000));
  } catch {}
})();
