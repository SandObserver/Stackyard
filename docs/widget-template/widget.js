import { errorState, formatNumber, linkTo, loadStrings, placeholder, poll, wt } from '/js/widget-toolbox.js?v=039ea657';

await loadStrings();

const root = document.getElementById('root');
const valueEl = document.getElementById('value');
document.getElementById('caption').textContent = wt('ui.caption', 'Total');
root.setAttribute('aria-label', wt('widget.label', 'My Widget'));
valueEl.replaceChildren(placeholder(48, 26, 6));

const state = errorState({ root, content: [valueEl], caption: document.getElementById('msg') });

poll({
  interval: 30000,
  render: data => {
    state.ok();
    linkTo(root, data.link);
    valueEl.textContent = formatNumber(data.count);
  },
  onError: ({ error, everOk, stale, since }) => {
    if (!everOk || stale) state.fail(error, { since, inert: everOk });
  },
});
