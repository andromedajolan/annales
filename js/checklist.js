// Stage 2: release checklist, reusable templates, and "coming up" reminders (shown in the app; no notifications).
import * as store from './store.js';
import { h, toast, modal, confirmBox, notFound, plural } from './kit.js';
import { newId, todayStr, addDays, dayDiff, fmtDateShort } from './model.js';

// ---- due-date labels ----
export function dueInfo(item) {
  if (item.done || !item.due) return null;
  const d = dayDiff(todayStr(), item.due);
  if (d < 0) return { cls: 'overdue', text: d === -1 ? 'Overdue 1 day' : 'Overdue ' + -d + ' days' };
  if (d === 0) return { cls: 'soon', text: 'Due today' };
  if (d <= 7) return { cls: 'soon', text: d === 1 ? 'Due tomorrow' : 'Due in ' + d + ' days' };
  return null;
}

export function checklistProgress(rec) {
  const total = rec.checklist.length, done = rec.checklist.filter(i => i.done).length;
  const overdue = rec.checklist.filter(i => { const x = dueInfo(i); return x && x.cls === 'overdue'; }).length;
  return { total, done, overdue };
}

// ---- checklist panel (inside the release editor) ----
export function checklistPanel(rec) {
  const save = () => store.touch('releases', rec);
  const list = h('div', { class: 'checklist' });
  const progress = h('small', { class: 'hint' });
  const tplSel = h('select', { 'aria-label': 'Template' });

  const refreshProgress = () => {
    const p = checklistProgress(rec);
    progress.textContent = p.total ? p.done + ' of ' + p.total + ' done' + (p.overdue ? ' · ' + p.overdue + ' overdue' : '') : 'No items yet.';
  };

  function row(item, i) {
    const cb = h('input', { type: 'checkbox', checked: item.done, 'aria-label': 'Done: ' + item.text });
    const text = h('input', { type: 'text', value: item.text, placeholder: 'Checklist item', autocomplete: 'off', 'aria-label': 'Item' });
    const due = h('input', { type: 'date', value: item.due, 'aria-label': 'Due date' });
    const badge = h('span', { class: 'due' });
    const rowEl = h('div', { class: 'chk-row' });
    const paint = () => {
      const x = dueInfo(item);
      badge.textContent = x ? x.text : '';
      badge.className = 'due' + (x ? ' ' + x.cls : '');
      rowEl.classList.toggle('done', item.done);
      refreshProgress();
    };
    cb.addEventListener('change', () => { item.done = cb.checked; save(); paint(); });
    text.addEventListener('input', () => { item.text = text.value; save(); });
    due.addEventListener('input', () => { item.due = due.value; save(); paint(); });
    const move = d => () => {
      const j = i + d;
      [rec.checklist[i], rec.checklist[j]] = [rec.checklist[j], rec.checklist[i]];
      save(); draw();
    };
    rowEl.append(
      cb, text,
      h('div', { class: 'chk-meta' }, due, badge),
      h('div', { class: 'chk-actions' },
        h('button', { class: 'btn small', type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
        h('button', { class: 'btn small', type: 'button', disabled: i === rec.checklist.length - 1, 'aria-label': 'Move down', onclick: move(1) }, '↓'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove item', onclick: () => { rec.checklist.splice(i, 1); save(); draw(); } }, '×')));
    paint();
    return rowEl;
  }

  function draw() {
    list.replaceChildren(...(rec.checklist.length ? rec.checklist.map(row) : [h('p', { class: 'muted' }, 'Nothing on the checklist yet. Add items below or apply a template.')]));
    refreshProgress();
    const tpls = Array.from(store.templates.values()).sort((a, b) => a.name.localeCompare(b.name));
    tplSel.replaceChildren(h('option', { value: '' }, tpls.length ? 'Choose a template…' : 'No templates yet'),
      ...tpls.map(t => h('option', { value: t.id }, (t.name || 'Untitled') + ' (' + plural(t.items.length, 'item') + ')')));
  }

  const newText = h('input', { type: 'text', placeholder: 'Add an item…', autocomplete: 'off', 'aria-label': 'New item' });
  const addItem = () => {
    const t = newText.value.trim();
    if (!t) return;
    rec.checklist.push({ id: newId('chk'), text: t, done: false, due: '' });
    newText.value = ''; save(); draw(); newText.focus();
  };
  newText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

  const applyTemplate = () => {
    const t = store.templates.get(tplSel.value);
    if (!t) { toast('Choose a template first.'); return; }
    const base = store.releaseDate(rec);
    const have = new Set(rec.checklist.map(i => i.text.trim().toLowerCase()));
    let added = 0;
    for (const it of t.items) {
      if (!it.text || have.has(it.text.trim().toLowerCase())) continue;
      rec.checklist.push({ id: newId('chk'), text: it.text, done: false, due: base && it.offset != null ? addDays(base, it.offset) : '' });
      added++;
    }
    save(); draw();
    toast(added ? 'Added ' + plural(added, 'item') + '.' + (base ? '' : ' Set a planned date on the release to fill in due dates.') : 'Those items are already on the checklist.');
  };

  const saveAsTemplate = async () => {
    if (!rec.checklist.length) { toast('Add some items first.'); return; }
    const name = h('input', { type: 'text', value: '', placeholder: 'Template name', autocomplete: 'off' });
    const v = await modal('Save as template', [
      h('p', {}, 'Saves these ' + plural(rec.checklist.length, 'item') + ' (without ticks). Due dates are kept as days before or after the release date when the release has a date.'),
      name,
    ], [{ label: 'Cancel', value: false }, { label: 'Save', value: true, kind: 'primary' }]);
    if (v !== true || !name.value.trim()) return;
    const base = store.releaseDate(rec);
    store.createTemplate({
      name: name.value.trim(),
      items: rec.checklist.map(i => ({ id: newId('itm'), text: i.text, offset: base && i.due ? dayDiff(base, i.due) : null })),
    });
    draw();
    toast('Template saved.');
  };

  draw();
  return h('section', { class: 'panel' },
    h('h3', {}, 'Release checklist'),
    progress, list,
    h('div', { class: 'add-row' }, newText, h('button', { class: 'btn', type: 'button', onclick: addItem }, 'Add')),
    h('div', { class: 'add-row' }, tplSel, h('button', { class: 'btn', type: 'button', onclick: applyTemplate }, 'Apply template')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: saveAsTemplate }, 'Save as template'),
      h('a', { class: 'btn', href: '#/templates' }, 'Manage templates')));
}

// ---- "coming up" reminders (top of the Releases tab) ----
export function comingUpPanel() {
  const due = store.dueItems(7);
  if (!due.length) return null;
  const rows = due.slice(0, 10).map(({ release, item }) => {
    const x = dueInfo(item);
    return h('a', { class: 'coming-row', href: '#/releases/' + release.id },
      h('span', { class: 'coming-text' }, h('strong', {}, item.text || 'Untitled item'), h('span', { class: 'muted' }, ' · ' + (release.title || 'Untitled release'))),
      h('span', { class: 'due ' + (x ? x.cls : '') }, x ? x.text : fmtDateShort(item.due)));
  });
  return h('section', { class: 'panel' },
    h('h3', {}, 'Coming up'),
    ...rows,
    due.length > 10 ? h('p', { class: 'muted small' }, '+ ' + (due.length - 10) + ' more') : null);
}

// ---- templates ----
export function templatesView() {
  const list = h('div', { class: 'list' });
  const draw = () => {
    const tpls = Array.from(store.templates.values()).sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...(tpls.length ? tpls.map(t =>
      h('a', { class: 'card', href: '#/templates/' + t.id },
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, t.name || 'Untitled'), h('div', { class: 'card-meta' }, plural(t.items.length, 'item')))))
      : [h('div', { class: 'empty' }, h('p', {}, 'No templates yet.'), h('p', { class: 'muted' }, 'Create one, or build a checklist on a release and choose Save as template.'))]));
  };
  draw();
  return h('div', { class: 'view' },
    h('a', { class: 'back', href: '#/releases' }, '← Releases'),
    h('h2', { class: 'page-title' }, 'Checklist templates'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { const t = store.createTemplate(); location.hash = '#/templates/' + t.id; } }, '+ New template')),
    list);
}

export function templateEditor(id) {
  const rec = store.templates.get(id);
  if (!rec) return notFound('Template', '#/templates');
  const save = () => store.touch('templates', rec);
  const list = h('div', { class: 'checklist' });

  function row(item, i) {
    const text = h('input', { type: 'text', value: item.text, placeholder: 'Checklist item', autocomplete: 'off', 'aria-label': 'Item' });
    text.addEventListener('input', () => { item.text = text.value; save(); });
    const off = h('input', { type: 'number', value: item.offset ?? '', placeholder: 'e.g. -14', step: 1, min: -730, max: 730, 'aria-label': 'Days from release' });
    off.setAttribute('inputmode', 'numeric');
    off.addEventListener('input', () => { item.offset = off.value === '' ? null : Math.round(Number(off.value)); save(); });
    const move = d => () => { const j = i + d;[rec.items[i], rec.items[j]] = [rec.items[j], rec.items[i]]; save(); draw(); };
    return h('div', { class: 'chk-row tpl' }, h('span', { class: 'track-no' }, String(i + 1)), text,
      h('div', { class: 'chk-meta' }, off, h('small', { class: 'muted' }, 'days from release')),
      h('div', { class: 'chk-actions' },
        h('button', { class: 'btn small', type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
        h('button', { class: 'btn small', type: 'button', disabled: i === rec.items.length - 1, 'aria-label': 'Move down', onclick: move(1) }, '↓'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove item', onclick: () => { rec.items.splice(i, 1); save(); draw(); } }, '×')));
  }
  const draw = () => list.replaceChildren(...(rec.items.length ? rec.items.map(row) : [h('p', { class: 'muted' }, 'No items yet.')]));
  draw();

  const newText = h('input', { type: 'text', placeholder: 'Add an item…', autocomplete: 'off', 'aria-label': 'New item' });
  const addItem = () => {
    const t = newText.value.trim();
    if (!t) return;
    rec.items.push({ id: newId('itm'), text: t, offset: null });
    newText.value = ''; save(); draw(); newText.focus();
  };
  newText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

  return h('div', { class: 'view editor' },
    h('a', { class: 'back', href: '#/templates' }, '← Templates'),
    h('input', { class: 'title-input', value: rec.name, placeholder: 'Template name', 'aria-label': 'Template name', autocomplete: 'off', oninput: e => { rec.name = e.target.value; save(); } }),
    h('p', { class: 'muted' }, 'Days from release: -14 means two weeks before the release date, 0 is release day, 1 is the day after. Leave blank for no due date.'),
    h('section', { class: 'panel' }, list,
      h('div', { class: 'add-row' }, newText, h('button', { class: 'btn', type: 'button', onclick: addItem }, 'Add'))),
    h('div', { class: 'actions end' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this template?', '“' + (rec.name || 'Untitled') + '” will be removed. Checklists already on releases are not affected.', 'Delete', true))) return;
          await store.deleteSimple('templates', rec.id);
          location.hash = '#/templates';
        },
      }, 'Delete template')));
}
