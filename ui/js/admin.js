import { checkAuth, requireLogin } from '/js/admin-auth.js?v=482e24df';
import { initEditor, openEditor, openFolderPicker, wireListButtons } from '/js/admin-editor.js?v=63463cbd';
import { initList, render, wireFilter } from '/js/admin-list.js?v=71c919a2';
import { createListWrites } from '/js/admin-list-writes.js?v=e2a67e59';
import { animateNavIcons, initNav } from '/js/admin-nav.js?v=ec90e324';
import { createPageLoad } from '/js/admin-page-load.js?v=3e91309e';
import { settingsDirty } from '/js/admin-settings.js?v=8b583d13';
import { initSettingsControls } from '/js/admin-settings-controls.js?v=b5e94cef';
import { setReauthHandler } from '/js/admin-shared.js?v=fc3e9049';
import { wireTransfer } from '/js/admin-transfer.js?v=81ff2b7f';
import { recoveryShown } from '/js/config-recovery.js?v=17cd0093';
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
