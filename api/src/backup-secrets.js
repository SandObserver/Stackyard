/* Backup slots let several slots point at the same backup instance, where the
   password is entered once and shared. After secrets are scrubbed from the
   config sent to the browser, a newly added slot pointing at an existing
   instance arrives with a URL but no password. This fills that password in from
   a sibling slot of the same provider and URL that already has one.

   This is the one widget-specific secret rule that the generic manifest-driven
   path in widget-secrets.js cannot express, so it lives here and is applied
   only to backup widgets. Mutates the slots array in place. */
const DONORS = [
  { provider: 'duplicati', urlKey: 'dupUrl',   passKey: 'dupPass' },
  { provider: 'kopia',     urlKey: 'kopiaUrl', passKey: 'kopiaPass' },
];

function applyBackupSlotDonors(slots) {
  if (!Array.isArray(slots)) return slots;
  slots.forEach((slot, i) => {
    if (!slot || typeof slot !== 'object') return;
    for (const { provider, urlKey, passKey } of DONORS) {
      if (slot.provider !== provider || !slot[urlKey] || slot[passKey]) continue;
      const donor = slots.find((s, j) =>
        j !== i && s && s.provider === provider && s[urlKey] === slot[urlKey] && s[passKey]);
      if (donor) { slot[passKey] = donor[passKey]; slot[passKey + 'Set'] = true; }
    }
  });
  return slots;
}

module.exports = { applyBackupSlotDonors };
