// @ts-check
/* Admin UI: shared mutable state.
   One object so the admin modules can read and write the same values. Fields
   keep the names they had as module-level variables; only the access changed
   (items -> state.items). List-only state (_flt, collapsedFolders) stays local
   to the list code and is intentionally not here. */

export const state = {
  items: [],
  /* The id of the item being edited, or null when adding. Was an array index,
     which went stale the moment items moved: writing at a position past the end
     grew the array with holes, JSON turned those into nulls, and the server
     rejected the whole save with a message about missing ids. An id cannot drift
     the way a position can. */
  eid: null,
  saving: false,
  _settings: {},
  _widgetReg: {},

  ctype: 'app',
  siurl: '',
  scol: 'dark',
  spaths: [],
  fnums: [],

  _evItem: null,
  _evIsEdit: false,

  _wtype: 'custom',
  _wsize: 'medium',
  _customUrl: '',
  _wlabel: '',
  _wgithubCfg: {},
  _wclockCfg: {},
  _iframeOpts: {},

  _wAutoCfg: {},
  _autoForm: null,
  _autoFormType: null,
};