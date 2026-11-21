// Shared UI kit: DOM helper, dialogs, toast, form widgets. All user text is rendered with textContent / properties,
// never innerHTML.
import * as io from './io.js';
import * as store from './store.js';
import { RELEASE_TYPES } from './model.js';

// ---------- tiny DOM helper ----------
// DOM replaceChildren turns null/false into the text "null"/"false"; skip them like h() does.
{
  const native = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return native.apply(this, kids.filter(k => k != null && k !== false)); };
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

export const $ = id => document.getElementById(id);
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const typeLabel = t => (RELEASE_TYPES.find(x => x[0] === t) || [t, cap(t)])[1];

// ---------- persisted UI state (filters) ----------
export const UI_KEY = 'annales.ui';
export const UI_DEFAULT = { artist: '', status: '', sort: 'edited', rArtist: '', rType: '', rSort: 'date', pView: 'month', pRelease: '', pStatus: '' };
export const getUi = () => { try { return { ...UI_DEFAULT, ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch { return { ...UI_DEFAULT }; } };
export const setUi = (k, v) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...getUi(), [k]: v })); } catch { /* ignore */ } };

// ---------- toast, banner, dialogs ----------
let toastTimer;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

export function showBanner(msg, label, fn) {
  const b = $('banner');
  b.replaceChildren(h('span', {}, msg), label ? h('button', { class: 'btn small', type: 'button', onclick: fn }, label) : null);
  b.hidden = false;
}

export function modal(title, body, buttons) {
  return new Promise(resolve => {
    const d = $('dlg');
    // A "close" event is dispatched asynchronously. If another modal has already opened by then, ignore it.
    const onClose = () => { if (!d.open) { d.replaceChildren(); resolve(undefined); } };
    d.addEventListener('close', onClose, { once: true });
    const finish = v => { d.removeEventListener('close', onClose); if (d.open) d.close(); d.replaceChildren(); resolve(v); };
    d.replaceChildren(
      h('h2', {}, title),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-actions' }, buttons.map(b =>
        h('button', { class: 'btn ' + (b.kind || ''), type: 'button', onclick: () => finish(b.value) }, b.label))),
    );
    d.showModal();
  });
}

export const info = (title, msg) => modal(title, [h('p', {}, msg)], [{ label: 'OK', value: true, kind: 'primary' }]);
export const confirmBox = async (title, msg, okLabel, danger) =>
  (await modal(title, [h('p', {}, msg)], [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }])) === true;

export function pickText(title, intro) {
  const picked = { text: '' };
  const status = h('p', { class: 'muted' }, '');
  const ta = h('textarea', { rows: 5, placeholder: '…or paste JSON here', oninput: () => { picked.text = ta.value; status.textContent = ''; } });
  const file = h('input', {
    type: 'file', accept: '.json,application/json,text/plain',
    onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > io.MAX_IMPORT_BYTES) { picked.text = ''; status.textContent = 'That file is too large.'; return; }
      picked.text = await f.text(); ta.value = '';
      status.textContent = '✓ ' + f.name + ' (' + Math.max(1, Math.ceil(f.size / 1024)) + ' KB)';
    },
  });
  return modal(title, [h('p', {}, intro), file, status, ta],
    [{ label: 'Cancel', value: false }, { label: 'Preview', value: true, kind: 'primary' }])
    .then(v => (v === true ? picked.text : null));
}

export const listPreview = (titles, max = 8) => h('ul', { class: 'plain' },
  titles.slice(0, max).map(t => h('li', {}, t || 'Untitled')),
  titles.length > max ? h('li', { class: 'muted' }, '+ ' + (titles.length - max) + ' more') : null);

// ---------- shared widgets ----------
export const pill = (status, label) => h('span', { class: 'pill s-' + status }, label || cap(status));

export function select(options, value, onChange, cls) {
  const el = h('select', { class: cls }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value;
  if (el.value !== value) { el.append(h('option', { value }, value)); el.value = value; }
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

export const field = (label, el, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el, hint || null);
export const hint = txt => h('small', { class: 'hint' }, txt);

export function textInput(rec, sn, prop, o = {}) {
  const el = h('input', {
    type: o.type || 'text', value: rec[prop] ?? '', placeholder: o.placeholder || '',
    autocomplete: 'off', ...(o.attrs || {}),
  });
  if (o.list) el.setAttribute('list', o.list);
  el.addEventListener('input', () => {
    rec[prop] = o.coerce ? o.coerce(el.value) : el.value;
    store.touch(sn, rec);
    if (o.after) o.after(el);
  });
  return el;
}

export function textArea(rec, sn, prop, rows = 4, placeholder = '') {
  const el = h('textarea', { rows, placeholder, value: rec[prop] || '' });
  el.addEventListener('input', () => { rec[prop] = el.value; store.touch(sn, rec); });
  return el;
}

export const datalist = (id, values) => h('datalist', { id }, values.map(v => h('option', { value: v })));
export const numOrNull = v => (v === '' ? null : Number(v));

export const notFound = (what, back) => h('div', { class: 'view' },
  h('p', {}, what + ' not found. It may have been deleted, or it lives on another device.'),
  h('a', { class: 'btn', href: back }, 'Back'));



// ---------- clipboard ----------
export async function copyText(text, label) {
  if (!text || !text.trim()) { toast('Nothing to copy yet.'); return false; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers or contexts where the async clipboard API is refused.
    const ta = h('textarea', { value: text, readOnly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0' });
    document.body.append(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    if (!ok) { toast('Copy failed. Press and hold the text to copy it.'); return false; }
  }
  toast(label + ' copied.');
  return true;
}

export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
