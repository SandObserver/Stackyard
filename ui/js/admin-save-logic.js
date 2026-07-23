// @ts-check
/* Pure assembly/validation logic lifted out of admin doSave so it can be
   unit-tested without a DOM. Each function takes plain data (widget state that
   the form has already collected) and returns plain data; the DOM reads stay in
   doSave. No DOM, no module state. */

/* Turn a label into a safe id stem: letters/digits/underscores only, collapsed,
   trimmed, with a type-specific fallback when nothing usable remains. */
export function cleanId(label, fallback = 'item') {
  return String(label || '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

/* Map the first three stats slots to their saved shape (disk/temp carry extra
   fields; everything else is just type + optional color). */
export function buildStatsSlots(wslots) {
  return (wslots || []).slice(0, 3).map((s) => {
    const color = s.color || undefined;
    if (s.type === 'disk') return { type: 'disk', primary: s.primary || '/', secondary: s.secondary || undefined, color };
    if (s.type === 'temp') return { type: 'temp', thermalZone: Number.isInteger(s.thermalZone) ? s.thermalZone : 0, color };
    return { type: s.type, color };
  });
}

/* Finalize backup slots for saving: for non-small widgets, copy the default
   instance's connection onto every same-provider slot that uses the default;
   then validate every provider slot has a URL; then strip runtime-only fields.
   Mutates `slots` (the propagation) to match the previous inline behavior, and
   returns either { error } or { savableSlots }. */
export function finalizeBackupSlots(slots, size) {
  if (size !== 'small') {
    const propagate = (prov) => {
      const fi = slots.findIndex(s => s.provider === prov);
      if (fi < 0) return;
      const def = slots[fi];
      if (def.useDefault === false) return;
      slots.forEach((t, j) => {
        if (j === fi || t.provider !== prov || t.useDefault === false) return;
        if (prov === 'duplicati') {
          t.dupUrl = def.dupUrl; t.dupHref = def.dupHref; t.dupPollSec = def.dupPollSec;
          if (def.dupPass) t.dupPass = def.dupPass; t.dupPassSet = def.dupPassSet;
        } else {
          t.kopiaUrl = def.kopiaUrl; t.kopiaUser = def.kopiaUser; t.kopiaHref = def.kopiaHref;
          if (def.kopiaPass) t.kopiaPass = def.kopiaPass; t.kopiaPassSet = def.kopiaPassSet;
        }
      });
    };
    propagate('duplicati'); propagate('kopia');
  }

  const ord = ['First', 'Second', 'Third'];
  for (const [si, slot] of slots.entries()) {
    if (slot.provider === 'duplicati' && !slot.dupUrl) return { error: `URL required for ${ord[si] || ''} Duplicati instance` };
    if (slot.provider === 'kopia' && !slot.kopiaUrl) return { error: `URL required for ${ord[si] || ''} Kopia instance` };
  }

  const savableSlots = slots.map(s => ({
    provider:     s.provider,
    jobId:        s.jobId || null,
    customName:   s.customName || undefined,
    useDefault:   s.provider ? (s.useDefault !== false) : undefined,
    dupUrl:       s.dupUrl || undefined,
    dupPassSet:   s.dupPassSet || undefined,
    dupHref:      s.dupHref || undefined,
    dupPollSec:   s.dupPollSec !== 60 ? s.dupPollSec : undefined,
    dupPass:      s.dupPass || undefined,
    kopiaUrl:     s.kopiaUrl || undefined,
    kopiaUser:    s.kopiaUser || undefined,
    kopiaPassSet: s.kopiaPassSet || undefined,
    kopiaHref:    s.kopiaHref || undefined,
    kopiaPass:    s.kopiaPass || undefined,
  }));
  return { savableSlots };
}

/* Assemble an app item from already-read form values (v). Validates name/url,
   builds the monitoring block (healthcheck + activity badge), the custom badge
   display, and the static badge. Returns { error } or { item }. */
export function buildAppItem(v, orig) {
  if (!v.label) return { error: 'Name required' };
  if (!v.href)  return { error: 'URL required' };
  const DEFCOL = '#0289ff';
  const customObj = (v.actColor && v.actColor !== DEFCOL) || v.custUnit ? {
    color: v.actColor && v.actColor !== DEFCOL ? v.actColor : undefined,
    unit:  v.custUnit || undefined,
  } : undefined;
  const staticBadgeObj = v.staticEn && v.staticLabel
    ? { enabled: true, label: v.staticLabel.slice(0, 10), color: v.staticColor || 'blue' }
    : undefined;
  const spaths = v.spaths || [];
  return { item: {
    id: orig?.id || cleanId(v.label, 'app') + '_' + Date.now(),
    type: 'app', label: v.label, href: v.href,
    iconUrl: v.iconUrl, color: v.scol || 'dark',
    dock: v.dock || false,
    skipTlsVerify: v.skipTlsVerify || undefined,
    monitoring: {
      healthcheck: { enabled: v.hcEn && (!!v.hcCon || !!v.hcPing), container: v.hcCon, pingUrl: v.hcPing },
      activity: {
        enabled: v.actEn && !!v.actUrl, url: v.actUrl,
        params:  v.actParams?.length ? v.actParams : undefined,
        headers: v.actHeaders?.length ? v.actHeaders : undefined,
        extract: spaths.length === 1 ? spaths[0] : spaths.length > 1 ? spaths.map(p => ({ path: p })) : undefined,
        interval: Math.max(10, v.actInt),
        custom: customObj,
      },
      staticBadge: staticBadgeObj,
    },
  } };
}
