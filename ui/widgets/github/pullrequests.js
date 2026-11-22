import { poll, fetchData, getConfig, linkTo, loadStrings, wt, errorState, formatNumber, fitText, placeholder, formatList } from '/js/widget-toolbox.js?v=039ea657';
await loadStrings();

const TICK_MS = 60000;
const params = new URLSearchParams(location.search);
const MOBILE = params.get('mobile') === '1';
const size = ['small', 'medium', 'large'].includes(params.get('size')) ? params.get('size') : 'medium';
const ROWS = { small: 0, medium: 3, large: 4 }[size];
const FILTER_FALLBACK = { created: 'Created', assigned: 'Assigned', mentioned: 'Mentioned', 'review-requested': 'Review requested' };

const w = document.getElementById('widget');
let user = '';
let gitlab = false;
let noun = wt('ui.pullRequests', 'Pull requests');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
function line(cls, text) {
  const n = el('div', cls, text);
  const first = String(text).match(/\p{L}/u);
  n.dir = first && RTL_LETTER.test(first[0]) ? 'rtl' : 'ltr';
  return n;
}

const head = el('div', 'head');
const fig = el('div', 'fig');
const num = el('div', 'num');
const sub = el('div', 'sub');
fig.append(num, sub);
const lbl = el('div', 'lbl', noun);
head.append(lbl, fig);
const list = el('div', 'list');
w.className = 'widget size-' + size;
w.append(head);
if (ROWS) w.append(list);
num.append(placeholder(48, 30, 6));
sub.append(placeholder(70, 10));
for (let i = 0; i < ROWS; i++) {
  const row = el('div', 'pr');
  row.append(placeholder(`${88 - (i % 3) * 14}%`, 11), placeholder('38%', 9));
  list.append(row);
}

const state = errorState({ root: document.body, caption: document.getElementById('cap'), content: () => [w] });

function repoName(repo) {
  const own = user.toLowerCase() + '/';
  return user && String(repo).toLowerCase().startsWith(own) ? String(repo).slice(own.length) : String(repo);
}

function render(data) {
  const total = formatNumber(Math.max(0, Number(data.totalCount) || 0));
  const filters = Array.isArray(data.filters) && data.filters.length ? data.filters : ['created'];
  const label = formatList(filters.map(f => wt('githubPrFilters.opt.' + f, FILTER_FALLBACK[f] || f)), 'plain');
  num.textContent = total;
  fitText(num);
  sub.textContent = label;
  const target = MOBILE && !ROWS ? w : head;
  if (linkTo(target, data.allUrl))
    target.setAttribute(
      'aria-label',
      `${noun}, ${total} ${label}, ${wt('ui.viewAll', 'view all')}`,
    );
  if (!ROWS) return;

  const items = (Array.isArray(data.items) ? data.items : []).filter(pr => pr && typeof pr === 'object' && (pr.title || pr.number)).slice(0, ROWS);
  list.replaceChildren();
  if (!items.length) {
    list.removeAttribute('role');
    list.append(el('div', 'none', gitlab ? wt('ui.noMrs', 'No open merge requests') : wt('ui.noPrs', 'No open pull requests')));
    return;
  }
  list.setAttribute('role', 'list');
  for (const pr of items) {
    const item = el('div');
    item.setAttribute('role', 'listitem');
    const link = el('div', 'pr');
    const repo = repoName(pr.repo || '');
    const title = String(pr.title || (pr.number ? '#' + pr.number : ''));
    link.append(line('title', title), line('repo', repo));
    const ref = pr.number ? `${repo} #${pr.number}` : repo;
    if (linkTo(link, pr.url)) link.setAttribute('aria-label', `${ref}: ${title}`);
    item.append(link);
    list.append(item);
  }
}

async function boot() {
  const wc = (await getConfig().catch(() => null))?.widgetConfig || {};
  user = String(wc.githubUser || '');
  gitlab = wc.githubService === 'gitlab';
  if (gitlab) noun = wt('ui.mergeRequests', 'Merge requests');
  lbl.textContent = noun;
  w.setAttribute('aria-label', noun);
  poll({
    fetch: () => fetchData('data'),
    interval: TICK_MS,
    render: d => { state.ok(); render(d); },
    onError: ({ error, everOk, stale, since }) => {
      if (!everOk || stale) state.fail(error, { since, inert: everOk });
    },
  });
}

boot();
