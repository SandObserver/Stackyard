import { settleDock } from '/js/admin-logic.js?v=81fd47cf';
import {
  afterImport,
  configWrites,
  restoreBody,
  restoresSettings,
  revertingSaves,
  snapshotItems,
} from '/js/admin-save-logic.js?v=2a82f10d';
import {
  apiGet,
  apiPost,
  confirmSaved,
  errorAction,
  errorText,
  failedSave,
  ShownError,
  toast,
  withheldText,
} from '/js/admin-shared.js?v=0f28a237';
import { state } from '/js/admin-state.js?v=064b9b85';
import { t } from '/js/i18n.js?v=82ba9da2';
import { isolate } from '/js/utils.js?v=457d9918';

/** @param {unknown} url @returns {Promise<boolean>} whether `url` names an uploaded wallpaper the server answers 404 for */
async function wallpaperMissing(url) {
  if (typeof url !== 'string' || !url.startsWith('/icons/wallpaper/')) return false;
  try {
    return (await fetch(url, { method: 'HEAD', cache: 'no-store' })).status === 404;
  } catch {
    return false;
  }
}

/** The list's writes to the server, and what the list Save button and the
    leave warning compare against.

    @param {{ render: () => void, saveButton: HTMLButtonElement|null }} page */
export function createListWrites({ render, saveButton }) {
  /* The list as the server last returned it to this page. A save that finds a
     different list on the server would delete what another tab or device added. */
  let serverItems = '';
  let savedItems = '';

  /* Counts imports that replaced a stale list. Refuse a save asked for before
     one: its change was made on the replaced list. */
  let replaced = 0;

  function syncDashSave() {
    if (saveButton) saveButton.disabled = JSON.stringify(state.items) === savedItems;
  }

  /** Returns whether the write reached the server.
      @param {string|false} [done] the message for a change that is not a plain
        save, or false for a save that announces nothing */
  function save(done) {
    const asked = replaced;
    return configWrites.run(() => writeItems(asked, done));
  }

  /** @param {number} asked @param {string|false} [done] */
  async function writeItems(asked, done) {
    let ok = false;
    try {
      const full = await apiGet('/api/config');
      if (asked !== replaced || JSON.stringify(full.items || []) !== serverItems) {
        throw Object.assign(new Error('stale'), { status: 409 });
      }
      settleDock(state.items);
      const sent = JSON.stringify(state.items);
      full.items = JSON.parse(sent);
      const r = await apiPost('/api/config', full);
      state._settings = full.settings || {};
      serverItems = JSON.stringify(r.items);
      savedItems = sent;
      saveOrRestore.landed(JSON.parse(sent));
      if (typeof done === 'string') toast(done);
      else confirmSaved(saveButton, done === false);
      ok = true;
    } catch (e) {
      failedSave(saveButton);
      toast(
        e.status === 409 ? t('toast.dashboardChangedElsewhere') : t('toast.saveFailed', { err: errorText(e) }),
        'err',
        errorAction(e),
      );
    }
    render();
    syncDashSave();
    return ok;
  }

  /** Append items to what is on the server right now, never to the copy this
      page loaded. Writing back the in-memory list drops anything added from
      another tab while the preview was open.

      @param {any[]} newItems */
  function appendAndSave(newItems) {
    return configWrites.run(() => appendItems(newItems));
  }

  /** @param {any[]} newItems */
  async function appendItems(newItems) {
    try {
      const full = await apiGet('/api/config');
      const current = Array.isArray(full.items) ? full.items : [];
      /* Ids were allocated against the list the preview was built from. */
      const taken = new Set(current.map(i => i && i.id));
      const clash = newItems.find(i => taken.has(i.id));
      if (clash) throw new ShownError(t('toast.importIdTaken', { name: isolate(clash.label || clash.id) }));
      full.items = [...current, ...newItems];
      const r = await apiPost('/api/config', full);
      state._settings = full.settings || {};
      const next = afterImport({
        local: state.items,
        saved: JSON.parse(savedItems),
        current,
        serverItems,
        newItems,
      });
      if (next.stale) replaced++;
      state.items = next.items;
      serverItems = JSON.stringify(r.items);
      savedItems = JSON.stringify(next.saved);
      saveOrRestore.landed(JSON.parse(savedItems));
      syncDashSave();
    } finally {
      render();
    }
  }

  /** Replace the list and the settings with a backup's. Returns whether the
      write reached the server.
      @param {any} file */
  function restoreBackup(file) {
    return configWrites.run(() => writeBackup(file));
  }

  /** @param {any} file */
  async function writeBackup(file) {
    try {
      const live = await apiGet('/api/config');
      if (JSON.stringify(live.items || []) !== serverItems) {
        throw Object.assign(new Error('stale'), { status: 409 });
      }
      const keepBackground = await wallpaperMissing(file?.settings?.background?.url);
      const body = restoreBody(file, live, keepBackground);
      const r = await apiPost('/api/config', body);
      state._settings = body.settings || {};
      replaced++;
      state.items = r.items;
      serverItems = JSON.stringify(r.items);
      savedItems = serverItems;
      saveOrRestore.landed(JSON.parse(savedItems));
      const notice = [withheldText(r), restoresSettings(file, live) ? t('toast.reloadToFinishRestore') : '']
        .filter(Boolean)
        .join(' ');
      if (notice) toast(notice, 'warn');
      else toast(t('toast.imported'));
      return true;
    } catch (e) {
      toast(
        e.status === 409 ? t('toast.dashboardChangedElsewhere') : t('toast.importFailed', { err: errorText(e) }),
        'err',
        errorAction(e),
      );
      return false;
    } finally {
      render();
      syncDashSave();
    }
  }

  const saveOrRestore = revertingSaves({
    write: save,
    restore: items => {
      state.items = snapshotItems(items);
      render();
    },
  });

  /** Save, and put the list back if the write did not land. Never rejects.
      @param {any[]} before @param {string|false} [done] */
  async function saveOrRevert(before, done) {
    try {
      return await saveOrRestore(before, done);
    } catch {
      return false;
    }
  }

  return {
    save,
    appendAndSave,
    restoreBackup,
    saveOrRevert,
    syncDashSave,
    /** Record the list as the server sent it with the page's config.
        @param {any[]} items */
    loaded(items) {
      serverItems = JSON.stringify(items);
    },
    /** Record the list as drawn, after the first render. */
    drawn() {
      savedItems = JSON.stringify(state.items);
    },
    /** @returns {boolean} whether the list holds a change the server does not have */
    unsaved() {
      return JSON.stringify(state.items) !== savedItems;
    },
  };
}
