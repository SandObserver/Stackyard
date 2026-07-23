// @ts-check
/* Admin UI: shared mutable state.
   One object so the admin modules can read and write the same values. Fields
   keep the names they had as module-level variables; only the access changed
   (items -> state.items). List-only state (_flt, collapsedFolders) stays local
   to the list code and is intentionally not here. */

export const state = {
  items: [],
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
  _wbackupCfg: {},
  _iframeOpts: {},

  _wAutoCfg: {},
  _autoForm: null,
  _autoFormType: null,
};