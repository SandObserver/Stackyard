const VALID_WIDGET_SIZES = new Set(['small', 'medium', 'large', 'xlarge']);
const TEXT_FIELDS = ['label', 'href', 'url', 'iconUrl', 'color', 'widgetType'];

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const absent = v => v === undefined || v === null;
const isText = v => absent(v) || typeof v === 'string';
const isBlock = v => absent(v) || isPlainObject(v);

/** The first item field no reader can use, or null.
    @param {any} item @returns {string | null} */
function firstBadItemField(item) {
  for (const f of TEXT_FIELDS) if (!isText(item[f])) return f;
  if (!absent(item.widgetSize) && !VALID_WIDGET_SIZES.has(item.widgetSize)) return 'widgetSize';
  if (!isBlock(item.widgetConfig)) return 'widgetConfig';
  if (!isBlock(item.badge)) return 'badge';
  if (!isBlock(item.monitoring)) return 'monitoring';
  const m = item.monitoring || {};
  for (const f of ['healthcheck', 'activity', 'staticBadge']) if (!isBlock(m[f])) return `monitoring.${f}`;
  if (!isText(m.staticBadge?.label)) return 'monitoring.staticBadge.label';
  if (!isBlock(m.activity?.custom)) return 'monitoring.activity.custom';
  if (!isText(m.activity?.custom?.unit)) return 'monitoring.activity.custom.unit';
  return null;
}

/** The Settings tile takes this id. A second item holding it is stored as a
    duplicate, and every later save is refused.
    @param {any} item @returns {boolean} */
const takesReservedId = item => (item.id === 'settings') !== (item.system === 'settings');

/** The first folder child that is not an app, or null. This also refuses a
    folder that lists itself and folders that list each other.
    @param {any} folder @param {Map<string, any>} byId @returns {string | null} */
function firstBadFolderChild(folder, byId) {
  for (const id of folder.children) if (byId.get(id)?.type !== 'app') return id;
  return null;
}

/** The first setting that would drop a stored key or break a page, or null.
    @param {any} settings @returns {string | null} */
function firstBadSetting(settings) {
  if (!settings) return null;
  if (!isBlock(settings.background)) return 'background';
  if (!isText(settings.background?.url)) return 'background.url';
  if (!isBlock(settings.server)) return 'server';
  if (!isBlock(settings.server?.proxmox)) return 'server.proxmox';
  return null;
}

module.exports = { VALID_WIDGET_SIZES, firstBadItemField, takesReservedId, firstBadFolderChild, firstBadSetting };
