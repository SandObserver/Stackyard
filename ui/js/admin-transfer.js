import { folderChildren } from '/js/admin-logic.js?v=81fd47cf';
import { importCounts, restoresSettings } from '/js/admin-save-logic.js?v=2a82f10d';
import { apiGet, errorAction, errorText, rowBusy, ShownError, toast } from '/js/admin-shared.js?v=0f28a237';
import { state } from '/js/admin-state.js?v=064b9b85';
import { formatNumber } from '/js/format-number.js?v=263fa390';
import { t } from '/js/i18n.js?v=82ba9da2';
import {
  clearSkipTls,
  convert,
  convertDockerLabels,
  detectSource,
  ImportTooLargeError,
  insecureApps,
  NOTE,
  parseErrorsAsSkipped,
  SKIP,
} from '/js/import-foreign.js?v=c42e5f43';
import { CONFIG_MAX_BYTES } from '/js/limits.js?v=ff61256e';
import { confirmModal } from '/js/modal.js?v=93d3e755';
import { el, isolate, setUserText, tgt } from '/js/utils.js?v=457d9918';
import { parseYamlTolerant, YamlLiteError, YamlTooLargeError } from '/js/yaml-lite.js?v=39538b71';

/** @typedef {{ restoreBackup: (file: any) => Promise<boolean>, appendAndSave: (items: any[]) => Promise<void> }} TransferPage */

/** @type {TransferPage} */
let _page = { restoreBackup: async () => false, appendAndSave: async () => {} };

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
  [SKIP.NO_NAME_OR_GROUP]: 'importForeign.skipNoNameOrGroup',
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
  [NOTE.SCHEME_ADDED]: 'importForeign.noteSchemeAdded',
  [NOTE.HEALTH_URL_DROPPED]: 'importForeign.noteHealthUrl',
  [NOTE.NAME_SHORTENED]: 'importForeign.noteNameShortened',
  [NOTE.LOGIN_REMOVED]: 'importForeign.noteLoginRemoved',
};

/** Wire the backup export and import rows, and the imports from other
    dashboards and from Docker labels.
    @param {TransferPage} page */
export function wireTransfer(page) {
  _page = page;

  /* Fetched, never reached by navigating a link. A link hands the request to the
     browser, which saves an error body under the backup's own filename. */
  el('btn-exp').onclick = rowBusy(/** @type {HTMLButtonElement} */ (el('btn-exp')), async () => {
    let url;
    try {
      const config = await apiGet('/api/config/export');
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'stackyard-config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast(t('toast.exportFailed', { err: errorText(e) }), 'err');
    } finally {
      /* Revoked on the next frame. Revoking it in this one races the download the
         click just started. */
      if (url) requestAnimationFrame(() => URL.revokeObjectURL(url));
    }
  });

  el('imp').onchange = rowBusy(/** @type {HTMLInputElement} */ (el('imp')), async e => {
    const f = tgt(e).files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.items)) throw new ShownError(t('toast.importNotStackyard'));
      /* The compact body, as sent. nginx answers a larger one with a page the admin cannot read. */
      if (new Blob([JSON.stringify(d)]).size > CONFIG_MAX_BYTES)
        throw new ShownError(t('adminError.configTooLarge', { max: formatNumber(CONFIG_MAX_BYTES / (1024 * 1024)) }));
      const { added, updated, deleted } = importCounts((await apiGet('/api/config/export')).items, d.items);
      const settingsToo = restoresSettings(d, await apiGet('/api/config'));
      if (added + updated + deleted === 0 && !settingsToo) {
        toast(t('toast.importNoChange'));
        tgt(e).value = '';
        return;
      }
      const lead = document.createElement('p');
      lead.className = 'dlg-lead';
      lead.textContent = t('import.confirm', {
        count: d.items.length,
        added: formatNumber(added),
        updated: formatNumber(updated),
        deleted: formatNumber(deleted),
      });
      if (settingsToo) lead.textContent += ` ${t('import.settingsToo')}`;
      const ok = await confirmModal({
        title: t('import.confirmTitle'),
        body: lead,
        confirmLabel: t('common.import'),
        cancelLabel: t('common.cancel'),
        destructive: deleted > 0,
        irreversible: deleted > 0,
      });
      if (!ok) {
        tgt(e).value = '';
        return;
      }
      await _page.restoreBackup(d);
    } catch (err) {
      const why = err instanceof SyntaxError ? t('toast.importNotStackyard') : errorText(err);
      toast(t('toast.importFailed', { err: why }), 'err');
    }
    tgt(e).value = '';
  });

  el('imp-foreign').onchange = rowBusy(/** @type {HTMLInputElement} */ (el('imp-foreign')), async e => {
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
            throw new ShownError(t('toast.importYamlUnsupported', { file: isolate(file.name), line: err.line }));
          if (err instanceof YamlTooLargeError)
            throw new ShownError(t('toast.importTooLarge', { file: isolate(file.name) }));
          throw err;
        }
        let out;
        try {
          const kind = detectSource(doc);
          if (!kind) throw new ShownError(t('toast.importUnknownFormat', { file: isolate(file.name) }));
          out = convert(kind, doc, taken, t('importForeign.untitledFolder'));
        } catch (err) {
          if (err instanceof ImportTooLargeError)
            throw new ShownError(t('toast.importTooLarge', { file: isolate(file.name) }));
          throw err;
        }
        items.push(...out.items);
        skipped.push(...parseErrorsAsSkipped(parseErrors, file.name), ...out.skipped);
        notes.push(...out.notes);
      }
      await reviewImport(items, skipped, notes, 'toast.importForeignNothing');
    } catch (err) {
      toast(t('toast.importFailed', { err: errorText(err) }), 'err');
    }
    input.value = '';
  });

  el('btn-imp-docker').onclick = rowBusy(/** @type {HTMLButtonElement} */ (el('btn-imp-docker')), async () => {
    try {
      const r = await apiGet('/api/docker/labels');
      let out;
      try {
        out = convertDockerLabels(r.containers, new Set(state.items.map(i => i.id)));
      } catch (err) {
        if (err instanceof ImportTooLargeError) throw new ShownError(t('toast.importDockerTooLarge'));
        throw err;
      }
      await reviewImport(out.items, out.skipped, out.notes, 'toast.importDockerNothing');
    } catch (err) {
      toast(t('toast.importFailed', { err: errorText(err) }), 'err', errorAction(err));
    }
  });
}

/** One "Heading (n)" block followed by a line per entry.
    @param {HTMLElement} parent @param {string} heading
    @param {Array<{ name: string, group: string, why: string }>} rows */
function dlgSection(parent, heading, rows) {
  if (!rows.length) return;
  const h = document.createElement('h3');
  h.className = 'dlg-sec';
  h.textContent = `${heading} (${formatNumber(rows.length)})`;
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

/** Show what an import would add, change and skip, and append it on Import.
    @param {any[]} items @param {any[]} skipped @param {any[]} notes @param {string} nothingKey */
export async function reviewImport(items, skipped, notes, nothingKey) {
  const apps = items.filter(i => i.type === 'app').length;
  const folders = items.length - apps;
  if (!apps) {
    toast(t(nothingKey), 'err');
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
      .map(i => ({
        name: i.label,
        group: '',
        why: t('importForeign.appCount', { n: formatNumber(folderChildren(i).length) }),
      })),
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
    const heading = document.createElement('h3');
    heading.className = 'dlg-sec';
    heading.textContent = `${t('app.allowSelfSigned')} (${formatNumber(insecure.length)})`;
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
  if (!ok) return;
  if (skipTlsChoice && !skipTlsChoice.checked) clearSkipTls(items);
  /* Appended, never merged. An import must not rename, reorder or remove
     anything already on the dashboard. */
  await _page.appendAndSave(items);
  toast(t('toast.importForeignDone', { apps: formatNumber(apps), folders: formatNumber(folders) }));
}
