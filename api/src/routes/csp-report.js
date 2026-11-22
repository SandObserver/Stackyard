const { on, readBodyCapped, getIp } = require('../router');
const { attemptAddress, rateLimit } = require('../auth');
const { remember } = require('../bounded-cache');
const log = require('../log');

/* Keep equal to client_max_body_size in the /api/csp-report location of
   nginx/dashboard.conf. */
const REPORT_BODY_MAX_BYTES = 16 * 1024;
const PER_CLIENT_PER_MINUTE = 60;
const ALL_PER_MINUTE = 300;
const REPORTS_PER_BODY = 20;
const REPEAT_MS = 60 * 60 * 1000;
const KEPT = 500;
const SAMPLE_CHARS = 40;
const TEXT_CHARS = 200;

const TYPES = new Set(['application/reports+json', 'application/csp-report']);
const SAMPLED = new Set(['inline', 'trusted-types-sink', 'trusted-types-policy']);
const KEYWORDS = new Set([...SAMPLED, 'eval', 'wasm-eval', 'self', 'data', 'blob']);

/** @type {Map<string, number>} */
const _logged = new Map();

const text = (v, max = TEXT_CHARS) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = v => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : undefined);

/** A URL without its query and fragment. A keyword such as 'inline' as it is.
    @param {unknown} v @returns {string} */
function where(v) {
  const s = text(v, 2048);
  if (!s) return '';
  if (KEYWORDS.has(s)) return s;
  try {
    const u = new URL(s);
    return text(u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}${u.pathname}` : u.protocol);
  } catch {
    return '';
  }
}

/** @param {unknown} v @returns {string} */
function pagePath(v) {
  try {
    return text(new URL(text(v, 2048)).pathname);
  } catch {
    return '';
  }
}

/** One report in either format, reduced to what may be logged.
    @param {Record<string, unknown>} r the report body, in the modern names */
function violation(r) {
  const directive = text(r.effectiveDirective || r.violatedDirective, 64).split(' ')[0];
  if (!/^[a-z-]+$/.test(directive)) return null;
  const blocked = where(r.blockedURL);
  const out = {
    directive,
    blocked: blocked || 'unknown',
    page: pagePath(r.documentURL),
    line: count(r.lineNumber),
    column: count(r.columnNumber),
    disposition: r.disposition === 'enforce' ? 'enforce' : 'report',
  };
  if (SAMPLED.has(blocked) && typeof r.sample === 'string' && r.sample) {
    /* Log only the sink name before "|". The value after it is page content. */
    const sample = blocked === 'trusted-types-sink' ? r.sample.split('|')[0] : r.sample;
    out.sample = sample.slice(0, SAMPLE_CHARS);
  }
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined && value !== ''));
}

function fromLegacy(body) {
  const r = body && typeof body === 'object' ? body['csp-report'] : null;
  if (!r || typeof r !== 'object') return [];
  return [
    {
      effectiveDirective: r['effective-directive'],
      violatedDirective: r['violated-directive'],
      blockedURL: r['blocked-uri'],
      documentURL: r['document-uri'],
      lineNumber: r['line-number'],
      columnNumber: r['column-number'],
      sample: r['script-sample'],
      disposition: r.disposition,
    },
  ];
}

function fromReports(body) {
  if (!Array.isArray(body)) return [];
  return body
    .filter(r => r && typeof r === 'object' && r.type === 'csp-violation' && r.body && typeof r.body === 'object')
    .map(r => r.body);
}

/** @param {string} type @param {string} raw @returns {object[]} */
function parseReports(type, raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return [];
  }
  const reports = type === 'application/csp-report' ? fromLegacy(body) : fromReports(body);
  return reports
    .slice(0, REPORTS_PER_BODY)
    .map(violation)
    .filter(v => v !== null);
}

/** Logs a violation once per REPEAT_MS. @returns {boolean} whether it logged */
function logOnce(v, now = Date.now()) {
  const key = [v.directive, v.blocked, v.page, v.line, v.column, v.disposition].join('|');
  const at = _logged.get(key);
  if (at !== undefined && now - at < REPEAT_MS) return false;
  remember(_logged, key, now, KEPT);
  log.warn('content security policy violation', v);
  return true;
}

function noContent(res) {
  if (res.headersSent) return;
  res.writeHead(204);
  res.end();
}

/** Spends one report from the client's budget and the global budget.
    @param {string} client @returns {boolean} whether both had room */
const spend = client =>
  !rateLimit(client, 'csp-report', PER_CLIENT_PER_MINUTE, 60_000) &&
  !rateLimit('all', 'csp-report', ALL_PER_MINUTE, 60_000);

on('POST', '/api/csp-report', async (req, res) => {
  try {
    const type = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const client = attemptAddress(getIp(req));
    if (!spend(client) || !TYPES.has(type)) {
      req.resume();
      return noContent(res);
    }
    const raw = (await readBodyCapped(req, REPORT_BODY_MAX_BYTES)).toString('utf8');
    /* Spend one per report. Otherwise one body logs up to REPORTS_PER_BODY lines past the limits. */
    const reports = parseReports(type, raw);
    for (let i = 0; i < reports.length && (i === 0 || spend(client)); i++) logOnce(reports[i]);
  } catch {}
  noContent(res);
});

module.exports = {
  REPORT_BODY_MAX_BYTES,
  PER_CLIENT_PER_MINUTE,
  ALL_PER_MINUTE,
  REPEAT_MS,
  parseReports,
  logOnce,
  _resetLogged: () => _logged.clear(),
};
