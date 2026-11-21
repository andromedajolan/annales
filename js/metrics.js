// Stage 4: manual numbers for a release or a post, with stat tiles and small charts.
import * as store from './store.js';
import { h, toast, confirmBox } from './kit.js';
import { METRIC_LABELS, METRICS_BY_SCOPE, todayStr, fmtDate, fmtDateShort } from './model.js';
import { lineChart, fmtNum } from './chart.js';

// label, headline value, optional delta text, optional sub-line
export function tile(label, value, delta, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    delta ? h('div', { class: 'tile-delta ' + delta.dir }, delta.text) : null,
    sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

export function tilesFor(scope, targetId) {
  const latest = store.latestValues(scope, targetId);
  return METRICS_BY_SCOPE[scope].filter(k => latest[k]).map(k => {
    const l = latest[k];
    const d = l.prev != null ? l.value - l.prev : null;
    return tile(METRIC_LABELS[k], fmtNum(l.value),
      d != null ? { dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat', text: (d >= 0 ? '+' : '') + fmtNum(d) + ' since ' + fmtDateShort(l.prevDate) } : null,
      'as of ' + fmtDateShort(l.date));
  });
}

export function chartsFor(scope, targetId) {
  const entries = store.metricsFor(scope, targetId);
  const out = [];
  for (const k of METRICS_BY_SCOPE[scope]) {
    const points = entries.filter(e => e.values[k] != null).map(e => ({ date: e.date, value: e.values[k] }));
    if (points.length >= 2) out.push(lineChart({ title: METRIC_LABELS[k], points }));
  }
  return out;
}

export function metricPanel(scope, rec, opts = {}) {
  const keys = METRICS_BY_SCOPE[scope];
  const box = h('section', { class: 'panel' });
  const dateIn = h('input', { type: 'date', value: todayStr(), 'aria-label': 'As of date' });
  const noteIn = h('input', { type: 'text', placeholder: 'Note (optional)', autocomplete: 'off', 'aria-label': 'Note' });
  const inputs = {};
  for (const k of keys) {
    const el = h('input', { type: 'number', min: 0, step: 1, 'aria-label': METRIC_LABELS[k] });
    el.setAttribute('inputmode', 'numeric');
    inputs[k] = el;
  }
  const form = h('div', { class: 'metric-form' },
    h('div', { class: 'grid' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'As of'), dateIn),
      keys.map(k => h('label', { class: 'field' }, h('span', { class: 'lbl' }, METRIC_LABELS[k]), inputs[k]))),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Note'), noteIn),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: add }, 'Save numbers')));

  function add() {
    const values = {};
    for (const k of keys) {
      const raw = inputs[k].value.trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) { toast(METRIC_LABELS[k] + ' must be a number, 0 or more.'); return; }
      values[k] = Math.round(n);
    }
    if (!Object.keys(values).length) { toast('Type at least one number.'); return; }
    if (!dateIn.value) { toast('Pick the date these numbers are from.'); return; }
    store.saveMetric(scope, rec.id, dateIn.value, values, noteIn.value.trim());
    for (const k of keys) inputs[k].value = '';
    noteIn.value = '';
    toast('Numbers saved.');
    draw();
  }

  let started = false;
  function draw() {
    if (started && opts.onChange) opts.onChange();
    const entries = store.metricsFor(scope, rec.id);
    const latest = store.latestValues(scope, rec.id);
    for (const k of keys) inputs[k].placeholder = latest[k] ? 'now ' + fmtNum(latest[k].value) : '';
    const tiles = tilesFor(scope, rec.id), charts = chartsFor(scope, rec.id);
    const rows = entries.slice().reverse().map(e => h('tr', {},
      h('td', {}, fmtDate(e.date), e.note ? h('div', { class: 'muted small' }, e.note) : null),
      keys.map(k => h('td', { class: 'num' }, e.values[k] != null ? fmtNum(e.values[k]) : '–')),
      h('td', { class: 'row-actions' },
        h('button', {
          class: 'btn small', type: 'button', 'aria-label': 'Edit numbers from ' + fmtDate(e.date),
          onclick: () => {
            dateIn.value = e.date; noteIn.value = e.note || '';
            for (const k of keys) inputs[k].value = e.values[k] != null ? String(e.values[k]) : '';
            inputs[keys[0]].focus();
          },
        }, 'Edit'),
        h('button', {
          class: 'btn small', type: 'button', 'aria-label': 'Delete numbers from ' + fmtDate(e.date),
          onclick: async () => {
            if (!(await confirmBox('Delete these numbers?', 'The entry from ' + fmtDate(e.date) + ' will be removed.', 'Delete', true))) return;
            await store.deleteSimple('metrics', e.id);
            draw();
          },
        }, '×'))));
    box.replaceChildren(
      h('h3', {}, 'Numbers'),
      h('p', { class: 'muted small' }, 'Type the totals the platform shows as of a date. Saving a date that already has an entry replaces just the numbers you type. Nothing is fetched from any platform.'),
      opts.tiles === false ? (entries.length ? null : h('p', { class: 'muted' }, 'No numbers yet.')) : tiles.length ? h('div', { class: 'tiles' }, tiles) : h('p', { class: 'muted' }, 'No numbers yet.'),
      charts.length ? h('div', { class: 'charts' }, charts) : (entries.length ? h('p', { class: 'muted small' }, 'Charts appear once you have two entries for a number.') : null),
      form,
      entries.length ? h('details', { class: 'chart-table', open: entries.length <= 6 }, h('summary', {}, 'All entries (' + entries.length + ')'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'As of'), keys.map(k => h('th', { class: 'num' }, METRIC_LABELS[k])), h('th', {}, ''))), h('tbody', {}, rows))) : null);
  }
  draw();
  started = true;
  return box;
}
