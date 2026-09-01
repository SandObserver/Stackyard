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
  /* Live Activity label styling, keyed by value path. */
  slabels: Object.create(null),
  slegacySum: false,
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

/* Which folders are collapsed, and what the list is filtered to. Both the page
   and the list read and write these, so they live here rather than in either. */
export const collapsedFolders = new Set();

export const filter = { q: '', type: 'all' };
