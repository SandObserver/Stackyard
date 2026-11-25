import { fluidHoverClear, fluidHoverKb } from '/js/fluid-hover.js?v=eb6cc81c';
import { SWIPE_LOCK_PX } from '/js/dashboard-logic.js?v=b4828b62';
import { t } from '/js/i18n.js?v=82ba9da2';
import { pageTheme } from '/js/palette.js?v=3fb8ae43';
import { SETTINGS_ICON, SETTINGS_ICON_LIGHT } from '/js/settings-icon.js?v=4079b66a';
import { clr, el, initial, inp as inpById, mk, q, qa, setUserText } from '/js/utils.js?v=457d9918';

/* Attached to the window so a re-open can undo the previous one. */
const _w = /** @type {any} */ (window);

const LIVE_DELAY_MS = 400;
const TOP_HIT_MAX = 4;
const SECTION_ROWS = 4;
const OPEN_MS = 420;
const KB_MS = 383;
const SHRINK_MS = 280;
const KB_EASE = 'cubic-bezier(.35,.8,.22,1)';
const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ACTIVATES_ON_SPACE = 'a[href], button, input, select, textarea, summary, [role="button"], [contenteditable]';

/* `isMob` is a function, not a flag: the window can cross the breakpoint while
   this module is loaded. */
export function initSpotlight({
  getItems,
  isMob,
  typeToOpen,
  CB,
  iconChain,
  openFolderDesktop,
  openFolderMobile,
  folderGlyph,
}) {
  const MOB = () => isMob();
  const ov = /** @type {HTMLDialogElement} */ (el('spot'));
  const inp = inpById('sin');
  const res = el('sres');
  const cancelBtn = el('spot-cancel');
  const live = el('sres-live');
  const clearBtn = el('spot-clear');
  const ghost = q('.spot-ghost', ov);
  const box = el('sbox');
  /** @type {Set<string>} */
  const expanded = new Set();
  /** @type {Animation[]} */
  let morphAnims = [];
  let si = 0,
    cur = [],
    returnFocus = null,
    openGen = 0,
    keyOpened = false,
    closeGen = 0;

  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-autocomplete', 'list');
  inp.setAttribute('aria-controls', 'sres');
  inp.setAttribute('aria-expanded', 'false');
  res.setAttribute('role', 'listbox');
  res.setAttribute('aria-label', t('home.searchResults'));

  let liveTimer = 0;
  /** @param {string} text */
  const announce = text => {
    clearTimeout(liveTimer);
    if (live) liveTimer = window.setTimeout(() => (live.textContent = text), LIVE_DELAY_MS);
  };

  const labelOf = app => String(app.label || app.id);

  /** @type {WeakMap<Element, any>} */
  const optApp = new WeakMap();
  /** @type {WeakMap<Element, (viaKey: boolean) => void>} */
  const moreToggle = new WeakMap();
  let optSeq = 0;
  const opts = () => qa('[role="option"]', res);

  const dirProbe = mk('span');
  dirProbe.setAttribute('dir', 'auto');
  /** @param {string} s */
  const startsRtl = s => {
    dirProbe.textContent = s;
    return dirProbe.matches(':dir(rtl)');
  };

  /* A scroll that lifts on the node must not count as a tap. */
  /** @param {HTMLElement} node @param {() => void} fn */
  const onTap = (node, fn) => {
    let sx = 0,
      sy = 0,
      top = 0,
      moved = false;
    node.addEventListener(
      'touchstart',
      e => {
        const touch = e.changedTouches[0];
        sx = touch.clientX;
        sy = touch.clientY;
        top = res.scrollTop;
        moved = e.touches.length > 1;
      },
      { passive: true },
    );
    node.addEventListener(
      'touchmove',
      e => {
        const touch = e.changedTouches[0];
        if (touch && Math.hypot(touch.clientX - sx, touch.clientY - sy) >= SWIPE_LOCK_PX) moved = true;
      },
      { passive: true },
    );
    node.addEventListener(
      'touchend',
      e => {
        if (moved || res.scrollTop !== top) return;
        e.preventDefault();
        fn();
      },
      { passive: false },
    );
  };

  /** @param {any} app @param {number} i @param {boolean} tile */
  const buildRow = (app, i, tile) => {
    const isFolder = app.type === 'folder';
    /* Settings is this dashboard, so it opens here and carries no
       leaves-the-site arrow. Its tile does the same. */
    const isInternal = isFolder || app.system === 'settings';
    const a = mk('a', {
      href: app.href || '#',
      target: isInternal ? '_self' : '_blank',
      rel: 'noreferrer noopener',
    });
    a.className = 'sr' + (tile ? ' sr-tile' : '') + (i === 0 ? ' sel' : '');
    a.id = 'sr-opt-' + i;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-label', app.label || app.id);
    a.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    optApp.set(a, app);
    a.style.cssText =
      (tile ? '' : 'display:flex;align-items:center;') +
      'text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;';
    /* A click also follows the link. Opening here as well opens two tabs. */
    const doOpen = viaTouch => {
      close();
      if (isFolder) {
        if (MOB()) openFolderMobile(app);
        else openFolderDesktop(app);
      } else if (app.system === 'settings' && app.href) {
        window.location.href = app.href;
      } else if (viaTouch && app.href) {
        window.open(app.href, '_blank', 'noreferrer,noopener');
      }
    };
    onTap(a, () => doOpen(true));
    a.onclick = () => doOpen(false);

    const ic = mk('div');
    ic.className = 'sri';
    ic.dir = 'ltr';
    ic.style.background = clr(app.system === 'settings' ? 'auto' : app.color);
    if (app.system === 'settings') {
      const img = mk('img', { alt: '', src: pageTheme() === 'light' ? SETTINGS_ICON_LIGHT : SETTINGS_ICON });
      img.setAttribute('aria-hidden', 'true');
      ic.appendChild(img);
    } else if (isFolder && folderGlyph) {
      ic.style.background = 'transparent';
      ic.style.position = 'relative';
      ic.appendChild(folderGlyph(app, 64));
    } else if (app.iconUrl) {
      const img = mk('img', { alt: '', loading: 'lazy' });
      img.setAttribute('aria-hidden', 'true');
      const srcs = iconChain(app.iconUrl);
      if (srcs.length) img.src = srcs[0];
      let step = 0;
      img.onerror = () => {
        step++;
        if (step < srcs.length) img.src = srcs[step];
        else {
          ic.replaceChildren();
          ic.textContent = initial(app.label || app.id);
          ic.style.color = '#fff';
          ic.style.fontWeight = '600';
        }
      };
      ic.appendChild(img);
    } else {
      ic.textContent = initial(app.label || app.id);
      ic.style.color = '#fff';
      ic.style.fontWeight = '600';
    }

    const tx = mk('div');
    tx.style.cssText = tile ? 'min-width:0;width:100%;' : 'flex:1;min-width:0;';
    const nm = mk('div');
    nm.className = 'srn';
    setUserText(nm, app.label || app.id);
    const ht = mk('div');
    ht.className = 'srh';
    setUserText(ht, (app.href || '').replace(/^https?:\/\//, '').replace(/\/$/, ''));
    tx.append(nm, ht);
    a.append(ic, tx);
    if (!isInternal && !tile) {
      const ar = mk('span');
      ar.className = 'sra';
      ar.textContent = '↗';
      ar.setAttribute('aria-hidden', 'true');
      a.append(ar);
    }
    return a;
  };

  const noResults = () => {
    const e = mk('div');
    e.className = 'sr-empty';
    e.textContent = t('home.noResults');
    res.appendChild(e);
    announce(t('home.noResults'));
    inp.setAttribute('aria-activedescendant', '');
  };

  const finish = () => {
    fluidHoverClear(res);
    announce(t('home.resultCount', { count: cur.length }));
    inp.setAttribute('aria-expanded', 'true');
    inp.setAttribute('aria-activedescendant', cur.length ? 'sr-opt-0' : '');
  };

  /* Keep this an option. A listbox group may own only options. Edit the rows
     in place: a rebuild removes the focused node. */
  /** @param {{key: string, items: any[], tile: boolean, limit: number}} g @param {HTMLElement} list */
  const moreOption = (g, list) => {
    const b = mk('div');
    b.className = 'sr-more';
    b.id = 'sr-more-' + g.key;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    const label = () => {
      b.textContent = expanded.has(g.key) ? t('home.showLess') : t('home.showMore');
    };
    label();
    /** @param {boolean} viaKey */
    const toggle = viaKey => {
      const was = opts()[si];
      if (expanded.has(g.key)) {
        expanded.delete(g.key);
        for (const row of Array.from(list.children).slice(g.limit)) row.remove();
      } else {
        expanded.add(g.key);
        for (const app of g.items.slice(g.limit)) list.appendChild(buildRow(app, optSeq++, g.tile));
      }
      label();
      const all = opts();
      si = !viaKey && was && was.isConnected ? all.indexOf(was) : all.indexOf(b);
      upd(viaKey);
    };
    moreToggle.set(b, toggle);
    onTap(b, () => toggle(false));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = () => toggle(false);
    return b;
  };

  const renderDesktop = () => {
    const f = document.createDocumentFragment();
    const hdr = mk('div');
    hdr.className = 'sr-section';
    hdr.textContent = t('home.appsAndFolders');
    f.appendChild(hdr);
    cur.forEach((app, i) => f.appendChild(buildRow(app, i, false)));
    res.appendChild(f);
  };

  /** @param {string} qq */
  const renderMobile = qq => {
    const all = cur;
    /** @type {{key: string, title: string, items: any[], tile: boolean, limit: number}[]} */
    const groups = [];
    const lc = app => labelOf(app).toLowerCase();
    const full = all.filter(a => lc(a).startsWith(qq));
    const word = all.filter(
      a =>
        !full.includes(a) &&
        lc(a)
          .split(/[\s._-]+/)
          .some(w => w.startsWith(qq)),
    );
    let hits = full.concat(word).slice(0, TOP_HIT_MAX);
    if (!hits.length) hits = all.slice(0, 1);
    const rest = all.filter(a => !hits.includes(a));
    groups.push({ key: 'top', title: t('home.topHit'), items: hits, tile: hits.length > 1, limit: TOP_HIT_MAX });
    const apps = rest.filter(a => a.type === 'app');
    const folders = rest.filter(a => a.type === 'folder');
    if (apps.length) groups.push({ key: 'apps', title: t('home.apps'), items: apps, tile: false, limit: SECTION_ROWS });
    if (folders.length)
      groups.push({ key: 'folders', title: t('home.folders'), items: folders, tile: false, limit: SECTION_ROWS });
    const f = document.createDocumentFragment();
    for (const g of groups) {
      const more = g.items.length > g.limit;
      const shown = more && !expanded.has(g.key) ? g.items.slice(0, g.limit) : g.items;
      const grp = mk('div');
      grp.className = 'sr-group' + (g.tile ? ' sr-group-tiles' : '');
      grp.setAttribute('role', 'group');
      const hdr = mk('div');
      hdr.className = 'sr-section';
      const tt = mk('span');
      tt.id = 'sr-sec-' + g.key;
      tt.textContent = g.title;
      hdr.appendChild(tt);
      grp.setAttribute('aria-labelledby', tt.id);
      const list = mk('div');
      list.className = g.tile ? 'sr-card' : 'sr-rows';
      for (const app of shown) list.appendChild(buildRow(app, optSeq++, g.tile));
      grp.append(hdr, list);
      if (more) grp.appendChild(moreOption(g, list));
      f.appendChild(grp);
    }
    res.appendChild(f);
  };

  /* Return opens the selected option, so the completion must name it. A
     right-to-left name cannot line up with the field. */
  const updGhost = () => {
    if (!ghost) return;
    const v = inp.value;
    const sel = opts()[si];
    const app = sel ? optApp.get(sel) : null;
    const name = app ? labelOf(app) : '';
    const ok =
      MOB() &&
      v.trim() === v &&
      v.length > 0 &&
      !!app &&
      name.toLowerCase().startsWith(v.toLowerCase()) &&
      getComputedStyle(inp).direction === 'ltr' &&
      !startsRtl(name) &&
      !startsRtl(name.slice(v.length)) &&
      inp.scrollWidth <= inp.clientWidth &&
      inp.selectionStart === v.length;
    ghost.hidden = !ok;
    if (!ok) return;
    const [typed, rest, hint] = /** @type {HTMLElement[]} */ (Array.from(ghost.children));
    typed.textContent = v;
    setUserText(rest, name.slice(v.length));
    hint.textContent = t('home.searchOpenHint');
  };

  const render = query => {
    res.replaceChildren();
    res.classList.remove('kbnav');
    optSeq = 0;
    const apps = getItems().filter(i => i.type === 'app' || i.type === 'folder');
    const qq = query.toLowerCase().trim();
    cur = qq ? apps.filter(a => labelOf(a).toLowerCase().includes(qq)) : apps;
    if (qq && MOB()) {
      const starts = cur.filter(a =>
        labelOf(a)
          .toLowerCase()
          .split(/[\s._-]+/)
          .some(w => w.startsWith(qq)),
      );
      if (starts.length) cur = starts;
    }
    si = 0;
    if (clearBtn) {
      clearBtn.hidden = !query && !MOB();
      clearBtn.setAttribute('aria-label', query ? t('home.searchClear') : t('common.close'));
    }
    if (MOB() && !qq) {
      cur = [];
      clearTimeout(liveTimer);
      if (live) live.textContent = '';
      inp.setAttribute('enterkeyhint', 'search');
      inp.setAttribute('aria-expanded', 'false');
      inp.setAttribute('aria-activedescendant', '');
      updGhost();
      return;
    }
    inp.setAttribute('enterkeyhint', qq && cur.length ? 'go' : 'search');
    if (!cur.length) {
      noResults();
      updGhost();
      return;
    }
    if (MOB()) renderMobile(qq);
    else renderDesktop();
    finish();
    updGhost();
  };

  /** @param {boolean} [viaKey] */
  const upd = (viaKey = true) => {
    if (viaKey) res.classList.add('kbnav');
    opts().forEach((e, i) => {
      const on = i === si;
      e.classList.toggle('sel', on);
      e.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        if (viaKey) e.scrollIntoView({ block: 'nearest' });
        inp.setAttribute('aria-activedescendant', e.id);
        if (e.classList.contains('sr')) fluidHoverKb(e);
        else fluidHoverClear(res);
      }
    });
    updGhost();
  };

  const fieldEl = q('.spot-field', ov);
  const fieldBg = q('.spot-bg', ov);
  if (fieldEl)
    fieldEl.addEventListener(
      'touchend',
      e => {
        e.preventDefault();
        inp.focus();
        if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
      },
      { passive: false },
    );

  /* Set both edges. iOS scrolls a smaller visual viewport over an unchanged
     page, so the height alone leaves the overlay off the screen. */
  /** @type {Animation | null} */
  let boxAnim = null;
  let caretTimer = 0;
  const stopGlide = () => {
    if (boxAnim) boxAnim.cancel();
    boxAnim = null;
  };
  /* iOS draws the caret apart from the animated field, so it is hidden
     until the field stops moving. */
  const hideCaret = () => {
    inp.style.caretColor = 'transparent';
    clearTimeout(caretTimer);
    caretTimer = window.setTimeout(() => {
      inp.style.caretColor = '';
    }, OPEN_MS);
  };
  const showCaret = () => {
    clearTimeout(caretTimer);
    inp.style.caretColor = '';
  };

  let kbFrame = 0;
  let kbTop = -1;
  let kbBottom = -1;
  /** @type {number | null} */
  let ovTopRef = null;
  const queueKbLayout = () => {
    if (!kbFrame)
      kbFrame = requestAnimationFrame(() => {
        kbFrame = 0;
        _applyKbLayout();
      });
  };
  const resetKbLayout = () => {
    if (kbFrame) cancelAnimationFrame(kbFrame);
    kbFrame = 0;
    kbTop = kbBottom = -1;
    ovTopRef = null;
  };

  function _applyKbLayout() {
    if (!MOB()) {
      if (kbTop === -1) return;
      stopGlide();
      resetKbLayout();
      ov.style.top = '';
      ov.style.bottom = '';
      ov.classList.remove('kb');
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const top = Math.max(0, Math.round(vv.offsetTop));
    const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - top));
    if (top === kbTop && bottom === kbBottom) return;
    kbTop = top;
    kbBottom = bottom;
    /* After a refocus Safari shrinks innerHeight with the keyboard, so
       measure against clientHeight, which stays put. */
    const kb = document.documentElement.clientHeight - vv.height > 120;
    const glide = !!box && ov.open && !keyOpened && !still();
    /* A refocus makes Safari scroll and move the overlay itself. Undo that
       shift so the glide starts where the field was on screen. */
    const shift = ovTopRef === null ? 0 : ov.getBoundingClientRect().top - ovTopRef;
    const y0 = glide ? box.getBoundingClientRect().top - shift : 0;
    stopGlide();
    ov.style.top = top + 'px';
    ov.style.bottom = bottom + 'px';
    ov.classList.toggle('kb', kb);
    ovTopRef = ov.getBoundingClientRect().top;
    if (glide) {
      const dy = y0 - box.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        boxAnim = box.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: KB_MS,
          easing: KB_EASE,
        });
        hideCaret();
      }
    }
  }

  const stopMorph = () => {
    for (const a of morphAnims) a.cancel();
    morphAnims = [];
  };

  /** @param {boolean} opening @param {DOMRect | null} [from] where the field is on screen when closing starts */
  function morph(opening, from = null) {
    stopMorph();
    if (!MOB() || keyOpened || still() || !fieldEl) return false;
    const pill = el('mob-search-pill');
    const p = pill ? pill.getBoundingClientRect() : null;
    if (!p || !p.width) return false;
    const f = fieldEl.getBoundingClientRect();
    const dx = p.left + p.width / 2 - (f.left + f.width / 2);
    const dy = p.top + p.height / 2 - (f.top + f.height / 2);
    const sx = Math.min(1, p.width / f.width);
    const sy = Math.min(1, p.height / f.height);
    const timing = opening
      ? { duration: KB_MS, easing: KB_EASE }
      : { duration: SHRINK_MS, easing: KB_EASE, fill: /** @type {FillMode} */ ('forwards') };
    const atPill = { transform: `translate(${dx}px,${dy}px)` };
    const start = from
      ? { transform: `translate(${from.left - f.left}px,${from.top - f.top}px)` }
      : { transform: 'translate(0,0)' };
    morphAnims.push(fieldEl.animate(opening ? [atPill, { transform: 'translate(0,0)' }] : [start, atPill], timing));
    if (fieldBg) {
      const grown = [{ transform: `scale(${sx},${sy})` }, { transform: 'scale(1,1)' }];
      morphAnims.push(fieldBg.animate(opening ? grown : grown.reverse(), timing));
    }
    for (const c of /** @type {HTMLElement[]} */ (Array.from(fieldEl.children))) {
      if (c === fieldBg) continue;
      morphAnims.push(
        c.animate(
          opening ? [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
          opening
            ? { duration: KB_MS, easing: EASE_OUT }
            : { duration: SHRINK_MS * 0.35, easing: EASE_OUT, fill: 'forwards' },
        ),
      );
    }
    return true;
  }

  /* Focus here, not in a later frame: keys typed in between are lost. Keep `on`
     before showModal. WebKit refuses focus while the dialog is display:none. */
  function open(ch) {
    if (ov.open) return;
    ++openGen;
    returnFocus = document.activeElement;
    keyOpened = !!ch;
    ov.classList.toggle('typed', keyOpened);
    expanded.clear();
    const pillEl = el('mob-search-pill');
    if (pillEl) pillEl.style.visibility = '';
    ov.classList.toggle(
      'morph',
      MOB() && !keyOpened && !still() && !!pillEl && pillEl.getBoundingClientRect().width > 0,
    );
    ov.classList.add('on');
    ov.showModal();
    inp.value = ch || '';
    render(inp.value);
    inp.focus();
    if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
    const grew = morph(true);
    ov.classList.toggle('morph', grew);
    if (grew) hideCaret();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', queueKbLayout);
      window.visualViewport.addEventListener('scroll', queueKbLayout);
      _w._spotVpCleanup = () => {
        window.visualViewport.removeEventListener('resize', queueKbLayout);
        window.visualViewport.removeEventListener('scroll', queueKbLayout);
      };
    }
    _applyKbLayout();
  }

  /* Escape would close the dialog outright and skip the fade, so it is refused
     and routed through close() like every other dismissal. */
  ov.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });

  /* The dialog closes at once, so the page takes input during the fade. The
     overlay stays drawn until the fade ends and lets input through. */
  ov.addEventListener('close', () => {
    /* A close that lands after a reopen would move focus out of the new field. */
    if (closeGen !== openGen) return;
    const back = returnFocus;
    returnFocus = null;
    /* Only while focus is still inside the closed dialog. A folder opened from
       a result has already taken it. */
    if (!ov.contains(document.activeElement)) return;
    if (back instanceof HTMLElement && back !== document.body && back.isConnected) back.focus();
    else inp.blur();
  });

  function close() {
    if (!ov.open) return;
    closeGen = ++openGen;
    inp.setAttribute('aria-expanded', 'false');
    inp.setAttribute('aria-activedescendant', '');
    if (_w._spotVpCleanup) {
      _w._spotVpCleanup();
      _w._spotVpCleanup = null;
    }
    const from = MOB() && fieldEl ? fieldEl.getBoundingClientRect() : null;
    stopGlide();
    showCaret();
    resetKbLayout();
    ov.style.top = '';
    ov.style.bottom = '';
    ov.classList.remove('kb');
    ov.close();
    const shrank = morph(false, from);
    ov.classList.toggle('morph', shrank);
    const pill = shrank ? el('mob-search-pill') : null;
    if (pill) pill.style.visibility = 'hidden';
    if (ghost) ghost.hidden = true;
    clearTimeout(liveTimer);
    if (live) live.textContent = '';
    const gen = openGen;
    if (shrank)
      setTimeout(() => {
        if (pill) pill.style.visibility = '';
        if (gen !== openGen || !fieldBg) return;
        morphAnims.push(
          fieldBg.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: SHRINK_MS * 0.55,
            easing: EASE_OUT,
            fill: 'forwards',
          }),
        );
      }, SHRINK_MS * 0.45);
    setTimeout(
      () => {
        if (pill) pill.style.visibility = '';
        if (gen !== openGen) return;
        ov.classList.remove('on', 'morph');
        stopMorph();
        inp.value = '';
        res.replaceChildren();
      },
      (shrank ? SHRINK_MS : KB_MS) + 20,
    );
  }

  if (clearBtn) {
    const clear = () => {
      if (!inp.value) {
        close();
        return;
      }
      inp.value = '';
      expanded.clear();
      render('');
      inp.focus();
    };
    clearBtn.addEventListener(
      'touchend',
      e => {
        e.preventDefault();
        e.stopPropagation();
        clear();
      },
      { passive: false },
    );
    clearBtn.addEventListener('mousedown', e => e.preventDefault());
    clearBtn.onclick = clear;
  }

  ov.onclick = e => {
    if (e.target === ov || e.target === res) close();
  };
  ov.addEventListener(
    'touchend',
    e => {
      if (e.target === ov) {
        e.preventDefault();
        close();
      }
    },
    { passive: false },
  );

  if (cancelBtn) {
    cancelBtn.onclick = close;
    cancelBtn.addEventListener(
      'touchend',
      e => {
        e.preventDefault();
        e.stopPropagation();
        close();
      },
      { passive: false },
    );
  }

  inp.oninput = () => {
    expanded.clear();
    render(inp.value);
  };
  inp.addEventListener('select', updGhost);
  inp.addEventListener('compositionstart', () => {
    if (ghost) ghost.hidden = true;
  });
  inp.onkeydown = e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      si = Math.max(0, Math.min(si + 1, opts().length - 1));
      upd();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      si = Math.max(si - 1, 0);
      upd();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      const s = opts()[si];
      const toggle = s && moreToggle.get(s);
      if (toggle) {
        e.preventDefault();
        toggle(true);
      } else if (s) {
        s.click();
        close();
      }
    }
  };

  document.addEventListener(
    'keydown',
    e => {
      if (document.querySelector('dialog[open]:not(#spot)')) return;
      if (ov.open || ov.inert || !typeToOpen()) return;
      if (e.key === 'Escape' || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' && e.target instanceof Element && e.target.closest(ACTIVATES_ON_SPACE)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      open(e.key);
    },
    true,
  );

  CB.spotOpen = open;
  CB.spotClose = close;
}
