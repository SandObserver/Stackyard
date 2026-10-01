// @ts-check
/* What the settings-file recovery screen says. Keep it free of the DOM and of
   imports: the API requires it. */

const DOCS = 'https://stackyard.sandobserver.com/docs/troubleshooting/';
export const HELP_URL = `${DOCS}#stackyard-cannot-read-its-settings-file`;
export const HOST_HELP_URL = `${DOCS}#stackyard-does-not-answer-on-this-address`;

export const DAMAGE_CODES = Object.freeze({
  corrupt: 'internal.config-corrupt',
  unreadable: 'internal.config-unreadable',
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const FILE_NAME = /^[^\u0000-\u001f\u007f/\\]{1,255}$/;

export const HOST_BLOCKED_CODE = 'blocked.host';

/** The address an API error body refuses, or null when it refuses none.
    @param {unknown} body @returns {{ host: string } | null} */
export function readHostBlock(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, any>} */ (body);
  if (b.code !== HOST_BLOCKED_CODE) return null;
  const host = b.detail && typeof b.detail.host === 'string' ? b.detail.host : '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  return { host: /^[^\u0000-\u001f\u007f]{1,255}$/.test(host) ? host : '' };
}

/** The damage an API error body reports, or null when it reports none.
    @param {unknown} body
    @returns {{ reason: 'corrupt' | 'unreadable', file: string, backup: string | null } | null} */
export function readConfigDamage(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, any>} */ (body);
  const reason = Object.keys(DAMAGE_CODES).find(r => DAMAGE_CODES[r] === b.code);
  if (!reason) return null;
  const detail = b.detail && typeof b.detail === 'object' ? b.detail : {};
  const file = typeof detail.file === 'string' && FILE_NAME.test(detail.file) ? detail.file : 'apps.json';
  const backup = typeof detail.backup === 'string' && FILE_NAME.test(detail.backup) ? detail.backup : null;
  return { reason: /** @type {'corrupt' | 'unreadable'} */ (reason), file, backup };
}

/** Translated markup with each name escaped once. The names are filled in after
    the markup is sanitized, so a name can never add a tag.
    @param {(vars: Record<string, string>) => string} translate
    @param {Record<string, string> | undefined} vars
    @param {(s: string) => string} sanitize @param {(s: string) => string} escapeName
    @returns {string} */
export function fillNames(translate, vars, sanitize, escapeName) {
  const given = vars || {};
  const names = Object.keys(given);
  const marker = i => `\u0001${i}\u0001`;
  let out = sanitize(translate(Object.fromEntries(names.map((n, i) => [n, marker(i)]))));
  names.forEach((n, i) => {
    out = out.split(marker(i)).join(escapeName(given[n]));
  });
  return out;
}

/** @param {{ reason: string, file: string, backup: string | null }} damage
    @returns {{ key: string, vars?: Record<string, string> }[]} */
export function recoverySteps({ reason, file, backup }) {
  const steps = [];
  if (reason === 'unreadable') steps.push({ key: 'configRecovery.stepPermissions', vars: { file } });
  else {
    steps.push(
      backup
        ? { key: 'configRecovery.stepRepairBackup', vars: { file, backup } }
        : { key: 'configRecovery.stepRepair', vars: { file } },
    );
    steps.push({ key: 'configRecovery.stepExport', vars: { file } });
  }
  steps.push({ key: 'configRecovery.stepStartOver', vars: { file } });
  steps.push({ key: 'configRecovery.stepCheck' });
  return steps;
}

/** The first browser language Stackyard ships, else English. The saved
    language is in the file that cannot be read.
    @param {readonly string[]} preferred @param {readonly string[]} supported
    @returns {string} */
export function pickLanguage(preferred, supported) {
  for (const tag of preferred || []) {
    const want = String(tag);
    const exact = supported.find(c => c.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const base = want.split('-')[0].toLowerCase();
    const loose = supported.find(c => c.toLowerCase().split('-')[0] === base);
    if (loose) return loose;
  }
  return 'en';
}

/** What the screen shows for an API error body, or null when the body is not
    one that stops the whole page.
    @param {unknown} body @param {string} [fallbackHost] the page's own address */
export function screenFor(body, fallbackHost = '') {
  const damage = readConfigDamage(body);
  if (damage) {
    const why = damage.reason === 'unreadable' ? 'configRecovery.whyUnreadable' : 'configRecovery.whyCorrupt';
    return {
      title: 'configRecovery.title',
      why: { key: why, vars: { file: damage.file } },
      safe: 'configRecovery.locked',
      stepsTitle: 'configRecovery.stepsTitle',
      steps: recoverySteps(damage),
      still: 'configRecovery.stillDamaged',
      logHint: true,
      help: HELP_URL,
    };
  }
  const block = readHostBlock(body);
  if (block) {
    const host = block.host || fallbackHost;
    return {
      title: 'hostBlock.title',
      why: { key: 'hostBlock.why', vars: { host } },
      safe: 'hostBlock.safe',
      stepsTitle: 'hostBlock.stepsTitle',
      steps: [
        { key: 'hostBlock.stepOpen' },
        { key: 'hostBlock.stepAllow', vars: { host } },
        { key: 'hostBlock.stepPassword' },
        { key: 'configRecovery.stepCheck' },
      ],
      still: 'hostBlock.stillBlocked',
      logHint: false,
      help: HOST_HELP_URL,
    };
  }
  return null;
}
