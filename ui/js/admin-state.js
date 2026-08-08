// @ts-check
/* Shared mutable state for the admin modules. List-only state stays local to the
   list code and deliberately not here. */

export const state = {
  items: [],
  /* An id, never a position: a position goes stale as soon as items move. */
  eid: null,
  saving: false,
  _settings: {},
  _widgetReg: Object.create(null),
  /* Widgets the server found but refused, as { name, errors }. Kept so the
     config editor can say why a widget's settings cannot be shown. */
  _widgetRejected: [],

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
  _iframeOpts: {},

  _wAutoCfg: {},
  _autoForm: null,
  _autoFormType: null,
};