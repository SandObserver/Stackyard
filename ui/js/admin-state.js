// @ts-check
/* Admin UI — shared mutable state.
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
  _wslots: [],
  _wnet: { enabled: false, url: '', provider: 'myspeed' },
  _wmapCfg: {},
  _wconnView: 'map',
  _wvpnCfg: {},
  _customUrl: '',
  _wlabel: '',
  _wgithubCfg: {},
  _wclockCfg: {},
  _wbackupCfg: {},
  _wstatsSubType: 'system-summary',
  _wdiskCfg: { diskProvider: 'scrutiny', scrutinyUrl: '', scrutinyHref: '', truenasUrl: '', truenasKeySet: false, truenasHref: '', bays: [] },
  _iframeOpts: {},
  _wweatherCfg: { city: '', lat: '', lon: '', units: 'c', href: '' },

  _wAutoCfg: {},
  _autoForm: null,
  _autoFormType: null,
};