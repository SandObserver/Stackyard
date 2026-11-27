import { checkAuth, requireLogin } from '/js/admin-auth.js?v=3e879922';
import { initEditor, openEditor, openFolderPicker, wireListButtons } from '/js/admin-editor.js?v=b96512bc';
import { initList, render, wireFilter } from '/js/admin-list.js?v=8b0c9f55';
import { createListWrites } from '/js/admin-list-writes.js?v=1b721691';
import { animateNavIcons, initNav } from '/js/admin-nav.js?v=5a3fd4fb';
import { createPageLoad } from '/js/admin-page-load.js?v=cf172f93';
import { settingsDirty } from '/js/admin-settings.js?v=7ba65299';
import { initSettingsControls } from '/js/admin-settings-controls.js?v=6d13763f';
import { setReauthHandler } from '/js/admin-shared.js?v=674bbb0b';
import { wireTransfer } from '/js/admin-transfer.js?v=38c74021';
import { recoveryShown } from '/js/config-recovery.js?v=ebb72f77';
import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
import { syncGlideSelect } from '/js/glide-select.js?v=0c57b286';
import { ensureSprite } from '/js/icon-set.js?v=1e268244';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=6680c0bf';
import { el } from '/js/utils.js?v=457d9918';
import { initGlassControls } from '/js/glass-controls.js?v=6af34299';

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
