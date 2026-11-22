  import { poll, linkTo, loadStrings, wt, errorState, errorLine, placeholder, localiseDigits, cssZoom, readerHourCycle } from '/js/widget-toolbox.js?v=039ea657';
  import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
  import { visibleItems, dayOffset, kindClass } from './upnext-logic.js';

  await loadStrings();
  const card = document.getElementById('card');
  const rowsEl = document.getElementById('rows');
  const noteEl = document.getElementById('note');
  card.setAttribute('aria-label', wt('widget.label', 'Up Next'));

  const ROWS = { small: 3, medium: 3, large: 7 };
  const params = new URLSearchParams(location.search);
  const size = Object.hasOwn(ROWS, params.get('size')) ? params.get('size') : 'small';
  const count = ROWS[size];
  const withName = size !== 'small';
  rowsEl.style.setProperty('--rows', String(count));
  initFluidHover(document, [{ container: '#rows', item: '.row.clickable', zoom: cssZoom }]);

  const lang = params.get('lang') || 'en';
  const hourCycle = readerHourCycle(navigator.language);
  const fmt = (o) => { try { return new Intl.DateTimeFormat(lang, o); } catch { return new Intl.DateTimeFormat('en', o); } };
  const WEEKDAY = fmt({ weekday: 'short' });
  const SHORT_DATE = fmt({ day: 'numeric', month: 'short' });
  const DAY_NO = fmt({ day: 'numeric' });
  const HOUR = fmt({ hour: 'numeric', hourCycle });
  const HOUR_MIN = fmt({ hour: 'numeric', minute: '2-digit', hourCycle });
  const timeOf = (d) => (d.getMinutes() ? HOUR_MIN : HOUR).format(d);
  /* A day item's date is a calendar day: read it as local, never as UTC midnight. */
  const dateOf = (i) => (i.at ? new Date(i.at) : new Date(i.day + 'T00:00:00'));

  const ALBUM = { album: ['ui.album', 'Album'], ep: ['ui.ep', 'EP'], single: ['ui.single', 'Single'] };
  const RELEASE = {
    cinema: ['releases.opt.cinema', 'In cinemas'],
    digital: ['releases.opt.digital', 'Digital release'],
    physical: ['releases.opt.physical', 'Physical release'],
  };
  const APP = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' };

  function episodeCode(i) {
    if (i.season === 0) return wt('ui.special', 'Special');
    if (i.season == null || i.episode == null) return '';
    const n = (v) => localiseDigits(String(v));
    return i.lastEpisode > i.episode
      ? wt('ui.episodes', 'S{season} · E{first}–{last}', { season: n(i.season), first: n(i.episode), last: n(i.lastEpisode) })
      : wt('ui.episode', 'S{season} · E{episode}', { season: n(i.season), episode: n(i.episode) });
  }
  function detail(i) {
    if (i.kind === 'film') {
      const [k, en] = RELEASE[i.release] || RELEASE.digital;
      return wt(k, en);
    }
    if (i.kind === 'album') {
      const type = ALBUM[i.albumType];
      return [i.artist, type ? wt(type[0], type[1]) : ''].filter(Boolean).join(' · ');
    }
    const mark = i.premiere ? wt('ui.premiere', 'Premiere')
      : i.finale === 'series' ? wt('ui.seriesFinale', 'Series finale')
      : i.finale === 'season' ? wt('ui.seasonFinale', 'Season finale') : '';
    const parts = [episodeCode(i), mark, withName && !mark ? i.name : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : wt('ui.newEpisode', 'New episode');
  }
  function gutter(i, now) {
    const d = dateOf(i);
    const off = dayOffset(d, now);
    const today = size === 'small' ? wt('ui.todayShort', 'Today') : wt('ui.today', 'Today');
    const top = off === 0 ? today : WEEKDAY.format(d);
    const bottom = i.at && off < 7 ? timeOf(d) : off < 7 ? DAY_NO.format(d) : SHORT_DATE.format(d);
    return { top, bottom, today: off === 0 };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function row(i, now) {
    const g = gutter(i, now);
    const li = el('li');
    const r = el('div', `row ${kindClass(i)}${g.today ? ' today' : ''}`);
    r.dataset.k = [i.kind, i.title, i.at || i.day, i.release || '', i.episode ?? ''].join('|');
    const gt = el('div', 'gt');
    gt.append(el('b', '', g.top), el('small', '', g.bottom));
    gt.setAttribute('aria-hidden', 'true');
    const tx = el('div', 'tx');
    const sub = detail(i);
    const title = el('div', 'ttl', i.title);
    const line = el('div', 'sub', sub);
    title.dir = 'auto';
    line.dir = 'auto';
    tx.append(title, line);
    tx.setAttribute('aria-hidden', 'true');
    const said = el('span', 'sr', wt('ui.sayItem', '{title}, {detail}, {when}', { title: i.title, detail: sub, when: `${g.top} ${g.bottom}` }));
    r.append(gt, el('i', 'bar'), tx, said);
    linkTo(r, i.link);
    li.append(r);
    return li;
  }

  function loading() {
    rowsEl.replaceChildren();
    for (let n = 0; n < count; n++) {
      const li = el('li', 'ph-row');
      const gt = el('div', 'ph-gt');
      gt.append(placeholder(30, 11), placeholder(22, 9));
      const bar = placeholder(3, 0, 2);
      bar.style.alignSelf = 'stretch';
      bar.style.height = 'auto';
      bar.style.margin = '7px 0';
      const w = [78, 64, 86, 58, 72, 82, 66][n] * (size === 'small' ? 1 : 0.7);
      const tx = el('div', 'ph-tx');
      tx.append(placeholder(w + '%', 11), placeholder(Math.round(w * 0.6) + '%', 9));
      li.append(gt, bar, tx);
      rowsEl.append(li);
    }
  }

  function fitGutter() {
    rowsEl.style.setProperty('--gt', 'max-content');
    const widest = Math.max(44, ...[...rowsEl.querySelectorAll('.gt')].map((g) => Math.ceil(g.getBoundingClientRect().width / cssZoom())));
    rowsEl.style.setProperty('--gt', Math.min(widest, size === 'small' ? 56 : 76) + 'px');
  }

  const state = errorState({ root: card, content: rowsEl, place: 'auto' });
  const nothing = errorState({ root: card, content: rowsEl, hideOnEmpty: true, place: 'center' });
  const note = errorState({ root: card, content: () => [], caption: noteEl });
  let last = null;
  let failing = false;
  let shown = '';

  function render(data) {
    last = data;
    const now = new Date();
    const list = visibleItems(data.items, now).slice(0, count);
    const missing = Array.isArray(data.missing) ? data.missing : [];
    const rows = list.map((i) => row(i, now));
    const sig = JSON.stringify([missing, data.calendar, data.days, rows.map((r) => r.outerHTML)]);
    if (sig === shown) return;
    shown = sig;
    const focused = /** @type {HTMLElement|null} */ (document.activeElement);
    const had = focused && rowsEl.contains(focused) ? focused.closest('.row')?.dataset.k : null;
    if (!list.length) {
      rowsEl.replaceChildren();
      state.ok();
      linkTo(card, data.calendar || '');
      nothing.empty(wt('ui.nothing', 'Nothing in the next {days} days', { days: localiseDigits(String(data.days || 90)) }));
    } else {
      linkTo(card, '');
      rowsEl.replaceChildren(...rows);
      fitGutter();
      nothing.ok();
      state.ok();
      if (had) [...rowsEl.querySelectorAll('.row')].find((r) => r.dataset.k === had)?.focus();
    }
    if (missing.length) {
      const kinds = [...new Set(missing.map((m) => m.kind))];
      const line = note.fail({ kind: kinds.length === 1 ? kinds[0] : 'network' }, { inert: false });
      const apps = [...new Set(missing.map((m) => APP[m.app] || m.app))];
      const b = noteEl.querySelector('b');
      b.textContent = wt('ui.appProblem', '{app} · {problem}', { app: apps.join(', '), problem: line });
      if (kinds.length > 1) {
        b.setAttribute('aria-hidden', 'true');
        noteEl.append(el('span', 'sr', missing
          .map((m) => wt('ui.appProblem', '{app} · {problem}', { app: APP[m.app] || m.app, problem: errorLine({ kind: m.kind }) }))
          .join(', ')));
      }
    } else note.ok();
    card.classList.toggle('capped', missing.length > 0 && list.length > 0);
  }

  loading();
  poll({
    render: (data) => {
      failing = false;
      render(data);
    },
    onError: ({ error, everOk, stale, since }) => {
      if (everOk && !stale) return;
      failing = true;
      shown = '';
      note.ok();
      nothing.ok();
      state.fail(error, { since, inert: everOk });
      card.classList.add('capped');
    },
    interval: 900000,
  });
  setInterval(() => {
    if (document.hidden) return;
    if (last && !failing) render(last);
  }, 60000);
