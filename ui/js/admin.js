import { buildAppForm, buildFolderForm, captureActLabels, serializeKvRows } from '/js/admin-app-form.js?v=c86f9f02';
import { checkAuth, requireLogin, wirePasswordStrength } from '/js/admin-auth.js?v=9ea23064';
import { initList, render, syncFilterUI } from '/js/admin-list.js?v=448f1f49';
import { resolveAdminSection } from '/js/admin-logic.js?v=d17394da';
import {
  buildAppItem,
  claimFolderChildren,
  newItemId,
  saveWithRevert,
  snapshotItems,
  upsertItem,
} from '/js/admin-save-logic.js?v=48a9e055';
import { loadSettings, showBgFields, showBgFit, showWallpaperFile } from '/js/admin-settings.js?v=40d84dc5';
import { ag, ap, initInlineEdit, paintIcon, setReauthHandler, toast } from '/js/admin-shared.js?v=76c76594';
import { collapsedFolders, filter, state } from '/js/admin-state.js?v=7d68e98e';
import { buildWidgetForm } from '/js/admin-widget-form.js?v=a28e476c';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { initI18n, LANGUAGES, t } from '/js/i18n.js?v=e644a5c5';
import { loadLocalIcons } from '/js/icons.js?v=69c2b9bd';
import {
  clearSkipTls,
  convert,
  detectSource,
  insecureApps,
  NOTE,
  parseErrorsAsSkipped,
  SKIP,
} from '/js/import-foreign.js?v=ef4f3d44';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=9de1cb7d';
import { confirmModal, openModal as openDialog, promptModal } from '/js/modal.js?v=5da8a871';
import { readMode, watchSystemTheme, writeMode } from '/js/theme.js?v=00c011c9';
import { el, inp, q, qa, clr as rc, sanitizeCssUrl, setUserText, tgt } from '/js/utils.js?v=d949e985';
import { normalizeColorInput } from '/js/admin-color-control.js?v=1cd86a5a';
import { parseYamlTolerant, YamlLiteError } from '/js/yaml-lite.js?v=1907cce7';

/* A class rather than a bare media query. Some phones report a wider CSS
   viewport than they have. The rule lives in layout.js, shared with the
   dashboard, so the two screens cannot disagree about what mobile means. */
function _syncMobile(mobile) {
  document.documentElement.classList.toggle('is-mobile', mobile);
}
const _mobileAtLoad = isMobileLayout();
_syncMobile(_mobileAtLoad);
onLayoutChange(_syncMobile, _mobileAtLoad);

async function load() {
  await loadLocalIcons();
  const c = await ag('/api/config');
  state.items = c.items || [];
  state._settings = c.settings || {};
  await initI18n(c.settings?.language || 'en');
  document.title = t('nav.pageTitle');
  initVersion();
  syncThemeLabel();
  try {
    const wr = await ag('/api/widgets');
    state._widgetReg = Object.create(null);
    (wr.widgets || []).forEach(w => {
      state._widgetReg[w.name] = w;
    });
    state._widgetRejected = wr.rejected || [];
  } catch {
    state._widgetReg = Object.create(null);
    state._widgetRejected = [];
  }
  state.items.filter(i => i.type === 'folder').forEach(f => collapsedFolders.add(f.id));
  document.body.classList.add('authed');
  render();
  loadSettings(c);
  applyBg();
}

async function applyBg() {
  const root = document.documentElement;
  try {
    const bg = (state._settings && state._settings.background) || {};
    if (bg.type === 'color' && bg.color) {
      root.style.setProperty('--bg-image', 'none');
      root.style.setProperty('--bg-color', String(bg.color).replace(/[^a-zA-Z0-9#(),.\s%]/g, ''));
      root.style.setProperty('--bg-brightness', '1');
      root.style.setProperty('--bg-size', 'cover');
    } else if (bg.type === 'url' && bg.url) {
      root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(bg.url)}')`);
      root.style.setProperty('--bg-color', '#0d1117');
      root.style.setProperty('--bg-brightness', String(bg.brightness ?? 0.62));
      root.style.setProperty('--bg-size', bg.fit === 'fit' ? 'contain' : 'cover');
    } else if (bg.type === 'unsplash') {
      const r = await fetch('/api/wallpaper', { cache: 'no-store' });
      const d = await r.json();
      if (d.url) {
        const img = new Image();
        img.onload = () => {
          root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(d.url)}')`);
          root.style.setProperty('--bg-color', '#0d1117');
          root.style.setProperty('--bg-brightness', String(bg.brightness ?? 0.62));
          root.style.setProperty('--bg-size', 'cover');
        };
        img.src = d.url;
      }
    }
  } catch {}
}
/** Returns whether the write reached the server. */
async function save() {
  if (state.saving) return false;
  state.saving = true;
  let ok = false;
  try {
    const full = await ag('/api/config');
    full.items = state.items;
    await ap('/api/config', full);
    toast(t('toast.saved'));
    ok = true;
  } catch (e) {
    toast(t('toast.saveFailed', { err: e.message }), 'err');
  }
  state.saving = false;
  render();
  return ok;
}

/** Append items to what is on the server right now, never to the copy this page
    loaded. Writing back the in-memory list drops anything added from another
    tab while the preview was open.

    @param {any[]} newItems */
async function appendAndSave(newItems) {
  if (state.saving) throw new Error('A save is already in progress');
  state.saving = true;
  try {
    const full = await ag('/api/config');
    const current = Array.isArray(full.items) ? full.items : [];
    /* Ids were allocated against the list the preview was built from. */
    const taken = new Set(current.map(i => i && i.id));
    const clash = newItems.find(i => taken.has(i.id));
    if (clash) throw new Error(`${clash.label}: this id already exists. Reload and import again.`);
    full.items = [...current, ...newItems];
    await ap('/api/config', full);
    state.items = full.items;
  } finally {
    state.saving = false;
    render();
  }
}

/** Save, and put the list back if the write did not land. Never rejects. */
async function saveOrRevert(before) {
  try {
    return await saveWithRevert({
      write: save,
      snapshot: before,
      restore: items => {
        state.items = items;
        render();
      },
    });
  } catch {
    return false;
  }
}

function showListView() {
  el('dash-list-view').style.display = '';
  el('dash-edit-view').style.display = 'none';
}
function showEditView() {
  el('dash-list-view').style.display = 'none';
  el('dash-edit-view').style.display = '';
  el('cp')?.scrollTo?.(0, 0);
  q('.cp')?.scrollTo?.(0, 0);
}

const TYPE_ICONS = {
  app: '<rect x="7" y="7" width="10" height="10" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  widget:
    '<rect x="3.5" y="6.5" width="17" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7.2" cy="10.2" r="1.5" fill="currentColor"/><line x1="5.6" y1="13.4" x2="17.4" y2="13.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5.6" y1="15.2" x2="17.4" y2="15.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  folder:
    '<rect x="6" y="6" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9.7" cy="9.7" r="1.25" fill="currentColor"/><circle cx="14.3" cy="9.7" r="1.25" fill="currentColor"/><circle cx="9.7" cy="14.3" r="1.25" fill="currentColor"/><circle cx="14.3" cy="14.3" r="1.25" fill="currentColor"/>',
};
/* Read at draw time. The catalog is not loaded when this module evaluates. */
const typeLabels = () => ({ app: t('type.app'), widget: t('type.widget'), folder: t('type.folder') });

function buildAddNewCard() {
  const grp = document.createElement('div');
  grp.className = 'grp';
  const row = document.createElement('div');
  row.className = 'row tile-row';
  setHtml(row, html`<span class="rl">${t('type.addNew')}</span>`);
  const grpTiles = document.createElement('div');
  grpTiles.className = 'tile-grp';
  const labels = typeLabels();
  ['app', 'widget', 'folder'].forEach(kind => {
    const label = labels[kind];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-opt' + (kind === state.ctype ? ' on' : '');
    b.dataset.ctype = kind;
    b.setAttribute('aria-pressed', String(kind === state.ctype));
    b.setAttribute('aria-label', t('type.addNew') + ': ' + label);
    setHtml(
      b,
      html`<span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${raw(TYPE_ICONS[kind])}</svg></span><span class="tile-cap">${label}</span>`,
    );
    b.onclick = () => {
      if (state.ctype === kind) return;
      state.ctype = kind;
      _renderEditBody();
    };
    grpTiles.appendChild(b);
  });
  row.appendChild(grpTiles);
  grp.appendChild(row);
  return grp;
}

/* Prepended after the builder runs, so the builder's reset cannot wipe it. */
function _renderEditBody() {
  const body = el('ev-body');
  body.replaceChildren();
  if (state.ctype === 'widget') buildWidgetForm(body, state._evItem);
  else if (state.ctype === 'folder') buildFolderForm(body, state._evItem);
  else buildAppForm(body, state._evItem);
  if (!state._evIsEdit) body.insertBefore(buildAddNewCard(), body.firstChild);
  setTimeout(() => {
    try {
      q('input,select,textarea', body)?.focus();
    } catch {}
  }, 50);
}

function openModal(idx) {
  const editing = idx != null ? state.items[idx] : null;
  state.eid = editing?.id ?? null;
  const item = editing ? JSON.parse(JSON.stringify(editing)) : null;
  state.ctype = item?.type || 'app';
  state.siurl = item?.iconUrl || '';
  state.scol = item?.color || 'dark';
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
        color: l.color || '#1e6ef4',
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

  const isEdit = idx != null;
  el('ev-title').textContent = t('nav.general');
  const delBtn = el('ev-delete');
  const saveBtn = el('ev-save');
  if (delBtn) {
    delBtn.classList.toggle('d-none', !isEdit);
    delBtn.onclick = () => _evDelete(item, idx);
  }
  if (saveBtn) {
    saveBtn.onclick = () => doSave(item);
  }
  const backBtn = el('ev-back');
  if (backBtn) backBtn.onclick = () => closeModal();

  state._evItem = item;
  state._evIsEdit = isEdit;
  state._evSession += 1;
  _renderEditBody();

  showEditView();
}

async function _evDelete(item, idx) {
  if (!item) return;
  if (item.type === 'folder') {
    if (!confirm(t('confirm.deleteFolder', { name: item.label }))) return;
  } else {
    if (!confirm(t('confirm.remove', { name: item.label || item.id }))) return;
  }
  const before = snapshotItems(state.items);
  state.items.forEach(f => {
    if (f.type === 'folder') f.children = (f.children || []).filter(id => id !== item.id);
  });
  state.items.splice(idx, 1);
  if (await saveOrRevert(before)) showListView();
}
{
  const s = inp('al-search');
  if (s)
    s.addEventListener('input', () => {
      filter.q = s.value.trim();
      render();
    });
  qa('#al-filter .chip').forEach(c => {
    c.addEventListener('click', () => {
      filter.type = c.dataset.flt;
      syncFilterUI();
      render();
    });
  });
}

el('btn-add').onclick = () => openModal(null);
function closeModal() {
  showListView();
  state.eid = null;
  state._wtype = 'custom';
  state._wsize = 'medium';
  state._customUrl = '';
  state._wlabel = '';
  state._iframeOpts = {};
}

function openFolderPicker(appId, targetFolderId = null) {
  const folders = state.items.filter(i => i.type === 'folder');
  const currentFolder = folders.find(f => (f.children || []).includes(appId));
  const appItem = state.items.find(i => i.id === appId);
  const appName = appItem?.label || appId;

  const dlg = openDialog({
    title: appId ? t('folder.moveTo', { name: appName }) : t('folder.addApp'),
  });
  const list = dlg.body;
  const close = dlg.close;

  const rowBtn = (cls, onAct) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-row' + (cls ? ' ' + cls : '');
    b.onclick = onAct;
    return b;
  };

  if (targetFolderId) {
    const tf = folders.find(f => f.id === targetFolderId);
    const available = tf
      ? state.items.filter(i => i.type === 'app' && !i.dock && !(tf.children || []).includes(i.id))
      : [];
    if (!available.length) {
      const em = document.createElement('div');
      em.className = 'dlg-empty';
      em.textContent = t('folder.allInFolder');
      list.appendChild(em);
    }
    available.forEach(app => {
      const b = rowBtn('', () => {
        const before = snapshotItems(state.items);
        state.items.forEach(f => {
          if (f.type === 'folder') f.children = (f.children || []).filter(id => id !== app.id);
        });
        if (!tf.children) tf.children = [];
        tf.children.push(app.id);
        saveOrRevert(before);
        close();
      });
      const ri = document.createElement('span');
      ri.className = 'fp-ic';
      ri.style.background = rc(app.color);
      paintIcon(ri, app.iconUrl, (app.label || '?')[0]);
      const nm = document.createElement('span');
      nm.className = 'fp-nm';
      setUserText(nm, app.label || app.id);
      b.append(ri, nm);
      list.appendChild(b);
    });
  } else {
    const none = rowBtn(currentFolder ? 'muted' : 'cur', () => {
      const before = snapshotItems(state.items);
      state.items.forEach(f => {
        if (f.type === 'folder') f.children = (f.children || []).filter(id => id !== appId);
      });
      saveOrRevert(before);
      close();
    });
    const ns = document.createElement('span');
    ns.textContent = t('folder.none');
    none.append(ns);
    list.appendChild(none);

    folders.forEach(f => {
      const cur = currentFolder?.id === f.id;
      const b = rowBtn(cur ? 'cur' : '', () => {
        const before = snapshotItems(state.items);
        state.items.forEach(ff => {
          if (ff.type === 'folder') ff.children = (ff.children || []).filter(id => id !== appId);
        });
        if (!f.children) f.children = [];
        if (!f.children.includes(appId)) f.children.push(appId);
        saveOrRevert(before);
        close();
      });
      const nm = document.createElement('span');
      setUserText(nm, f.label);
      const chk = document.createElement('span');
      chk.className = 'fp-chk';
      if (cur) chk.textContent = '✓';
      b.append(nm, chk);
      list.appendChild(b);
    });

    const divider = document.createElement('div');
    divider.className = 'div';
    divider.style.margin = '4px 8px';
    list.appendChild(divider);

    const nr = rowBtn('accent', async () => {
      /* Closed first. Two overlays fighting over the focus trap leave focus in
         the one underneath. */
      close();
      const name = await promptModal({
        title: t('folder.createNew'),
        label: t('folder.name'),
        placeholder: t('folder.namePh'),
        confirmLabel: t('common.create'),
        cancelLabel: t('common.cancel'),
      });
      if (!name) return;
      const fid = newItemId(
        name,
        'folder',
        state.items.map(i => i.id),
      );
      const before = snapshotItems(state.items);
      state.items.push({ id: fid, type: 'folder', label: name, children: [appId] });
      state.items.forEach(f => {
        if (f.type === 'folder' && f.id !== fid) f.children = (f.children || []).filter(id => id !== appId);
      });
      saveOrRevert(before);
    });
    const nrs = document.createElement('span');
    nrs.textContent = '+ ' + t('folder.createNew');
    nr.append(nrs);
    list.appendChild(nr);
  }

  dlg.addAction(t('common.cancel'), 'bg sm', close);
  dlg.focus(q('button', list));
}

async function doSave(orig) {
  try {
    /** @type {Record<string, any>} */
    let item;
    if (state.ctype === 'widget') {
      const wlabel = state._wlabel.trim() || state._widgetReg?.[state._wtype]?.label || t('type.widget');
      if (state._autoForm && state._autoFormType === state._wtype && state._widgetReg[state._wtype]) {
        const missing = state._autoForm.validate();
        if (missing.length) {
          toast(t('toast.fieldRequired', { field: missing[0] }), 'err');
          return;
        }
        item = {
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
      } else if (state._wtype === 'custom') {
        const url = inp('f-url')?.value?.trim();
        if (!url) {
          toast(t('toast.urlRequired'), 'err');
          return;
        }
        const ifo = {};
        if (state._iframeOpts.referrerPolicy) ifo.referrerPolicy = state._iframeOpts.referrerPolicy;
        if (state._iframeOpts.allow) ifo.allow = state._iframeOpts.allow;
        if (state._iframeOpts.allowFullscreen === false) ifo.allowFullscreen = false;
        if (state._iframeOpts.refreshInterval) ifo.refreshInterval = state._iframeOpts.refreshInterval;
        item = {
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
      }
    } else if (state.ctype === 'folder') {
      const label = inp('f-fname')?.value?.trim();
      if (!label) {
        toast(t('toast.nameRequired'), 'err');
        return;
      }
      /* An app belongs to one folder, or the dashboard renders it twice. */
      const children = qa('#folder-apps-list li[aria-selected="true"]', document).map(li => li.dataset.val);
      claimFolderChildren(state.items, orig?.id, children);
      item = {
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
    } else {
      const isPing = inp('hc-type-ping')?.checked;
      captureActLabels();
      const v = {
        label: inp('f-lbl')?.value?.trim(),
        href: inp('f-href')?.value?.trim(),
        hcEn: inp('hc-en')?.checked,
        hcCon: isPing ? '' : inp('hc-con')?.value?.trim() || '',
        hcPing: isPing ? inp('hc-ping')?.value?.trim() || '' : '',
        skipTlsVerify: inp('f-skip-tls')?.checked || false,
        actEn: inp('act-en')?.checked,
        actUrl: inp('f-burl')?.value?.trim() || '',
        actInt: Math.min(3600, Math.max(10, parseInt(inp('f-bint')?.value || '30', 10))),
        actParams: serializeKvRows(state._bpar),
        actHeaders: serializeKvRows(state._bhdr),
        actColor: inp('act-col-val')?.value || '#0289ff',
        custUnit: inp('bcust-unit')?.value?.trim() || '',
        custMin: parseInt(inp('bcust-min')?.value || '', 10),
        staticEn: inp('static-en')?.checked || false,
        staticLabel: inp('f-static-label')?.value?.trim() || '',
        staticColor: inp('static-col-val')?.value || '#1e6ef4',
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
      if (res.error) {
        toast(res.error, 'err');
        return;
      }
      item = res.item;
    }
    /* By id, never by position. */
    const before = snapshotItems(state.items);
    const { replaced } = upsertItem(state.items, state.eid, item);
    /* The editor stays open on a failed write, with the form intact. */
    if (!(await saveOrRevert(before))) return;
    closeModal();
    toast(t(replaced ? 'toast.updated' : 'toast.added'));
  } catch (e) {
    toast(t('toast.error', { err: e.message }), 'err');
  }
}

function initNav() {
  const links = qa('.nl, .mtab');
  const STORE = 'admin_sec';
  const sections = qa('.sec', document).map(s => s.id.replace(/^sec-/, ''));

  function show(requested) {
    const id = resolveAdminSection(requested, sections);
    if (id === null) return;
    if (id !== requested) console.warn('admin: unknown section', requested, '- showing', id);
    qa('.sec', document).forEach(s => {
      s.hidden = s.id !== 'sec-' + id;
    });
    links.forEach(l => l.classList.toggle('active', l.dataset.sec === id));
    localStorage.setItem(STORE, id);
  }
  links.forEach(l => l.addEventListener('click', () => show(l.dataset.sec)));
  show(localStorage.getItem(STORE));
}

function initAllInlineEdits() {
  initInlineEdit('ie-title', 'ie-input', {
    placeholder: 'Stackyard',
    onCommit(v) {
      el('ie-title-v').textContent = v || 'Stackyard';
    },
  });

  const descInp = document.createElement('input');
  descInp.id = 'ie-desc-input';
  document.body.appendChild(descInp);
  initInlineEdit('ie-desc', 'ie-desc-input', { placeholder: 'Stackyard · self-hosted homelab dashboard' });

  initInlineEdit('ie-ip', 'srv-ip', { placeholder: '192.168.1.100' });
  initInlineEdit('ie-socket', 'srv-socket', { placeholder: 'http://socket-proxy:2375' });

  initInlineEdit('ie-pw', 'sec-pw', {
    type: 'password',
    placeholder: () => t('general.passwordPh'),
    onCommit() {
      const bars = el('sec-pw-bars');
      const hint = el('sec-pw-hint');
      if (bars) bars.style.display = 'none';
      if (hint) hint.style.display = 'none';
    },
  });
  const pwInp = el('sec-pw');
  if (pwInp) {
    pwInp.addEventListener(
      'input',
      () => {
        const bars = el('sec-pw-bars');
        const hint = el('sec-pw-hint');
        if (bars) {
          bars.style.display = 'flex';
        }
        if (hint) {
          hint.style.display = 'block';
        }
        wirePasswordStrength('sec-pw', 'sec-pw-bars', 'sec-pw-hint');
      },
      { once: true },
    );
  }

  const apiInp = document.createElement('input');
  apiInp.id = 'bg-apikey-inp';
  document.body.appendChild(apiInp);
  initInlineEdit('ie-apikey', 'bg-apikey-inp', { placeholder: 'Paste your Unsplash API key' });

  const colInp = document.createElement('input');
  colInp.id = 'bg-col-inp';
  document.body.appendChild(colInp);
  initInlineEdit('ie-bgcol', 'bg-col-inp', { placeholder: 'AGVpqBZnzUE' });

  const urlInp = document.createElement('input');
  urlInp.id = 'bg-url-inp';
  urlInp.type = 'url';
  document.body.appendChild(urlInp);
  initInlineEdit('ie-bgurl', 'bg-url-inp', {
    placeholder: 'https://example.com/photo.jpg',
    onCommit(v) {
      fetchWallpaperLink(v.trim());
    },
  });

  const colorInp = document.createElement('input');
  colorInp.id = 'bg-color-inp';
  document.body.appendChild(colorInp);
  initInlineEdit('ie-bgcolor', 'bg-color-inp', {
    placeholder: '#0d1117',
    onCommit(val) {
      if (!val) return;
      const { value, ok } = normalizeColorInput(val);
      if (!ok) return toast(t('toast.colorInvalid'), 'err');
      colorInp.value = value;
      const rv = q('#ie-bgcolor .rv');
      if (rv) rv.textContent = value;
    },
  });
}

async function initVersion() {
  try {
    const d = await ag('/api/version');
    const v = (d.current || d.version || '').replace(/^v/i, '');
    if (v) {
      const vEl = el('sidebar-version');
      const aEl = el('about-version');
      if (vEl) vEl.textContent = 'v' + v;
      if (aEl) aEl.textContent = t('about.version', { v });
      if (d.updateAvailable) {
        const dot = el('about-update-dot');
        if (dot) dot.style.display = 'flex';
        if (aEl && d.latest) {
          const lv = String(d.latest).replace(/^v/i, '');
          setHtml(
            aEl,
            html`${t('about.version', { v })} &middot;
              <a
                href="https://github.com/SandObserver/stackyard/releases/latest"
                target="_blank"
                rel="noopener"
                class="upd-link"
                >${t('about.updateTo', { v: lv })}</a
              >`,
          );
        }
      }
    }
  } catch {}
}

function initSecToggle() {
  const en = inp('sec-en');
  const pwRow = el('ie-pw');
  const pwHint = el('pw-hint-static');
  if (!en) return;
  function apply(on) {
    if (pwRow) pwRow.classList.toggle('d-none', !on);
    if (pwHint) pwHint.style.display = on ? '' : 'none';
  }
  apply(en.checked);
  en.addEventListener('change', () => apply(en.checked));
}

function initDockerToggle() {
  const en = inp('srv-docker-en');
  const hideRow = el('srv-hide-healthy-row');
  const socketRow = el('ie-socket');
  if (!en) return;
  function apply(on) {
    if (hideRow) hideRow.classList.toggle('d-none', !on);
    if (socketRow) socketRow.classList.toggle('d-none', !on);
  }
  apply(en.checked);
  en.addEventListener('change', () => apply(en.checked));
}

function initBgType() {
  const btn = el('bg-type-btn');
  const list = el('bg-type-list');
  const hidden = inp('bg-type');
  if (!btn || !list || !hidden) return;

  function setVal(val) {
    hidden.value = val;
    const labels = { unsplash: 'Unsplash', url: 'Image', color: 'Solid color' };
    /* Update only the text node. The SVG chevron must survive. */
    const textNode = btn.childNodes[0];
    if (textNode && textNode.nodeType === 3) textNode.textContent = labels[val] || val;
    list.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', String(li.dataset.val === val)));
    list.hidden = true;
    showBgFields(val);
    const hint = el('bgcol-hint');
    if (hint) hint.style.display = val === 'unsplash' ? '' : 'none';
    const imgHint = el('bg-url-hint');
    if (imgHint) imgHint.style.display = val === 'url' ? '' : 'none';
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => setVal(li.dataset.val));
  });
  document.addEventListener('click', () => {
    list.hidden = true;
  });

  setVal(hidden.value || 'unsplash');
}

function initBgFit() {
  const btn = el('bg-fit-btn');
  const list = el('bg-fit-list');
  const hidden = inp('bg-fit');
  if (!btn || !list || !hidden) return;
  function setVal(val) {
    hidden.value = val;
    showBgFit(val);
    list.hidden = true;
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => setVal(li.dataset.val || 'fill')));
  document.addEventListener('click', () => {
    list.hidden = true;
  });
  setVal(hidden.value || 'fill');
}

/** A body that is not JSON is the web server answering on its own.

    @param {Response} r @returns {Promise<string>} */
async function responseError(r) {
  const text = await r.text().catch(() => '');
  try {
    const d = JSON.parse(text);
    if (d && d.error) return String(d.error);
  } catch {}
  if (r.status === 413) return t('toast.imageTooLarge');
  return `HTTP ${r.status}`;
}

/** @param {string} url an image this server holds @returns {void} */
function setWallpaperUrl(url) {
  const urlInp = inp('bg-url-inp');
  if (urlInp) urlInp.value = url;
  const rv = el('ie-bgurl-v');
  if (rv) {
    setUserText(rv, url);
    rv.classList.remove('is-ph');
  }
  showWallpaperFile(url);
}

function initWallpaperUpload() {
  const input = inp('bg-upload');
  const btn = el('bg-upload-lbl');
  if (!input || !btn) return;
  input.onchange = async () => {
    const file = /** @type {HTMLInputElement} */ (input).files?.[0];
    if (!file) return;
    const orig = btn.textContent;
    btn.textContent = t('appearance.uploading');
    try {
      const form = new FormData();
      form.append('wallpaper', file, file.name);
      const r = await fetch('/api/wallpaper/upload', { method: 'POST', body: form });
      if (!r.ok) throw new Error(await responseError(r));
      const d = await r.json();
      setWallpaperUrl(d.url);
      toast(t('toast.wallpaperStored'));
    } catch (e) {
      toast(t('toast.wallpaperFailed', { err: e.message }), 'err');
    } finally {
      btn.textContent = orig;
      /** @type {HTMLInputElement} */ (input).value = '';
    }
  };
  btn.onclick = () => /** @type {HTMLInputElement} */ (input).click();
}

/** Downloads a pasted link to this server. The page's content policy refuses an
    image from any other origin.

    @param {string} url @returns {Promise<void>} */
async function fetchWallpaperLink(url) {
  if (!url || url.startsWith('/icons/')) return;
  try {
    const r = await fetch('/api/wallpaper/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) throw new Error(await responseError(r));
    const d = await r.json();
    setWallpaperUrl(d.url);
    toast(t('toast.wallpaperStored'));
  } catch (e) {
    /* A link that failed must not replace the wallpaper already saved. */
    setWallpaperUrl(state._settings?.background?.url || '');
    toast(t('toast.wallpaperFailed', { err: e.message }), 'err');
  }
}

function initLogLevel() {
  const btn = el('log-level-btn');
  const list = el('log-level-list');
  const hidden = inp('log-level');
  if (!btn || !list || !hidden) return;
  const labels = { debug: 'Debug', info: 'Info', error: 'Errors' };
  function setVal(val) {
    hidden.value = val;
    const textNode = btn.childNodes[0];
    if (textNode && textNode.nodeType === 3) textNode.textContent = labels[val] || val;
    list.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', String(li.dataset.val === val)));
    list.hidden = true;
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => setVal(li.dataset.val)));
  document.addEventListener('click', () => {
    list.hidden = true;
  });
  setVal(hidden.value || 'info');
}

function initLanguage() {
  const btn = el('lang-btn');
  const list = el('lang-list');
  const hidden = inp('lang-sel');
  if (!btn || !list || !hidden) return;
  const names = Object.fromEntries(LANGUAGES.map(l => [l.code, l.name]));
  setHtml(
    list,
    html`${LANGUAGES.map(l => html`<li role="option" data-val="${l.code}" aria-selected="false">${l.name}</li>`)}`,
  );
  function setVal(val) {
    hidden.value = val;
    const tn = btn.childNodes[0];
    if (tn && tn.nodeType === 3) tn.textContent = names[val] || val;
    list.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', String(li.dataset.val === val)));
    list.hidden = true;
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => setVal(li.dataset.val)));
  document.addEventListener('click', () => {
    list.hidden = true;
  });
  setVal(hidden.value || 'en');
}

/* The row label follows the catalog, so it is written once the catalog is
   loaded and again on every language change. */
let syncThemeLabel = () => {};

const THEME_LABEL_KEYS = {
  system: 'appearance.displaySystem',
  light: 'appearance.displayLight',
  dark: 'appearance.displayDark',
};

function initTheme() {
  const btn = el('theme-btn');
  const list = el('theme-list');
  const hidden = inp('theme-sel');
  if (!btn || !list || !hidden) return;
  syncThemeLabel = () => {
    const tn = btn.childNodes[0];
    if (tn && tn.nodeType === 3) tn.textContent = t(THEME_LABEL_KEYS[hidden.value] || THEME_LABEL_KEYS.system);
  };
  function setVal(val) {
    hidden.value = writeMode(val);
    syncThemeLabel();
    list
      .querySelectorAll('li')
      .forEach(li => li.setAttribute('aria-selected', String(li.dataset.val === hidden.value)));
    list.hidden = true;
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => setVal(li.dataset.val)));
  document.addEventListener('click', () => {
    list.hidden = true;
  });
  watchSystemTheme(() => hidden.value);
  setVal(readMode());
}

const dashSaveEl = el('dash-save');
if (dashSaveEl) dashSaveEl.onclick = () => save();

/* Fetched, never reached by navigating a link. A link hands the request to the
   browser, which saves an error body under the backup's own filename. */
el('btn-exp').onclick = async () => {
  let url;
  try {
    const config = await ag('/api/config/export');
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stackyard-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    toast(t('toast.exportFailed', { err: e.message }), 'err');
  } finally {
    /* Revoked on the next frame. Revoking it in this one races the download the
       click just started. */
    if (url) requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
};
el('imp').onchange = async e => {
  const f = tgt(e).files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.items)) throw new Error('Invalid');
    const cur = new Map(state.items.map(i => [i.id, i]));
    const inc = new Map(d.items.map(i => [i.id, i]));
    let added = 0,
      updated = 0,
      deleted = 0;
    for (const [id, it] of inc) {
      if (!cur.has(id)) added++;
      else if (JSON.stringify(cur.get(id)) !== JSON.stringify(it)) updated++;
    }
    for (const id of cur.keys()) {
      if (!inc.has(id)) deleted++;
    }
    if (added + updated + deleted === 0) {
      toast(t('toast.importNoChange'));
      tgt(e).value = '';
      return;
    }
    const lead = document.createElement('p');
    lead.className = 'dlg-lead';
    lead.textContent = t('import.confirm', { count: d.items.length, added, updated, deleted });
    const ok = await confirmModal({
      title: t('import.confirmTitle'),
      body: lead,
      confirmLabel: t('common.import'),
      cancelLabel: t('common.cancel'),
      destructive: deleted > 0,
    });
    if (!ok) {
      tgt(e).value = '';
      return;
    }
    const before = snapshotItems(state.items);
    state.items = d.items;
    if (await saveOrRevert(before)) toast(t('toast.imported'));
  } catch (e) {
    toast(t('toast.importFailed', { err: e.message }), 'err');
  }
  tgt(e).value = '';
};

/* Written out as literals, so a key can be traced from the catalog back to
   here. */
const SKIP_TEXT = {
  [SKIP.NO_LABEL]: 'importForeign.skipNoLabel',
  [SKIP.NO_HREF]: 'importForeign.skipNoHref',
  [SKIP.UNSAFE_HREF]: 'importForeign.skipUnsafeHref',
  [SKIP.PLACEHOLDER_HREF]: 'importForeign.skipPlaceholderHref',
  [SKIP.RELATIVE_HREF]: 'importForeign.skipRelativeHref',
  [SKIP.UNREADABLE]: 'importForeign.skipUnreadable',
  [SKIP.UNPARSABLE]: 'importForeign.skipUnparsable',
};
const NOTE_TEXT = {
  [NOTE.ICON_DROPPED]: 'importForeign.noteIcon',
  [NOTE.PING_DROPPED]: 'importForeign.notePing',
  [NOTE.CONTAINER_ON_REMOTE]: 'importForeign.noteRemoteContainer',
  [NOTE.GROUP_FLATTENED]: 'importForeign.noteFlattened',
  [NOTE.SUBITEMS_FLATTENED]: 'importForeign.noteSubItems',
  [NOTE.WIDGET_AS_LINK]: 'importForeign.noteWidgetLink',
  [NOTE.WIDGETS_DROPPED]: 'importForeign.noteWidgetDropped',
  [NOTE.LOCAL_URL_DROPPED]: 'importForeign.noteLocalUrl',
  [NOTE.FIELDS_DROPPED]: 'importForeign.noteFields',
  [NOTE.PAGES_NOT_FOLLOWED]: 'importForeign.notePages',
};

/** One "Heading (n)" block followed by a line per entry.
    @param {HTMLElement} parent @param {string} heading
    @param {Array<{ name: string, group: string, why: string }>} rows */
function dlgSection(parent, heading, rows) {
  if (!rows.length) return;
  const h = document.createElement('div');
  h.className = 'dlg-sec';
  h.textContent = `${heading} (${rows.length})`;
  const ul = document.createElement('ul');
  ul.className = 'dlg-ul';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'dlg-li';
    const nm = document.createElement('span');
    setUserText(nm, [row.group, row.name].filter(Boolean).join(' / ') || t('importForeign.wholeFile'));
    const why = document.createElement('span');
    why.className = 'dlg-why';
    setUserText(why, row.why);
    li.append(nm, why);
    ul.appendChild(li);
  }
  parent.append(h, ul);
}

el('imp-foreign').onchange = async e => {
  const input = tgt(e);
  const files = [...(input.files || [])];
  if (!files.length) return;
  try {
    /* Ids must stay unique against what is saved and against every other file
       in the batch, so one taken set runs through all of them. */
    const taken = new Set(state.items.map(i => i.id));
    const items = [],
      skipped = [],
      notes = [];
    for (const file of files) {
      let doc, parseErrors;
      try {
        /* One unreadable line drops its own entry and no more. Refusing the
           whole file cost the reader every other service in it. */
        ({ doc, errors: parseErrors } = parseYamlTolerant(await file.text()));
      } catch (err) {
        if (err instanceof YamlLiteError)
          throw new Error(t('toast.importYamlUnsupported', { file: file.name, reason: err.reason, line: err.line }));
        throw err;
      }
      const kind = detectSource(doc);
      if (!kind) throw new Error(t('toast.importUnknownFormat', { file: file.name }));
      const out = convert(kind, doc, taken, t('importForeign.untitledFolder'));
      items.push(...out.items);
      skipped.push(...parseErrorsAsSkipped(parseErrors, file.name), ...out.skipped);
      notes.push(...out.notes);
    }

    const apps = items.filter(i => i.type === 'app').length;
    const folders = items.length - apps;
    if (!apps) {
      toast(t('toast.importForeignNothing'), 'err');
      input.value = '';
      return;
    }

    const body = document.createElement('div');
    const lead = document.createElement('p');
    lead.className = 'dlg-lead';
    lead.textContent = t('importForeign.lead');
    body.appendChild(lead);
    dlgSection(
      body,
      t('importForeign.willAdd'),
      items
        .filter(i => i.type === 'app')
        .map(i => {
          const ping = i.monitoring?.healthcheck?.pingUrl;
          return {
            name: i.label,
            group: '',
            why: ping ? `${i.href}  ${t('importForeign.monitors', { url: ping })}` : i.href,
          };
        }),
    );
    dlgSection(
      body,
      t('importForeign.willCreate'),
      items
        .filter(i => i.type === 'folder')
        .map(i => ({ name: i.label, group: '', why: t('importForeign.appCount', { n: i.children.length }) })),
    );
    dlgSection(
      body,
      t('importForeign.changed'),
      notes.map(n => ({ name: n.name, group: n.group, why: t(NOTE_TEXT[n.code], { detail: n.detail || '' }) })),
    );
    dlgSection(
      body,
      t('importForeign.notImported'),
      skipped.map(s => ({ name: s.name, group: s.group, why: t(SKIP_TEXT[s.reason], { detail: s.detail || '' }) })),
    );

    /* Never take certificate skipping from the file on its say-so. It stays off
       unless it is turned on here. */
    const insecure = insecureApps(items);
    /** @type {HTMLInputElement|null} */
    let skipTlsChoice = null;
    if (insecure.length) {
      const heading = document.createElement('div');
      heading.className = 'dlg-sec';
      heading.textContent = `${t('app.allowSelfSigned')} (${insecure.length})`;
      const choice = document.createElement('label');
      choice.className = 'dlg-choice';
      skipTlsChoice = document.createElement('input');
      skipTlsChoice.type = 'checkbox';
      const why = document.createElement('span');
      why.className = 'dlg-why';
      why.textContent = t('app.selfSignedTip');
      choice.append(skipTlsChoice, why);
      const ul = document.createElement('ul');
      ul.className = 'dlg-ul';
      for (const item of insecure) {
        const li = document.createElement('li');
        li.className = 'dlg-li';
        const nm = document.createElement('span');
        setUserText(nm, item.label);
        li.appendChild(nm);
        ul.appendChild(li);
      }
      body.append(heading, choice, ul);
    }

    const ok = await confirmModal({
      title: t('importForeign.title'),
      body,
      confirmLabel: t('common.import'),
      cancelLabel: t('common.cancel'),
      className: 'wide',
    });
    if (!ok) {
      input.value = '';
      return;
    }
    if (skipTlsChoice && !skipTlsChoice.checked) clearSkipTls(items);
    /* Appended, never merged. An import must not rename, reorder or remove
       anything already on the dashboard. */
    await appendAndSave(items);
    toast(t('toast.importForeignDone', { apps, folders }));
  } catch (err) {
    toast(t('toast.importFailed', { err: err.message }), 'err');
  }
  input.value = '';
};

el('btn-add').onclick = () => openModal(null);

initList({ openModal, openFolderPicker, save: saveOrRevert });
initNav();
initAllInlineEdits();
initSecToggle();
initDockerToggle();
initBgType();
initBgFit();
initWallpaperUpload();
initLogLevel();
initLanguage();
initTheme();

setReauthHandler(requireLogin);

checkAuth(load).then(ok => {
  if (!ok) return;
  load().catch(e => {
    toast(t('toast.configLoadFailed', { err: e.message }), 'err');
    const al = el('al');
    if (al) {
      /* An inline onclick is blocked by the CSP. */
      setHtml(
        al,
        html`<div style="padding:32px;text-align:center;color:rgba(255,255,255,.4);font-size:14px">${t('home.loadFailed')}<br><br><button class="retry-btn" type="button" style="padding:8px 20px;border-radius:16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:14px;font-family:inherit;">${t('home.retry')}</button></div>`,
      );
      q('.retry-btn', al)?.addEventListener('click', () => location.reload());
    }
  });
});
