import { restorePage } from '/js/dashboard-logic.js?v=b4828b62';
import { PAGE_STORE } from '/js/dashboard-pager.js?v=f6910a39';
import { tryBuild } from '/js/dashboard-screens.js?v=79b0c104';
import { onLayoutChange } from '/js/layout.js?v=6680c0bf';
import { buildMobile } from '/js/ui.js?v=bc665c94';
import { el, loadImagesNow, storeGet } from '/js/utils.js?v=457d9918';

/** @param {{
      dash: import('/js/dashboard-state.js?v=51013727').DashboardState,
      grid: import('/js/dashboard-grid.js?v=20529cfb').DesktopGrid,
      pager: import('/js/dashboard-pager.js?v=f6910a39').Pager,
      wallpaper: import('/js/dashboard-wallpaper.js?v=e4719c98').Wallpaper,
    }} deps */
export function createLayout({ dash, grid, pager, wallpaper }) {
  const { goTo } = pager;
  const { retone, resampleBg } = wallpaper;
  /* One rotation fires several of the events below. Rebuild only when the
     space moved since the last build: each rebuild reloads every widget. */
  let _mw = innerWidth;
  let _saAt = '';
  /** @type {HTMLElement|null} */
  let saProbe = null;
  const saSize = () => {
    if (!saProbe) return '';
    const r = saProbe.getBoundingClientRect();
    return `${r.width}x${r.height}`;
  };
  const spaceMoved = () => innerWidth !== _mw || saSize() !== _saAt;
  const loadVisibleIcons = () => {
    loadImagesNow(el('dock'));
    loadImagesNow(el('pages').children[dash.pg]);
  };
  /** @type {() => void} */
  let firstBuilt = () => {};
  const firstBuild = new Promise(resolve => {
    firstBuilt = () => resolve(undefined);
  });
  let buildCall = 0;
  const buildLayout = () => {
    _mw = innerWidth;
    _saAt = saSize();
    const call = ++buildCall;
    if (dash.mob) {
      document.body.classList.add('is-mob');
      /* The phone layout measures the viewport as it builds, so it waits for
         layout. */
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          /* A later build replaces this one. Running it would put phone pages
             on the desktop layout. */
          if (call !== buildCall) return;
          tryBuild(() => {
            dash.totalPages = buildMobile();
            goTo(restorePage(storeGet(PAGE_STORE), dash.totalPages), false, false);
            dash.CB.mobPillSync?.(dash.pg);
            loadVisibleIcons();
            retone();
          });
          firstBuilt();
        }),
      );
    } else {
      document.body.classList.remove('is-mob');
      tryBuild(() => {
        dash.totalPages = grid.buildDesktop();
        goTo(restorePage(storeGet(PAGE_STORE), dash.totalPages), false);
        loadVisibleIcons();
        retone();
      });
      firstBuilt();
    }
  };

  const watchLayoutChange = () =>
    onLayoutChange(
      mobile => {
        dash.mob = mobile;
        buildLayout();
      },
      dash.mob,
      true,
    );

  /* The platform reports its safe-area insets after the first paint, and again after a
     rotation. The probe is sized by them, so its box changing is the signal
     that the space the layout was measured against has moved. */
  const watchSafeArea = () => {
    if (typeof ResizeObserver !== 'function') return;
    const probe = document.createElement('div');
    probe.className = 'sa-probe';
    document.body.appendChild(probe);
    saProbe = probe;
    let _sat,
      _saH = -1,
      _saW = -1,
      _saFirst = true;
    new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      if (h === _saH && w === _saW) return;
      _saH = h;
      _saW = w;
      /* Observing delivers the current size at once, and the layout being built
         now already has it. */
      if (_saFirst) {
        _saFirst = false;
        return;
      }
      clearTimeout(_sat);
      _sat = setTimeout(() => {
        if (dash.mob && spaceMoved()) buildLayout();
      }, 100);
    }).observe(probe);
  };

  /* A rotation that does not cross the breakpoint still changes how much fits,
     and the mobile layout is measured. Debounced, and only while it is the
     layout in use: on a phone the keyboard opening resizes the viewport too. */
  const watchOrientation = () => {
    let _rt;
    screen.orientation.addEventListener('change', () => {
      clearTimeout(_rt);
      _rt = setTimeout(() => {
        if (dash.mob && spaceMoved()) buildLayout();
        resampleBg();
      }, 150);
    });
  };

  /* The desktop tile size follows the viewport, so a resize can change how many
     rows fit. Rebuild only when the slot count actually moves, not on every
     pixel: a rebuild tears down and remounts every widget iframe. */
  const watchResize = () => {
    let _dz,
      _slots = grid.slots();
    /* The phone layout rebuilds on a width change only. A phone keyboard changes
       the height, and a rebuild then would close it. */
    let _rs;
    window.addEventListener('resize', () => {
      clearTimeout(_rs);
      _rs = setTimeout(() => {
        resampleBg();
        if (dash.mob && innerWidth !== _mw) buildLayout();
      }, 200);
      if (dash.mob) return;
      clearTimeout(_dz);
      _dz = setTimeout(() => {
        if (dash.mob) return;
        grid.measure();
        const slots = grid.slots();
        if (slots === _slots) return;
        _slots = slots;
        tryBuild(() => {
          dash.totalPages = grid.buildDesktop();
          goTo(dash.pg, false);
          retone();
        });
      }, 200);
    });
  };

  return { buildLayout, firstBuild, watchLayoutChange, watchSafeArea, watchOrientation, watchResize };
}
