const VALID_WIDGET_SIZES = new Set(['small', 'medium', 'large', 'xlarge']);
const TEXT_FIELDS = ['label', 'href', 'url', 'iconUrl', 'color', 'widgetType'];

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const absent = v => v === undefined || v === null;
const isText = v => absent(v) || typeof v === 'string';
const isBlock = v => absent(v) || isPlainObject(v);

/** Every item field no reader can use.
    @param {any} item @returns {string[]} */
function badItemFields(item) {
  const bad = TEXT_FIELDS.filter(f => !isText(item[f]));
  if (!absent(item.widgetSize) && !VALID_WIDGET_SIZES.has(item.widgetSize)) bad.push('widgetSize');
  for (const f of ['widgetConfig', 'badge', 'monitoring']) if (!isBlock(item[f])) bad.push(f);
  const m = isPlainObject(item.monitoring) ? item.monitoring : {};
  for (const f of ['healthcheck', 'activity', 'staticBadge']) if (!isBlock(m[f])) bad.push(`monitoring.${f}`);
  if (isPlainObject(m.staticBadge) && !isText(m.staticBadge.label)) bad.push('monitoring.staticBadge.label');
  const activity = isPlainObject(m.activity) ? m.activity : {};
  if (!isBlock(activity.custom)) bad.push('monitoring.activity.custom');
  if (isPlainObject(activity.custom) && !isText(activity.custom.unit)) bad.push('monitoring.activity.custom.unit');
  return bad;
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

/** Every setting that would drop a stored key or break a page.
    @param {any} settings @returns {string[]} */
function badSettings(settings) {
  if (!settings) return [];
  const bad = [];
  if (!isBlock(settings.background)) bad.push('background');
  else if (!isText(settings.background?.url)) bad.push('background.url');
  if (!isBlock(settings.server)) bad.push('server');
  else if (!isBlock(settings.server?.proxmox)) bad.push('server.proxmox');
  return bad;
}

module.exports = { VALID_WIDGET_SIZES, badItemFields, takesReservedId, firstBadFolderChild, badSettings };
