import {
  buildAppForm,
  buildFolderForm,
  buildSettingsTileForm,
  captureActLabels,
  serializeKvRows,
} from '/js/admin-app-form.js?v=b37bb1ab';
import { focusRow, isReordering, setReordering } from '/js/admin-list.js?v=d1cefe2a';
import { folderChildren } from '/js/admin-logic.js?v=81fd47cf';
import { scrollSettingsTop } from '/js/admin-nav.js?v=465fb192';
import {
  applyEdit,
  buildAppItem,
  keptWidget,
  newItemId,
  POLL_MAX,
  POLL_MIN,
  removeItem,
  snapshotItems,
} from '/js/admin-save-logic.js?v=2a82f10d';
import {
  busyPress,
  clearFieldErrors,
  errorAction,
  errorText,
  failedSave,
  fadeIn,
  paintIcon,
  showFieldError,
  swapContent,
  toast,
} from '/js/admin-shared.js?v=0f28a237';
import { state } from '/js/admin-state.js?v=064b9b85';
import { buildWidgetForm } from '/js/admin-widget-form.js?v=30b500f1';
import { BADGE_DEFAULT } from '/js/badge-logic.js?v=7112fd10';
import { formatNumber } from '/js/format-number.js?v=263fa390';
import { html, raw, setHtml } from '/js/html.js?v=48f9dc21';
import { t } from '/js/i18n.js?v=82ba9da2';
import { animateIcon } from '/js/icon-motion.js?v=7bfd91f5';
import { iconSvg } from '/js/icon-set.js?v=beda3062';
import { clampName } from '/js/limits.js?v=ff61256e';
import { confirmText, openModal as openDialog } from '/js/modal.js?v=93d3e755';
import { clr, el, focusFirst, initial, inp, isolate, q, qa, setUserText } from '/js/utils.js?v=457d9918';

/** @typedef {{ saveOrRevert: (before: any[], done?: string|false) => Promise<boolean> }} EditorPage */

/** @type {EditorPage} */
let _page = { saveOrRevert: async () => false };

let _keyboardPress = false;

/** Track whether the last click came from a keyboard. The listener runs in
    the capture phase, before the click handler that opens the editor.
    @param {EditorPage} page */
export function initEditor(page) {
  _page = page;
  document.addEventListener(
    'click',
    e => {
      _keyboardPress = e.detail === 0;
    },
    true,
  );
}

/** Wire the list header's Add and Reorder buttons. */
export function wireListButtons() {
  el('btn-add').onclick = () => openEditor(null);
  el('btn-reorder').onclick = () => setReordering(!isReordering());
}

/** @param {string|null} [focusId] the item whose row takes focus */
function showListView(focusId = null) {
  el('dash-list-view').classList.remove('d-none');
  el('dash-edit-view').classList.add('d-none');
  if (!_keyboardPress) fadeIn(el('dash-list-view'));
  if (!focusRow(focusId)) focusFirst(el('btn-add'));
}

function showEditView() {
  setReordering(false);
  el('dash-list-view').classList.add('d-none');
  el('dash-edit-view').classList.remove('d-none');
  scrollSettingsTop();
  if (!_keyboardPress) fadeIn(el('dash-edit-view'));
}

/* Read at draw time. The catalog is not loaded when this module evaluates. */
const typeLabels = () => ({ app: t('type.app'), widget: t('type.widget'), folder: t('type.folder') });

function buildAddNewCard() {
  const grp = document.createElement('div');
  grp.className = 'grp add-new-card';
  const row = document.createElement('div');
  row.className = 'row tile-row';
  const grpTiles = document.createElement('fieldset');
  grpTiles.className = 'tile-grp';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = t('app.type');
  grpTiles.appendChild(legend);
  const labels = typeLabels();
  ['app', 'widget', 'folder'].forEach(kind => {
    const label = labels[kind];
    const b = document.createElement('label');
    b.className = 'tile-opt' + (kind === state.ctype ? ' on' : '');
    b.dataset.ctype = kind;
    setHtml(
      b,
      html`<input type="radio" name="ev-ctype" value="${kind}"><span class="tile-ico">${raw(iconSvg(kind, 38))}</span><span class="tile-cap">${label}</span>`,
    );
    const radio = /** @type {HTMLInputElement} */ (b.querySelector('input'));
    radio.checked = kind === state.ctype;
    const ico = b.querySelector('svg');
    if (ico instanceof SVGSVGElement) animateIcon(ico, kind, b);
    radio.addEventListener('change', () => {
      if (state.ctype === kind) return;
      state.ctype = kind;
      swapContent(el('ev-body'), () => renderEditBody(kind));
    });
    grpTiles.appendChild(b);
  });
  row.appendChild(grpTiles);
  grp.appendChild(row);
  return grp;
}

/** @param {Element} card */
function syncAddNewCard(card) {
  for (const b of qa('.tile-opt', card)) {
    const on = /** @type {HTMLElement} */ (b).dataset.ctype === state.ctype;
    b.classList.toggle('on', on);
    const radio = /** @type {HTMLInputElement|null} */ (b.querySelector('input'));
    if (radio) radio.checked = on;
  }
  return card;
}

/* Prepended after the builder runs, so the builder's reset cannot wipe it. */
/** @param {string} [focusKind] the type tile that keeps focus */
function renderEditBody(focusKind) {
  const body = el('ev-body');
  const card = focusKind ? body.querySelector(':scope > .add-new-card') : null;
  body.replaceChildren();
  if (state.ctype === 'widget') buildWidgetForm(body, state._evItem);
  else if (state.ctype === 'folder') buildFolderForm(body, state._evItem);
  else if (state.ctype === 'settings') buildSettingsTileForm(body, state._evItem);
  else buildAppForm(body, state._evItem);
  if (!state._evIsEdit) body.insertBefore(card ? syncAddNewCard(card) : buildAddNewCard(), body.firstChild);
  setTimeout(() => {
    if (el('dash-edit-view').contains(document.activeElement)) return;
    const tile = focusKind ? q(`.tile-opt[data-ctype="${focusKind}"] input`, body) : null;
    focusFirst(tile, ...qa('input,select,textarea,button', body));
  }, 50);
}

/** Open the editor for an item, or for a new one when `id` is null.
    @param {string|null} id */
export function openEditor(id) {
  const editing = id != null ? state.items.find(i => i?.id === id) : null;
  if (id != null && !editing) {
    toast(t('toast.dashboardChangedElsewhere'), 'err');
    return;
  }
  state.eid = editing?.id ?? null;
  const item = editing ? structuredClone(editing) : null;
  state.ctype = item?.system === 'settings' ? 'settings' : item?.type || 'app';
  state.siurl = item?.iconUrl || '';
  state.scol = item ? item.color || 'dark' : 'auto';
  state._customUrl = item?.url || '';
  state._iframeOpts = item?.iframe ? { ...item.iframe } : {};
  state.fnums = [];
  state.spaths = [];
  state.slabels = Object.create(null);
  const actLabels = item?.monitoring?.activity?.labels;
  /* An older config summed its values. Saving must not turn that into a list. */
  state.slegacySum = false;
  if (Array.isArray(actLabels) && actLabels.length) {
    for (const l of actLabels) {
      if (!l || typeof l.path !== 'string' || !l.path) continue;
      state.spaths.push(l.path);
      state.slabels[l.path] = {
        name: l.name || '',
        unit: l.unit || '',
        color: l.color || BADGE_DEFAULT,
        min: l.min == null ? '' : String(l.min),
      };
    }
  } else if (item?.monitoring?.activity?.extract) {
    const ex = Array.isArray(item.monitoring.activity.extract)
      ? item.monitoring.activity.extract
      : [item.monitoring.activity.extract];
    state.spaths = ex.map(e => (typeof e === 'string' ? e : e.path)).filter(Boolean);
    state.slegacySum = state.spaths.length >= 2;
  } else if (item?.badge?.extract) {
    const ex = Array.isArray(item.badge.extract) ? item.badge.extract : [item.badge.extract];
    state.spaths = ex.map(e => (typeof e === 'string' ? e : e.path)).filter(Boolean);
    state.slegacySum = state.spaths.length >= 2;
  }
  /* The save reads a summed or single-path badge's style from the first label.
     Without this seed the stored style is lost. */
  const custom = item?.monitoring?.activity?.custom;
  if (!state.slabels[state.spaths[0]] && state.spaths.length && custom && typeof custom === 'object') {
    state.slabels[state.spaths[0]] = {
      name: '',
      unit: typeof custom.unit === 'string' ? custom.unit : '',
      color: typeof custom.color === 'string' && custom.color ? custom.color : BADGE_DEFAULT,
      min: custom.min == null ? '' : String(custom.min),
    };
  }

  const isEdit = id != null;
  const evTitle = el('ev-title');
  if (isEdit) setUserText(evTitle, t('common.editNamed', { name: isolate(item.label || item.id) }));
  else {
    evTitle.textContent = t('type.addNew');
    evTitle.removeAttribute('dir');
  }
  const delBtn = el('ev-delete');
  const saveBtn = /** @type {HTMLButtonElement} */ (el('ev-save'));
  if (delBtn) {
    delBtn.classList.toggle('d-none', !isEdit || state.ctype === 'settings');
    delBtn.onclick = () => deleteItem(item);
  }
  if (saveBtn) {
    saveBtn.onclick = busyPress(saveBtn, () => saveItem(item));
  }
  const backBtn = el('ev-back');
  if (backBtn) backBtn.onclick = () => closeEditor();

  state._evItem = item;
  state._evIsEdit = isEdit;
  state._evSession += 1;
  renderEditBody();

  showEditView();
}

/** @param {any} item the item the editor was opened on */
async function deleteItem(item) {
  if (!item) return;
  const isFolder = item.type === 'folder';
  const ok = await confirmText({
    title: t('confirm.deleteTitle', { name: isolate(item.label || item.id) }),
    text: isFolder ? t('confirm.deleteFolder') : '',
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    destructive: true,
  });
  if (!ok) return;
  const before = snapshotItems(state.items);
  if (!removeItem(state.items, item.id)) {
    closeEditor(null);
    toast(t('toast.dashboardChangedElsewhere'), 'err');
    return;
  }
  const session = state._evSession;
  if ((await _page.saveOrRevert(before, t('toast.deleted'))) && session === state._evSession) showListView();
}

/** @param {string|null} [focusId] the item whose row takes focus */
function closeEditor(focusId = state.eid) {
  showListView(focusId);
  state.eid = null;
  state._wtype = 'custom';
  state._wsize = 'medium';
  state._customUrl = '';
  state._wlabel = '';
  state._iframeOpts = {};
}

/** @param {string} folderId */
export function openFolderPicker(folderId) {
  const folders = state.items.filter(i => i.type === 'folder');

  const dlg = openDialog({ title: t('folder.addApp') });
  const list = dlg.body;
  const close = dlg.close;

  const rowBtn = onAct => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-row';
    b.onclick = onAct;
    return b;
  };

  const tf = folders.find(f => f.id === folderId);
  const available = tf
    ? state.items.filter(i => i.type === 'app' && !i.dock && !folderChildren(tf).includes(i.id))
    : [];
  if (!available.length) {
    const em = document.createElement('div');
    em.className = 'dlg-empty';
    em.textContent = t('folder.allInFolder');
    list.appendChild(em);
  }
  available.forEach(app => {
    const b = rowBtn(() => {
      const before = snapshotItems(state.items);
      state.items.forEach(f => {
        if (f.type === 'folder') f.children = folderChildren(f).filter(id => id !== app.id);
      });
      tf.children.push(app.id);
      _page.saveOrRevert(before);
      close();
    });
    const ri = document.createElement('span');
    ri.className = 'fp-ic';
    ri.style.background = clr(app.color);
    paintIcon(ri, app.iconUrl, initial(app.label));
    const nm = document.createElement('span');
    nm.className = 'fp-nm';
    setUserText(nm, app.label || app.id);
    b.append(ri, nm);
    list.appendChild(b);
  });

  dlg.addAction(t('common.cancel'), 'bg sm', close);
  dlg.focus(q('button', list));
}

/** The item the open form describes, or undefined after it marked the field
    that stops the save.
    @param {any} orig the item the editor was opened on, or null for a new one
    @returns {Record<string, any>|undefined} */
export function readItem(orig) {
  if (state.ctype === 'widget') {
    const wlabel = clampName(state._wlabel.trim() || state._widgetReg?.[state._wtype]?.label || t('type.widget'));
    if (state._autoForm && state._autoFormType === state._wtype && state._widgetReg[state._wtype]) {
      const missing = state._autoForm.validate();
      if (missing.length) {
        showFieldError(missing[0].row, t('toast.fieldRequired', { field: missing[0].label }));
        return;
      }
      return {
        id:
          orig?.id ||
          newItemId(
            wlabel,
            'widget',
            state.items.map(i => i.id),
          ),
        type: 'widget',
        widgetType: state._wtype,
        label: wlabel,
        widgetSize: state._wsize,
        widgetConfig: state._autoForm.getValues(),
      };
    }
    if (state._wtype === 'custom') {
      const url = inp('f-url')?.value?.trim();
      if (!url) {
        showFieldError(el('cust-url-row'), t('toast.urlRequired'));
        return;
      }
      const ifo = {};
      if (state._iframeOpts.referrerPolicy) ifo.referrerPolicy = state._iframeOpts.referrerPolicy;
      if (state._iframeOpts.allow) ifo.allow = state._iframeOpts.allow;
      if (state._iframeOpts.allowFullscreen === false) ifo.allowFullscreen = false;
      if (state._iframeOpts.refreshInterval) ifo.refreshInterval = state._iframeOpts.refreshInterval;
      /** @type {Record<string, any>} */
      const item = {
        id:
          orig?.id ||
          newItemId(
            wlabel,
            'widget',
            state.items.map(i => i.id),
          ),
        type: 'widget',
        widgetType: 'custom',
        label: wlabel,
        widgetSize: state._wsize,
        url,
      };
      if (Object.keys(ifo).length) item.iframe = ifo;
      return item;
    }
    if (orig) return keptWidget(orig, wlabel, orig.widgetSize);
    return;
  }
  if (state.ctype === 'settings') {
    const shown = !!inp('f-shown')?.checked;
    const item = { ...orig, dock: shown && !!inp('f-dock')?.checked };
    if (shown) delete item.hidden;
    else item.hidden = true;
    return item;
  }
  if (state.ctype === 'folder') {
    const label = clampName(inp('f-fname')?.value?.trim() || '');
    if (!label) {
      showFieldError(el('ie-fname'), t('toast.nameRequired'));
      return;
    }
    const children = state._folderApps?.getValue() || [];
    return {
      id:
        orig?.id ||
        newItemId(
          label,
          'folder',
          state.items.map(i => i.id),
        ),
      type: 'folder',
      label,
      children,
    };
  }
  const isPing = inp('hc-type-ping')?.checked;
  const isPve = inp('hc-type-pve')?.checked;
  captureActLabels();
  const v = {
    label: clampName(inp('f-lbl')?.value?.trim() || ''),
    href: inp('f-href')?.value?.trim(),
    hcEn: inp('hc-en')?.checked,
    hcCon: isPing || isPve ? '' : inp('hc-con')?.value?.trim() || '',
    hcPing: isPing ? inp('hc-ping')?.value?.trim() || '' : '',
    hcPve: isPve ? Number(state._pveGuest?.getValue()) || 0 : 0,
    skipTlsVerify: inp('f-skip-tls')?.checked || false,
    actEn: inp('act-en')?.checked,
    actUrl: inp('f-burl')?.value?.trim() || '',
    actInt: inp('f-bint')?.value ?? '',
    authEn: inp('auth-en')?.checked || false,
    actParams: serializeKvRows(state._bpar),
    actHeaders: serializeKvRows(state._bhdr),
    actLogin: { username: inp('f-buser')?.value?.trim() || '', password: inp('f-bpass')?.value || '' },
    staticEn: inp('static-en')?.checked || false,
    staticLabel: inp('f-static-label')?.value?.trim() || '',
    staticColor: inp('static-col-val')?.value || BADGE_DEFAULT,
    dock: inp('f-dock')?.checked || false,
    iconUrl: state.siurl,
    scol: state.scol,
    spaths: state.spaths,
    actCombine: inp('act-combine')?.checked || false,
    slabels: state.slabels,
  };
  const res = buildAppItem(
    v,
    orig,
    state.items.map(i => i.id),
  );
  if (res.errorKey === 'toast.pollRange') {
    showFieldError(
      q('#poll-row > .row'),
      t('toast.pollRange', { min: formatNumber(POLL_MIN), max: formatNumber(POLL_MAX) }),
    );
    return;
  }
  if (res.errorKey) {
    showFieldError(el(res.errorKey === 'toast.urlRequired' ? 'ie-url' : 'ie-name'), t(res.errorKey));
    return;
  }
  return res.item;
}

/** @param {any} orig the item the editor was opened on, or null for a new one */
async function saveItem(orig) {
  clearFieldErrors(el('ev-body'));
  try {
    const item = readItem(orig);
    if (!item) return;
    /* By id, never by position. */
    const { before, replaced } = applyEdit(state.items, state.eid, item);
    const session = state._evSession;
    /* The editor stays open on a failed write, with the form intact. */
    if (!(await _page.saveOrRevert(before))) {
      failedSave(el('ev-save'));
      return;
    }
    if (session === state._evSession) closeEditor(item.id);
    toast(t(replaced ? 'toast.updated' : 'toast.added'));
  } catch (e) {
    failedSave(el('ev-save'));
    toast(t('toast.saveFailed', { err: errorText(e) }), 'err', errorAction(e));
  }
}
