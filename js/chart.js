// Dependency-free charts for Annales (stage 4). Specs follow the dataviz skill: one series per chart (small multiples,
// so no legend box), 2px line, 8px+ markers with a 2px surface ring, hairline recessive grid, endpoint label only,
// crosshair + tooltip that also work from the keyboard, and a table view so no value is gated behind hover.
import { h } from './kit.js';
import { dayDiff, fmtDateShort, fmtDate } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  kids.forEach(k => { if (k != null) el.append(k); });
  return el;
}

export const fmtNum = n => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '');

function niceTicks(min, max, target = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

// One style per axis: full numbers under 10,000, compact (K / M) once the axis reaches it.
function axisFormatter(max) {
  if (max < 10000) return v => Math.round(v).toLocaleString();
  return v => {
    const a = Math.abs(v);
    if (a >= 1e6) return +(v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return +(v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  };
}

// points: [{ date: 'YYYY-MM-DD', value: number }] oldest first, at least 2.
export function lineChart({ title, points, label }) {
  const W = 320, H = 168, M = { l: 44, r: 20, t: 18, b: 26 };
  const values = points.map(p => p.value);
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const fmtAxis = axisFormatter(hi);
  const first = points[0].date, last = points[points.length - 1].date;
  const span = Math.max(1, dayDiff(first, last));
  const X = d => M.l + (dayDiff(first, d) / span) * (W - M.l - M.r);
  const Y = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  const xy = points.map(p => [X(p.date), Y(p.value)]);

  const grid = svgEl('g', { class: 'chart-grid' });
  for (const t of ticks) {
    grid.append(svgEl('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t) }));
    const tx = svgEl('text', { x: M.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'chart-axis' });
    tx.textContent = fmtAxis(t);
    grid.append(tx);
  }
  const xLabel = (x, anchor, text) => { const t = svgEl('text', { x, y: H - 8, 'text-anchor': anchor, class: 'chart-axis' }); t.textContent = text; return t; };
  grid.append(xLabel(M.l, 'start', fmtDateShort(first)), xLabel(W - M.r, 'end', fmtDateShort(last)));

  const line = svgEl('polyline', { class: 'chart-line', points: xy.map(p => p.join(',')).join(' ') });
  const dots = points.length <= 12 ? xy.map(([x, y]) => svgEl('circle', { class: 'chart-dot', cx: x, cy: y, r: 4 })) : [];
  const [ex, ey] = xy[xy.length - 1];
  const endDot = svgEl('circle', { class: 'chart-dot', cx: ex, cy: ey, r: 4.5 });
  const endLabel = svgEl('text', { x: ex, y: Math.max(11, ey - 10), 'text-anchor': 'end', class: 'chart-value' });
  endLabel.textContent = fmtNum(values[values.length - 1]);
  const cross = svgEl('line', { class: 'chart-cross', y1: M.t, y2: H - M.b, x1: 0, x2: 0, visibility: 'hidden' });
  const active = svgEl('circle', { class: 'chart-dot active', r: 5.5, cx: 0, cy: 0, visibility: 'hidden' });
  const overlay = svgEl('rect', { x: M.l - 8, y: 0, width: W - M.l - M.r + 16, height: H, fill: 'transparent' });

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label || title }, grid, line, ...dots, endDot, endLabel, cross, active, overlay);

  const tip = h('div', { class: 'chart-tip', hidden: true, 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'chart-wrap', tabindex: 0, role: 'group', 'aria-label': (label || title) + ': ' + points.length + ' entries. Use the left and right arrow keys to read each one.' }, svg, tip);
  const live = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  wrap.append(live);

  let current = -1;
  function show(i) {
    i = Math.max(0, Math.min(points.length - 1, i));
    current = i;
    const [x, y] = xy[i], p = points[i], prev = points[i - 1];
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    active.setAttribute('cx', x); active.setAttribute('cy', y); active.setAttribute('visibility', 'visible');
    const delta = prev ? p.value - prev.value : null;
    const strong = h('strong', {}, fmtNum(p.value));
    const when = h('span', {}, fmtDate(p.date));
    tip.replaceChildren(strong, when, delta != null ? h('span', { class: 'muted' }, (delta >= 0 ? '+' : '') + fmtNum(delta) + ' since ' + fmtDateShort(prev.date)) : null);
    tip.hidden = false;
    const scale = wrap.clientWidth / W, w = tip.offsetWidth;
    tip.style.left = Math.max(w / 2, Math.min(wrap.clientWidth - w / 2, x * scale)) + 'px';
    live.textContent = fmtDate(p.date) + ': ' + fmtNum(p.value) + (delta != null ? ', ' + (delta >= 0 ? '+' : '') + fmtNum(delta) : '');
  }
  function hide() {
    current = -1;
    cross.setAttribute('visibility', 'hidden'); active.setAttribute('visibility', 'hidden'); tip.hidden = true;
  }
  const nearest = e => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    xy.forEach(([x], i) => { const d = Math.abs(x - vx); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  overlay.addEventListener('pointermove', e => show(nearest(e)));
  overlay.addEventListener('pointerdown', e => show(nearest(e)));
  wrap.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && document.activeElement !== wrap) hide(); });
  wrap.addEventListener('focus', () => show(points.length - 1));
  wrap.addEventListener('blur', hide);
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show((current < 0 ? points.length : current) - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(points.length - 1); }
    else if (e.key === 'Escape') hide();
  });

  const rows = points.map((p, i) => h('tr', {}, h('td', {}, fmtDate(p.date)), h('td', { class: 'num' }, fmtNum(p.value)),
    h('td', { class: 'num muted' }, i ? (p.value - points[i - 1].value >= 0 ? '+' : '') + fmtNum(p.value - points[i - 1].value) : '')));
  const table = h('details', { class: 'chart-table' }, h('summary', {}, 'Table'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'num' }, title), h('th', { class: 'num' }, 'Change'))), h('tbody', {}, rows)));

  return h('figure', { class: 'chart-card' }, h('figcaption', {}, h('strong', {}, title), h('span', { class: 'muted small' }, fmtDateShort(first) + ' to ' + fmtDateShort(last))), wrap, table);
}

// Ranked horizontal bars, one hue, value at the tip. items: [{ label, href?, value }]
export function rankedBars(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return h('div', { class: 'bars' }, items.slice().sort((a, b) => b.value - a.value).map(i =>
    h('div', { class: 'bar-row' },
      i.href ? h('a', { class: 'bar-label', href: i.href }, i.label) : h('span', { class: 'bar-label' }, i.label),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: 'width:' + Math.max(1, (i.value / max) * 100) + '%', title: i.label + ': ' + fmtNum(i.value) })),
      h('span', { class: 'bar-value' }, fmtNum(i.value)))));
}
