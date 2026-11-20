/** @param {{ mob?: boolean, bootTimeoutMs?: number }} [start] */
export function createDashboardState({ mob = false, bootTimeoutMs } = {}) {
  return {
    /** @type {any[]} */
    items: [],
    /** @type {any} */
    S: {},
    /** @type {unknown} */
    rev: null,
    /* Null prototype. Keyed by values from config, so an inherited property must
       never answer a miss. */
    /** @type {Record<string, any>} */
    widgetReg: Object.create(null),
    pg: 0,
    totalPages: 0,
    mob,
    bootTimeoutMs,
    /** @type {{ spotOpen: any, spotClose: any, mobPillBump: any, mobPillSync: any, homeSwipe: any }} */
    CB: { spotOpen: null, spotClose: null, mobPillBump: null, mobPillSync: null, homeSwipe: null },
  };
}

/** @typedef {ReturnType<typeof createDashboardState>} DashboardState */
