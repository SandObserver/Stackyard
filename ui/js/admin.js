import { checkAuth, requireLogin } from '/js/admin-auth.js?v=c7e6096f';
import { initEditor, openEditor, openFolderPicker, wireListButtons } from '/js/admin-editor.js?v=60c30723';
import { initList, render, wireFilter } from '/js/admin-list.js?v=3565b0d8';
import { createListWrites } from '/js/admin-list-writes.js?v=9fe56c94';
import { animateNavIcons, initNav } from '/js/admin-nav.js?v=5a609c7d';
import { createPageLoad } from '/js/admin-page-load.js?v=04284192';
import { settingsDirty } from '/js/admin-settings.js?v=cf8fada5';
import { initSettingsControls } from '/js/admin-settings-controls.js?v=c4b8ba2e';
import { setReauthHandler } from '/js/admin-shared.js?v=315941b7';
import { wireTransfer } from '/js/admin-transfer.js?v=584a8483';
import { recoveryShown } from '/js/config-recovery.js?v=797944ce';
import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
import { syncGlideSelect } from '/js/glide-select.js?v=0c57b286';
import { ensureSprite } from '/js/icon-set.js?v=361e54a5';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=6680c0bf';
import { el } from '/js/utils.js?v=9ed2b298';
import { initGlassControls } from '/js/glass-controls.js?v=4d8214ad';

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
