// @ts-check
/* What the settings-file recovery screen says. Keep it free of the DOM and of
   imports: the API requires it. */

export const HELP_URL =
  'https://stackyard.sandobserver.com/docs/troubleshooting/#stackyard-cannot-read-its-settings-file';

export const DAMAGE_CODES = Object.freeze({
  corrupt: 'internal.config-corrupt',
  unreadable: 'internal.config-unreadable',
});

/* The names go into translated markup unescaped. */
const FILE_NAME = /^[\w.-]{1,200}$/;

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
