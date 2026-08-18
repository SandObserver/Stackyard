// @ts-check

export const state = {
  items: [],
  /* An id, never a position. A position goes stale as soon as items move. */
  eid: null,
  saving: false,
  _settings: {},
  _widgetReg: Object.create(null),
  /* Widgets the server found but refused, as { name, errors }. */
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
  _autoFormSession: null,
  _evSession: 0,
};
