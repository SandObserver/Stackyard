import { checkAuth, requireLogin } from '/js/admin-auth.js?v=d7dfac01';
import { initEditor, openEditor, openFolderPicker, wireListButtons } from '/js/admin-editor.js?v=89f14dcd';
import { initList, render, wireFilter } from '/js/admin-list.js?v=a791e0ce';
import { createListWrites } from '/js/admin-list-writes.js?v=21cd883d';
import { animateNavIcons, initNav } from '/js/admin-nav.js?v=54b402c7';
import { createPageLoad } from '/js/admin-page-load.js?v=bebed9b3';
import { settingsDirty } from '/js/admin-settings.js?v=882c01f7';
import { initSettingsControls } from '/js/admin-settings-controls.js?v=2a5e53bc';
import { setReauthHandler } from '/js/admin-shared.js?v=39ca44cc';
import { wireTransfer } from '/js/admin-transfer.js?v=6e1054e7';
import { recoveryShown } from '/js/config-recovery.js?v=5f7d1e49';
import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
import { syncGlideSelect } from '/js/glide-select.js?v=0c57b286';
import { ensureSprite } from '/js/icon-set.js?v=beda3062';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=6680c0bf';
import { el } from '/js/utils.js?v=457d9918';
import { initGlassControls } from '/js/glass-controls.js?v=06fcd355';

/** @type {any} */ (window).__bootStarted = true;

ensureSprite();
animateNavIcons();

/* A class rather than a bare media query. Some phones report a wider CSS
   viewport than they have. The rule lives in layout.js, shared with the
   dashboard, so the two screens cannot disagree about what mobile means. */
function _syncMobile(mobile) {
  document.documentElement.classList.toggle('is-mobile', mobile);
  syncGlideSelect();
}
initFluidHover();
initGlassControls();

const _mobileAtLoad = isMobileLayout();
_syncMobile(_mobileAtLoad);
onLayoutChange(_syncMobile, _mobileAtLoad);

const dashSaveEl = /** @type {HTMLButtonElement|null} */ (el('dash-save'));
const writes = createListWrites({ render, saveButton: dashSaveEl });
const page = createPageLoad({ writes });

initEditor({ saveOrRevert: writes.saveOrRevert });
wireFilter();
wireListButtons();

if (dashSaveEl) dashSaveEl.onclick = () => writes.save();
addEventListener('beforeunload', e => {
  if (recoveryShown()) return;
  if (!settingsDirty() && !writes.unsaved()) return;
  e.preventDefault();
  e.returnValue = '';
});

wireTransfer({ restoreBackup: writes.restoreBackup, appendAndSave: writes.appendAndSave });

initList({ openModal: openEditor, openFolderPicker, save: writes.saveOrRevert });
initNav();
initSettingsControls();

setReauthHandler(requireLogin);

screen.orientation?.addEventListener('change', page.applyBg);

checkAuth(page.loadOrShowFailure).then(ok => {
  if (ok) return page.loadOrShowFailure();
  document.documentElement.classList.remove('lang-pending');
  document.body.classList.add('load-stopped');
});
