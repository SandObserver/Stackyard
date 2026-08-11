// @ts-check
/* Convert a gethomepage or Dashy config into Stackyard items.

   Links and folders only. A widget in the source becomes a plain app tile
   pointing at the same service, never a Stackyard widget: the two widget
   systems take different credentials and different options, and a tile that
   looks configured but reports nothing is worse than a link.

   Nothing here touches the DOM or the network, and the item shape comes from
   buildAppItem rather than being written out again, so an item that arrives by
   import is the same object an item created in the admin UI is.

   Pure functions, DOM-free, so ui/test can exercise the rules directly. */

import { buildAppItem, newItemId } from '/js/admin-save-logic.js?v=77cac1d1';
import { isSafeLinkUrl } from '/js/link-url.js?v=19038560';

/* An item is not imported at all. */
export const SKIP = Object.freeze({
  NO_LABEL: 'no-label',
  NO_HREF: 'no-href',
  UNSAFE_HREF: 'unsafe-href',
  PLACEHOLDER_HREF: 'placeholder-href',
  RELATIVE_HREF: 'relative-href',
  UNREADABLE: 'unreadable',
});

/* An item is imported, but something in the source did not survive the trip. */
export const NOTE = Object.freeze({
  ICON_DROPPED: 'icon-dropped',
  PING_DROPPED: 'ping-dropped',
  CONTAINER_ON_REMOTE: 'container-on-remote',
  GROUP_FLATTENED: 'group-flattened',
  SUBITEMS_FLATTENED: 'subitems-flattened',
  WIDGET_AS_LINK: 'widget-as-link',
  WIDGETS_DROPPED: 'widgets-dropped',
  LOCAL_URL_DROPPED: 'local-url-dropped',
  FIELDS_DROPPED: 'fields-dropped',
  PAGES_NOT_FOLLOWED: 'pages-not-followed',
});

/* Fields with no equivalent on a Stackyard item. Counted so the summary can say
   what was left behind rather than quietly discarding it. */
const IGNORED_FIELDS = Object.freeze([
  'description',
  'abbr',
  'target',
  'color',
  'backgroundColor',
  'tags',
  'provider',
  'hotkey',
  'displayData',
]);

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v.trim() : '');
/* A name may legitimately be written unquoted and read back as a number or a
   boolean: `title: 2024` and `title: no` are both real. A URL read as one of
   those is not a URL, so only names go through this. */
const text = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/* Whatever the source meant by it, a link with no scheme cannot reach the
   service after the import: it resolves against the dashboard's own origin. */
function isAbsoluteLink(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
  return href.startsWith('//');
}

/* A value Homepage or Dashy resolves from its own environment. It cannot be
   resolved here, so the link would be dead on arrival. */
const hasPlaceholder = s => /\{\{[^}]*\}\}|\$\{[^}]*\}/.test(s);

/** The single key of a `{ name: value }` wrapper, or null.
    @param {any} v @returns {[string, any]|null} */
function soleEntry(v) {
  if (!isMap(v)) return null;
  const keys = Object.keys(v);
  return keys.length === 1 ? [keys[0], v[keys[0]]] : null;
}

/** Which format a parsed document is, by shape rather than by filename: these
    files get renamed, downloaded with a suffix, and pasted between installs.
    @param {any} doc @returns {'homepage-services'|'homepage-bookmarks'|'dashy'|null} */
export function detectSource(doc) {
  if (isMap(doc)) {
    if (Array.isArray(doc.sections) || Array.isArray(doc.pages) || isMap(doc.appConfig) || isMap(doc.pageInfo))
      return 'dashy';
    return null;
  }
  if (!Array.isArray(doc) || !doc.length) return null;
  let sawGroup = false;
  for (const group of doc) {
    const g = soleEntry(group);
    if (!g || !Array.isArray(g[1])) return null;
    sawGroup = true;
    for (const entry of g[1]) {
      const e = soleEntry(entry);
      if (!e) continue;
      /* The one structural difference between the two Homepage files: a
         bookmark's fields sit inside an extra list, a service's do not. */
      if (Array.isArray(e[1]) && e[1].some(row => isMap(row) && ('href' in row || 'abbr' in row))) {
        return 'homepage-bookmarks';
      }
    }
  }
  return sawGroup ? 'homepage-services' : null;
}

/** An icon reference the dashboard can actually resolve, or nothing.

    A bare name is a dashboard-icons slug, which is exactly what iconChain
    expects, so it is kept as it is. Icon fonts, emoji and paths into another
    dashboard's own file tree have no equivalent and are blanked rather than
    stored as a reference that resolves to a broken image.

    @param {unknown} raw @returns {{ iconUrl: string, dropped: boolean }} */
export function convertIcon(raw) {
  const s = str(raw);
  if (!s) return { iconUrl: '', dropped: false };
  if (/^https?:\/\//i.test(s)) {
    /* An icon is loaded into an <img src>, and the page's img-src allows only
       this origin, data:, and the icon CDN. Any other host is refused by the
       browser, so importing it would store a reference that can only ever
       render as a broken image. See nginx/csp-default.conf. */
    let host = '';
    try {
      host = new URL(s).hostname.toLowerCase();
    } catch {
      return { iconUrl: '', dropped: true };
    }
    return host === 'cdn.jsdelivr.net' ? { iconUrl: s, dropped: false } : { iconUrl: '', dropped: true };
  }
  if (s.startsWith('/') || s.includes('/')) return { iconUrl: '', dropped: true };
  /* selfh.st and homelab-svg-assets prefixes. Both name the same service the
     dashboard-icons catalogue does, so the remainder is a usable slug. */
  const body = /^(sh|hl)-/i.test(s) ? s.slice(3) : s;
  /* iconChain only strips .svg and .png, so any other extension has to go here
     or it ends up inside the CDN slug. */
  const name = body.replace(/\.(png|webp|svg|jpe?g|gif|ico)$/i, '');
  /* A whitespace-separated value is an icon-font class such as "fas fa-home",
     never a dashboard-icons slug. */
  if (!name || /\s/.test(name) || /^(mdi|si|fa[srlbd]?)-/i.test(name) || name === 'favicon')
    return { iconUrl: '', dropped: true };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return { iconUrl: '', dropped: true };
  return { iconUrl: name, dropped: false };
}

/** Collector for one conversion run. Keeps ids unique across every file in the
    batch, including against the items already on the dashboard.
    @param {Iterable<string>} takenIds */
function collector(takenIds) {
  const taken = new Set(takenIds || []);
  return {
    taken,
    /** @type {any[]} */ items: [],
    /** @type {Array<{ reason: string, name: string, group: string, detail?: string }>} */ skipped: [],
    /** @type {Array<{ code: string, name: string, group: string, detail?: string }>} */ notes: [],
    /** @param {string} reason @param {string} name @param {string} group @param {string} [detail] */
    skip(reason, name, group, detail) {
      this.skipped.push(detail ? { reason, name, group, detail } : { reason, name, group });
    },
    /** @param {string} code @param {string} name @param {string} group @param {string} [detail] */
    note(code, name, group, detail) {
      this.notes.push(detail ? { code, name, group, detail } : { code, name, group });
    },
  };
}

/** Build one app item from already-extracted parts, or record why it was not.
    @param {any} col @param {string} group
    @param {{ label: string, href: string, iconUrl: string, container: string,
              pingUrl: string, skipTlsVerify?: boolean }} parts
    @returns {any|null} */
function addApp(col, group, { label, href, iconUrl, container, pingUrl, skipTlsVerify }) {
  if (!label) {
    col.skip(SKIP.NO_LABEL, href || '', group);
    return null;
  }
  if (!href) {
    col.skip(SKIP.NO_HREF, label, group);
    return null;
  }
  if (hasPlaceholder(href)) {
    col.skip(SKIP.PLACEHOLDER_HREF, label, group, href);
    return null;
  }
  if (!isAbsoluteLink(href)) {
    col.skip(SKIP.RELATIVE_HREF, label, group, href);
    return null;
  }
  /* The server refuses the whole save over one unsafe link, so an item carrying
     one has to be dropped here or nothing imports at all. */
  if (!isSafeLinkUrl(href)) {
    col.skip(SKIP.UNSAFE_HREF, label, group, href);
    return null;
  }
  const built = buildAppItem(
    {
      label,
      href,
      iconUrl,
      scol: 'dark',
      hcEn: !!(container || pingUrl),
      hcCon: container || '',
      hcPing: pingUrl || '',
      skipTlsVerify: skipTlsVerify || false,
      actEn: false,
      actUrl: '',
      actInt: 60,
    },
    null,
    col.taken,
  );
  if (built.error) {
    col.skip(SKIP.NO_HREF, label, group, built.error);
    return null;
  }
  col.taken.add(built.item.id);
  col.items.push(built.item);
  return built.item;
}

/** Create the folder for a group, given the apps that landed in it. Empty
    groups produce nothing: a folder with no apps is a tile that opens onto an
    empty sheet. */
function addFolder(col, label, childIds, at) {
  if (!childIds.length) return;
  const id = newItemId(label, 'folder', col.taken);
  col.taken.add(id);
  col.items.splice(at, 0, { id, type: 'folder', label, children: childIds });
}

/** Record every source field that has no home on a Stackyard item. */
function noteIgnored(col, src, name, group) {
  const present = IGNORED_FIELDS.filter(f => f in src && src[f] !== null && src[f] !== '');
  if (present.length) col.note(NOTE.FIELDS_DROPPED, name, group, present.join(', '));
}

/** @param {any} doc @param {Iterable<string>} [takenIds] */
export function convertHomepageServices(doc, takenIds = []) {
  const col = collector(takenIds);
  if (!Array.isArray(doc)) return result(col);

  const walk = (entries, groupLabel, depth) => {
    const at = col.items.length;
    const children = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const e = soleEntry(entry);
      if (!e) {
        /* Not a `{ name: fields }` wrapper, so there is no service to read.
           Counted rather than passed over, or a mangled file imports as a
           smaller dashboard with nothing saying why. */
        col.skip(SKIP.UNREADABLE, '', groupLabel);
        continue;
      }
      const [name, value] = e;
      if (Array.isArray(value)) {
        /* Homepage nests groups; Stackyard folders do not, so the child group
           becomes a folder of its own with a compound name. */
        const nested = groupLabel ? `${groupLabel} / ${name}` : name;
        /* The child's own name, not the compound one: the preview prints
           "group / name", so passing the compound name repeats the parent. */
        col.note(NOTE.GROUP_FLATTENED, name, groupLabel, nested);
        walk(value, nested, depth + 1);
        continue;
      }
      if (!isMap(value)) {
        col.skip(SKIP.UNREADABLE, name, groupLabel);
        continue;
      }
      const icon = convertIcon(value.icon);
      const hasServer = 'server' in value && str(value.server) !== '';
      const app = addApp(col, groupLabel, {
        label: name,
        href: str(value.href),
        iconUrl: icon.iconUrl,
        /* A container name is only meaningful against the Docker socket this
           install can reach; with a `server` it names someone else's daemon. */
        container: hasServer ? '' : str(value.container),
        pingUrl: str(value.siteMonitor),
      });
      if (!app) continue;
      children.push(app.id);
      if (icon.dropped) col.note(NOTE.ICON_DROPPED, name, groupLabel, str(value.icon));
      if (hasServer && str(value.container)) col.note(NOTE.CONTAINER_ON_REMOTE, name, groupLabel, str(value.server));
      /* Homepage's `ping` is an ICMP host, not a URL. The health check makes an
         HTTP request, so importing it would report every host as down. */
      if (str(value.ping)) col.note(NOTE.PING_DROPPED, name, groupLabel, str(value.ping));
      if (value.widget || value.widgets) col.note(NOTE.WIDGET_AS_LINK, name, groupLabel);
      noteIgnored(col, value, name, groupLabel);
    }
    addFolder(col, groupLabel, children, at);
  };

  for (const group of doc) {
    const g = soleEntry(group);
    if (!g || !Array.isArray(g[1])) continue;
    walk(g[1], g[0], 0);
  }
  return result(col);
}

/** @param {any} doc @param {Iterable<string>} [takenIds] */
export function convertHomepageBookmarks(doc, takenIds = []) {
  const col = collector(takenIds);
  if (!Array.isArray(doc)) return result(col);

  for (const group of doc) {
    const g = soleEntry(group);
    if (!g || !Array.isArray(g[1])) continue;
    const [groupLabel, entries] = g;
    const at = col.items.length;
    const children = [];
    for (const entry of entries) {
      const e = soleEntry(entry);
      if (!e) {
        col.skip(SKIP.UNREADABLE, '', groupLabel);
        continue;
      }
      const [name, value] = e;
      /* A bookmark's fields arrive inside a one-element list. Services are
         written without it, and both files are worth reading either way. */
      const fields = Array.isArray(value) ? value.find(isMap) : value;
      if (!isMap(fields)) {
        col.skip(SKIP.UNREADABLE, name, groupLabel);
        continue;
      }
      const icon = convertIcon(fields.icon);
      const app = addApp(col, groupLabel, {
        label: name,
        href: str(fields.href),
        iconUrl: icon.iconUrl,
        container: '',
        pingUrl: '',
      });
      if (!app) continue;
      children.push(app.id);
      if (icon.dropped) col.note(NOTE.ICON_DROPPED, name, groupLabel, str(fields.icon));
      noteIgnored(col, fields, name, groupLabel);
    }
    addFolder(col, groupLabel, children, at);
  }
  return result(col);
}

/** @param {any} doc @param {Iterable<string>} [takenIds]
    @param {string} [untitledFolder] label for a section that has no name of its
    own; passed in because this module stays free of the i18n catalog */
export function convertDashy(doc, takenIds = [], untitledFolder = 'Imported') {
  const col = collector(takenIds);
  if (!isMap(doc)) return result(col);
  if (Array.isArray(doc.pages) && doc.pages.length) {
    /* Each entry names another config file, often on another host. */
    col.note(NOTE.PAGES_NOT_FOLLOWED, '', '', String(doc.pages.length));
  }

  for (const section of Array.isArray(doc.sections) ? doc.sections : []) {
    if (!isMap(section)) {
      col.skip(SKIP.UNREADABLE, '', '');
      continue;
    }
    const groupLabel = text(section.name) || untitledFolder;
    const at = col.items.length;
    const children = [];

    const addDashyItem = (raw, viaSubItem) => {
      if (!isMap(raw)) {
        col.skip(SKIP.UNREADABLE, '', groupLabel);
        return;
      }
      const title = text(raw.title);
      const icon = convertIcon(raw.icon);
      /* localUrl is the address on the other network. Importing it would give
         half the tiles a link that only works from somewhere else. */
      const href = str(raw.url);
      const check = raw.statusCheck === true;
      /* Dashy's per-item switch for a health check against a self-signed
         certificate. Stackyard has the same switch, so it carries across. */
      const insecure = check && raw.statusCheckAllowInsecure === true;
      const app = addApp(col, groupLabel, {
        label: title,
        href,
        iconUrl: icon.iconUrl,
        container: '',
        pingUrl: check ? str(raw.statusCheckUrl) || href : '',
        skipTlsVerify: insecure,
      });
      if (!app) return;
      children.push(app.id);
      if (icon.dropped) col.note(NOTE.ICON_DROPPED, title, groupLabel, str(raw.icon));
      if (viaSubItem) col.note(NOTE.SUBITEMS_FLATTENED, title, groupLabel);
      /* A second address for the same service, reachable only from the other
         network. Reported rather than dropped in silence, because the tile
         keeps whichever of the two the source called the primary one. */
      if (str(raw.localUrl)) col.note(NOTE.LOCAL_URL_DROPPED, title, groupLabel, str(raw.localUrl));
      noteIgnored(col, raw, title, groupLabel);
      for (const sub of Array.isArray(raw.subItems) ? raw.subItems : []) addDashyItem(sub, true);
    };

    for (const item of Array.isArray(section.items) ? section.items : []) addDashyItem(item, false);
    /* A section widget has no link of its own to keep, unlike a Homepage
       service widget, so there is nothing to import in its place. */
    if (Array.isArray(section.widgets) && section.widgets.length)
      col.note(NOTE.WIDGETS_DROPPED, '', groupLabel, String(section.widgets.length));
    addFolder(col, groupLabel, children, at);
  }
  return result(col);
}

function result(col) {
  return { items: col.items, skipped: col.skipped, notes: col.notes };
}

/** Convert a parsed document of a detected kind.
    @param {'homepage-services'|'homepage-bookmarks'|'dashy'} kind
    @param {any} doc @param {Iterable<string>} takenIds
    @param {string} [untitledFolder] */
export function convert(kind, doc, takenIds, untitledFolder) {
  if (kind === 'dashy') return convertDashy(doc, takenIds, untitledFolder);
  if (kind === 'homepage-bookmarks') return convertHomepageBookmarks(doc, takenIds);
  return convertHomepageServices(doc, takenIds);
}
