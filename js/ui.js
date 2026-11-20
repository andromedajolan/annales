// Views, editors and dialogs. All user text is rendered with textContent / properties, never innerHTML.
import * as store from './store.js';
import * as io from './io.js';
import * as stilus from './stilus.js';
import {
  SONG_STATUS, COPYRIGHT_STATES, RELEASE_TYPES, COVER_MAX_CHARS,
  fmtLength, parseLength, fmtDate, isIsrc, isUpc, safeHref,
} from './model.js';

let ctx = { version: '0.0.0' };
let swStatus = 'checking';

// ---------- tiny DOM helper ----------
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

const $ = id => document.getElementById(id);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const typeLabel = t => (RELEASE_TYPES.find(x => x[0] === t) || [t, cap(t)])[1];

// ---------- persisted UI state (filters) ----------
const UI_KEY = 'annales.ui';
const UI_DEFAULT = { artist: '', status: '', sort: 'edited', rArtist: '', rType: '', rSort: 'date' };
const getUi = () => { try { return { ...UI_DEFAULT, ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch { return { ...UI_DEFAULT }; } };
const setUi = (k, v) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...getUi(), [k]: v })); } catch { /* ignore */ } };

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

const info = (title, msg) => modal(title, [h('p', {}, msg)], [{ label: 'OK', value: true, kind: 'primary' }]);
const confirmBox = async (title, msg, okLabel, danger) =>
  (await modal(title, [h('p', {}, msg)], [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }])) === true;

function pickText(title, intro) {
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

const listPreview = (titles, max = 8) => h('ul', { class: 'plain' },
  titles.slice(0, max).map(t => h('li', {}, t || 'Untitled')),
  titles.length > max ? h('li', { class: 'muted' }, '+ ' + (titles.length - max) + ' more') : null);

// ---------- shell: tabs, save indicator, router ----------
const TABS = [['#/songs', 'Songs'], ['#/releases', 'Releases'], ['#/data', 'Data']];

export function init(c) {
  ctx = c;
  $('tabs').replaceChildren(...TABS.map(([href, label]) => h('a', { href }, label)));
  store.onSaveState(renderSaveState);
  window.addEventListener('hashchange', route);
  route();
}

export function setSwStatus(s) {
  swStatus = s;
  const el = $('swStatus');
  if (el) el.textContent = swLabel();
}
const swLabel = () => ({ ready: 'Ready to work offline ✓', checking: 'Setting up offline use…', unsupported: 'Offline use is not available in this browser.' }[swStatus] || swStatus);

function renderSaveState(state, when) {
  const el = $('saveState');
  el.dataset.state = state;
  el.textContent = state === 'saving' ? 'Saving…'
    : state === 'error' ? '⚠ Not saved'
    : when ? 'Saved ' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

const ROUTES = [
  [/^#\/songs\/([\w-]+)$/, songEditor],
  [/^#\/songs$/, songsView],
  [/^#\/releases\/([\w-]+)$/, releaseEditor],
  [/^#\/releases$/, releasesView],
  [/^#\/data$/, dataView],
];

export async function route() {
  await store.flushAll();
  const hash = location.hash || '#/songs';
  for (const [re, fn] of ROUTES) {
    const m = hash.match(re);
    if (!m) continue;
    const view = fn(...m.slice(1));
    $('app').replaceChildren(view);
    document.querySelectorAll('#tabs a').forEach(a => {
      if (hash.startsWith(a.getAttribute('href'))) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    return;
  }
  location.replace('#/songs');
}

const notFound = (what, back) => h('div', { class: 'view' },
  h('p', {}, what + ' not found. It may have been deleted, or it lives on another device.'),
  h('a', { class: 'btn', href: back }, 'Back'));

// ---------- shared widgets ----------
const pill = (status, label) => h('span', { class: 'pill s-' + status }, label || cap(status));

function select(options, value, onChange, cls) {
  const el = h('select', { class: cls }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value;
  if (el.value !== value) { el.append(h('option', { value }, value)); el.value = value; }
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

const field = (label, el, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el, hint || null);
const hint = txt => h('small', { class: 'hint' }, txt);

function textInput(rec, sn, prop, o = {}) {
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

function textArea(rec, sn, prop, rows = 4, placeholder = '') {
  const el = h('textarea', { rows, placeholder, value: rec[prop] || '' });
  el.addEventListener('input', () => { rec[prop] = el.value; store.touch(sn, rec); });
  return el;
}

const datalist = (id, values) => h('datalist', { id }, values.map(v => h('option', { value: v })));
const numOrNull = v => (v === '' ? null : Number(v));

// ---------- SONGS ----------
function songsView() {
  const ui = getUi();
  let q = '';
  const listEl = h('div', { class: 'list' });
  const count = h('p', { class: 'muted count' });

  const search = h('input', { type: 'search', placeholder: 'Search title, artist, release…', 'aria-label': 'Search songs', autocomplete: 'off', oninput: () => { q = search.value.trim().toLowerCase(); draw(); } });
  const artistSel = select([['', 'All artist names'], ...store.artistNames().map(a => [a, a])], ui.artist, v => { setUi('artist', v); draw(); });
  const statusSel = select([['', 'Any status'], ...SONG_STATUS.map(s => [s, cap(s)])], ui.status, v => { setUi('status', v); draw(); });
  const sortSel = select([['edited', 'Recently edited'], ['title', 'Title A–Z'], ['release', 'By release']], ui.sort, v => { setUi('sort', v); draw(); });

  function draw() {
    const cur = getUi();
    const all = Array.from(store.songs.values());
    let rows = all.filter(s => {
      if (cur.artist && s.artist !== cur.artist) return false;
      if (cur.status && s.status !== cur.status) return false;
      if (!q) return true;
      const rel = s.releaseId && store.releases.get(s.releaseId);
      return [s.title, s.artist, rel && rel.title, s.key].some(x => x && x.toLowerCase().includes(q));
    });
    const relTitle = s => (s.releaseId && store.releases.get(s.releaseId) ? store.releases.get(s.releaseId).title : '￿');
    rows.sort(cur.sort === 'title' ? (a, b) => (a.title || '~').localeCompare(b.title || '~')
      : cur.sort === 'release' ? (a, b) => relTitle(a).localeCompare(relTitle(b)) || (a.track ?? 9999) - (b.track ?? 9999)
      : (a, b) => b.updated.localeCompare(a.updated));
    count.textContent = all.length ? rows.length + ' of ' + all.length + ' song' + (all.length === 1 ? '' : 's') : '';
    listEl.replaceChildren(...(rows.length ? rows.map(songCard) : [
      h('div', { class: 'empty' },
        all.length ? h('p', {}, 'No songs match these filters.')
          : [h('p', {}, 'No songs yet.'), h('p', { class: 'muted' }, 'Add one, or import your songs from Stilus so you do not retype titles, keys and BPM.')]),
    ]));
  }

  const view = h('div', { class: 'view' },
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { const s = store.createSong(); location.hash = '#/songs/' + s.id; } }, '+ Add song'),
      h('button', { class: 'btn', type: 'button', onclick: importStilus }, 'Import from Stilus')),
    h('div', { class: 'filters' }, search, h('div', { class: 'filter-row' }, artistSel, statusSel, sortSel)),
    count, listEl);
  draw();
  return view;
}

function songCard(s) {
  const rel = s.releaseId && store.releases.get(s.releaseId);
  const bits = [
    s.artist,
    rel ? (rel.title || 'Untitled release') + (s.track ? ' · #' + s.track : '') : '',
    [s.key, s.mode].filter(Boolean).join(' '),
    s.bpm ? Math.round(s.bpm * 10) / 10 + ' bpm' : '',
    fmtLength(s.length),
  ].filter(Boolean);
  return h('a', { class: 'card', href: '#/songs/' + s.id },
    h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, s.title || 'Untitled'), h('div', { class: 'card-meta' }, bits.join(' · '))),
    pill(s.status));
}

function songEditor(id) {
  const rec = store.songs.get(id);
  if (!rec) return notFound('Song', '#/songs');

  const trackInput = textInput(rec, 'songs', 'track', { type: 'number', coerce: numOrNull, attrs: { min: 1, max: 999, step: 1, inputmode: 'numeric' } });
  const releaseOptions = [['', '— None —'], ...Array.from(store.releases.values())
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(r => [r.id, (r.title || 'Untitled') + ' (' + typeLabel(r.type) + ')'])];
  const releaseSel = select(releaseOptions, rec.releaseId || '', v => {
    rec.releaseId = v || null;
    rec.track = v ? (rec.track || store.nextTrack(v)) : null;
    trackInput.value = rec.track ?? '';
    store.touch('songs', rec);
  });

  const lenHint = hint('m:ss');
  const lenInput = h('input', { type: 'text', value: fmtLength(rec.length), placeholder: '3:42', autocomplete: 'off', inputmode: 'numeric' });
  lenInput.addEventListener('input', () => {
    const v = parseLength(lenInput.value);
    lenInput.classList.toggle('invalid', Number.isNaN(v));
    if (Number.isNaN(v)) return;
    rec.length = v; store.touch('songs', rec);
  });
  lenInput.addEventListener('blur', () => { if (!Number.isNaN(parseLength(lenInput.value))) lenInput.value = fmtLength(rec.length); });

  const isrcHint = hint(''), upcHint = hint('');
  const checkIds = () => {
    isrcHint.textContent = rec.isrc && !isIsrc(rec.isrc) ? 'Usually 12 characters, like USABC2600001.' : '';
    upcHint.textContent = rec.upc && !isUpc(rec.upc) ? 'Usually 12 or 13 digits.' : '';
  };
  const hasRights = rec.isrc || rec.upc || rec.copyright.status !== 'none' || rec.copyright.date;
  const copyDate = h('input', { type: 'date', value: rec.copyright.date || '' });
  copyDate.addEventListener('input', () => { rec.copyright.date = copyDate.value; store.touch('songs', rec); });
  const copySel = select(COPYRIGHT_STATES, rec.copyright.status, v => { rec.copyright.status = v; store.touch('songs', rec); });

  const view = h('div', { class: 'view editor' },
    h('a', { class: 'back', href: '#/songs' }, '← Songs'),
    datalist('dl-artists', store.artistNames()),
    datalist('dl-keys', ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']),
    h('input', { class: 'title-input', value: rec.title, placeholder: 'Untitled', 'aria-label': 'Song title', autocomplete: 'off', oninput: e => { rec.title = e.target.value; store.touch('songs', rec); } }),
    h('div', { class: 'grid' },
      field('Artist name', textInput(rec, 'songs', 'artist', { list: 'dl-artists' })),
      field('Status', select(SONG_STATUS.map(s => [s, cap(s)]), rec.status, v => { rec.status = v; store.touch('songs', rec); })),
      field('Album or single', releaseSel),
      field('Track no.', trackInput)),
    h('div', { class: 'grid' },
      field('Key', textInput(rec, 'songs', 'key', { list: 'dl-keys', placeholder: 'A' })),
      field('Mode', select([['', '—'], ['major', 'Major'], ['minor', 'Minor']], rec.mode, v => { rec.mode = v; store.touch('songs', rec); })),
      field('BPM', textInput(rec, 'songs', 'bpm', { type: 'number', coerce: numOrNull, attrs: { min: 20, max: 400, step: 'any', inputmode: 'decimal' } })),
      field('Time signature', textInput(rec, 'songs', 'timeSig', { placeholder: '4/4' })),
      field('Length', lenInput, lenHint),
      field('Release date', textInput(rec, 'songs', 'releaseDate', { type: 'date' }))),
    field('What this song is about (your words)', textArea(rec, 'songs', 'meaning', 5)),
    field('Notes', textArea(rec, 'songs', 'notes', 4)),
    h('details', { class: 'panel', open: !!hasRights },
      h('summary', {}, 'Rights & IDs'),
      h('div', { class: 'grid' },
        field('ISRC', textInput(rec, 'songs', 'isrc', { after: checkIds, placeholder: 'USABC2600001', attrs: { autocapitalize: 'characters' } }), isrcHint),
        field('UPC', textInput(rec, 'songs', 'upc', { after: checkIds, attrs: { inputmode: 'numeric' } }), upcHint),
        field('Copyright', copySel),
        field('Copyright date', copyDate))),
    rec.stilusId ? h('p', { class: 'muted small' }, 'Linked to Stilus song ' + rec.stilusId) : null,
    h('div', { class: 'actions end' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this song?', '“' + (rec.title || 'Untitled') + '” will be removed from the catalogue. This cannot be undone.', 'Delete', true))) return;
          await store.deleteSong(rec.id);
          location.hash = '#/songs';
        },
      }, 'Delete song')));
  checkIds();
  if (!rec.title) setTimeout(() => view.querySelector('.title-input').focus(), 0);
  return view;
}

async function importStilus() {
  const text = await pickText('Import from Stilus', 'Choose a Stilus backup or song file (.json), or paste it below. Songs you already imported are updated, not duplicated.');
  if (text === null) return;
  if (!text.trim()) { toast('Choose a file or paste something first.'); return; }
  const parsed = stilus.parseStilus(text);
  if (parsed.error) { await info('Could not import', parsed.error); return; }
  const plan = stilus.planStilus(parsed.mapped);
  const skipNote = parsed.skipped ? h('p', { class: 'muted' }, parsed.skipped + ' item(s) skipped (no id).') : null;
  if (!plan.added.length && !plan.updated.length) {
    await info('Nothing to import', plan.same.length ? 'All ' + plan.same.length + ' song(s) are already up to date.' : 'No importable songs were found.');
    return;
  }
  const body = [
    plan.added.length ? [h('p', {}, h('strong', {}, plan.added.length + ' new song(s)')), listPreview(plan.added.map(o => o.m.title))] : null,
    plan.updated.length ? [h('p', {}, h('strong', {}, plan.updated.length + ' to update')), listPreview(plan.updated.map(o => o.ex.title || o.m.title))] : null,
    plan.same.length ? h('p', { class: 'muted' }, plan.same.length + ' already up to date.') : null,
    plan.newReleases ? h('p', { class: 'muted' }, plan.newReleases + ' new release(s) will be created from the Stilus release names.') : null,
    skipNote,
  ];
  if ((await modal('Import from Stilus', body, [{ label: 'Cancel', value: false }, { label: 'Import', value: true, kind: 'primary' }])) !== true) return;
  await stilus.applyStilus(plan);
  toast('Imported ' + plan.added.length + ' new, updated ' + plan.updated.length + '.');
  route();
}

// ---------- RELEASES ----------
function releaseState(r) {
  return r.actualDate ? ['released', 'Released'] : r.plannedDate ? ['planned', 'Planned'] : ['draft', 'Draft'];
}

function coverBox(r, cls) {
  return r.cover ? h('img', { class: cls, src: r.cover.thumb, alt: '' }) : h('div', { class: cls + ' ph', 'aria-hidden': 'true' }, (r.title || '?').charAt(0).toUpperCase());
}

function releasesView() {
  const ui = getUi();
  const listEl = h('div', { class: 'list' });
  const count = h('p', { class: 'muted count' });
  const artistSel = select([['', 'All artist names'], ...store.artistNames().map(a => [a, a])], ui.rArtist, v => { setUi('rArtist', v); draw(); });
  const typeSel = select([['', 'All types'], ...RELEASE_TYPES], ui.rType, v => { setUi('rType', v); draw(); });
  const sortSel = select([['date', 'By date'], ['edited', 'Recently edited'], ['title', 'Title A–Z']], ui.rSort, v => { setUi('rSort', v); draw(); });

  function draw() {
    const cur = getUi();
    const all = Array.from(store.releases.values());
    const rows = all.filter(r => (!cur.rArtist || r.artist === cur.rArtist) && (!cur.rType || r.type === cur.rType));
    const date = r => r.actualDate || r.plannedDate || '';
    rows.sort(cur.rSort === 'title' ? (a, b) => (a.title || '~').localeCompare(b.title || '~')
      : cur.rSort === 'edited' ? (a, b) => b.updated.localeCompare(a.updated)
      : (a, b) => (date(b) || '0000').localeCompare(date(a) || '0000'));
    count.textContent = all.length ? rows.length + ' of ' + all.length + ' release' + (all.length === 1 ? '' : 's') : '';
    listEl.replaceChildren(...(rows.length ? rows.map(releaseCard) : [
      h('div', { class: 'empty' }, all.length ? h('p', {}, 'No releases match these filters.')
        : [h('p', {}, 'No releases yet.'), h('p', { class: 'muted' }, 'Add an album, single or pool, then attach songs to build its tracklist.')]),
    ]));
  }

  const view = h('div', { class: 'view' },
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { const r = store.createRelease(); location.hash = '#/releases/' + r.id; } }, '+ Add release')),
    h('div', { class: 'filters' }, h('div', { class: 'filter-row' }, artistSel, typeSel, sortSel)),
    count, listEl);
  draw();
  return view;
}

function releaseCard(r) {
  const [state, label] = releaseState(r);
  const n = store.releaseSongs(r.id).length;
  const when = r.actualDate ? fmtDate(r.actualDate) : r.plannedDate ? 'Planned ' + fmtDate(r.plannedDate) : '';
  return h('a', { class: 'card', href: '#/releases/' + r.id },
    coverBox(r, 'cover-sm'),
    h('div', { class: 'card-main' },
      h('div', { class: 'card-title' }, r.title || 'Untitled'),
      h('div', { class: 'card-meta' }, [typeLabel(r.type), r.artist, when, n + ' track' + (n === 1 ? '' : 's')].filter(Boolean).join(' · '))),
    pill(state, label));
}

async function makeThumb(file) {
  let src, w, hh;
  try { src = await createImageBitmap(file); w = src.width; hh = src.height; }
  catch {
    src = await new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(u); res(img); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read that image.')); };
      img.src = u;
    });
    w = src.naturalWidth; hh = src.naturalHeight;
  }
  const k = Math.min(1, 320 / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
  const g = c.getContext('2d');
  g.fillStyle = '#111216'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  let q = 0.82, url = c.toDataURL('image/jpeg', q);
  while (url.length > COVER_MAX_CHARS && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
  if (url.length > COVER_MAX_CHARS) throw new Error('That image is too detailed to shrink.');
  return url;
}

function releaseEditor(id) {
  const rec = store.releases.get(id);
  if (!rec) return notFound('Release', '#/releases');
  const save = () => store.touch('releases', rec);

  // cover
  const coverHolder = h('div', { class: 'cover-holder' });
  const coverName = h('input', { type: 'text', placeholder: 'e.g. cover-final-3000.png', value: rec.cover ? rec.cover.name : '', autocomplete: 'off' });
  coverName.addEventListener('input', () => { if (rec.cover) { rec.cover.name = coverName.value; save(); } });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const thumb = await makeThumb(f);
      rec.cover = { thumb, name: rec.cover && rec.cover.name ? rec.cover.name : f.name };
      coverName.value = rec.cover.name;
      save(); drawCover();
    } catch (e) { toast(e.message || 'Could not use that image.'); }
  });
  function drawCover() {
    coverHolder.replaceChildren(
      coverBox(rec, 'cover-lg'),
      h('div', { class: 'cover-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, rec.cover ? 'Change cover' : 'Choose cover image'),
        rec.cover ? h('button', { class: 'btn', type: 'button', onclick: () => { rec.cover = null; coverName.value = ''; save(); drawCover(); } }, 'Remove') : null,
        h('small', { class: 'hint' }, 'Only a small thumbnail (max 320 px) is kept here. Your full-size file stays where it is.')));
  }
  drawCover();

  // links
  const linksEl = h('div', { class: 'links' });
  function drawLinks() {
    linksEl.replaceChildren(...rec.links.map((l, i) => {
      const plat = h('input', { type: 'text', value: l.platform, placeholder: 'Platform', autocomplete: 'off', 'aria-label': 'Platform' });
      plat.setAttribute('list', 'dl-platforms');
      plat.addEventListener('input', () => { l.platform = plat.value; save(); });
      const url = h('input', { type: 'url', value: l.url, placeholder: 'https://…', autocomplete: 'off', 'aria-label': 'Link', inputmode: 'url' });
      const open = h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer' }, 'Open');
      const syncOpen = () => { const href = safeHref(l.url); open.hidden = !href; if (href) open.href = href; };
      url.addEventListener('input', () => { l.url = url.value; syncOpen(); save(); });
      syncOpen();
      return h('div', { class: 'link-row' }, plat, url, open,
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove link', onclick: () => { rec.links.splice(i, 1); save(); drawLinks(); } }, '×'));
    }));
  }
  drawLinks();

  // tracklist
  const tracksEl = h('div', { class: 'tracks' });
  const addSel = h('select', { 'aria-label': 'Song to add' });
  function drawTracks() {
    const list = store.releaseSongs(rec.id);
    tracksEl.replaceChildren(...(list.length ? list.map((s, i) => h('div', { class: 'track-row' },
      h('span', { class: 'track-no' }, String(i + 1)),
      h('a', { class: 'track-title', href: '#/songs/' + s.id }, s.title || 'Untitled'),
      h('span', { class: 'muted small' }, [[s.key, s.mode].filter(Boolean).join(' '), fmtLength(s.length)].filter(Boolean).join(' · ')),
      h('button', { class: 'btn small', type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: () => moveTrack(list, i, -1) }, '↑'),
      h('button', { class: 'btn small', type: 'button', disabled: i === list.length - 1, 'aria-label': 'Move down', onclick: () => moveTrack(list, i, 1) }, '↓'),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove from release', onclick: () => { s.releaseId = null; s.track = null; store.touch('songs', s); renumber(); drawTracks(); } }, '×')))
      : [h('p', { class: 'muted' }, 'No songs on this release yet.')]));
    const candidates = Array.from(store.songs.values()).filter(s => s.releaseId !== rec.id).sort((a, b) => a.title.localeCompare(b.title));
    addSel.replaceChildren(h('option', { value: '' }, candidates.length ? 'Add a song…' : 'No other songs to add'),
      ...candidates.map(s => {
        const on = s.releaseId && store.releases.get(s.releaseId);
        return h('option', { value: s.id }, (s.title || 'Untitled') + (on ? ' (on ' + (on.title || 'Untitled') + ')' : ''));
      }));
  }
  function renumber() {
    store.releaseSongs(rec.id).forEach((s, i) => { if (s.track !== i + 1) { s.track = i + 1; store.touch('songs', s); } });
  }
  function moveTrack(list, i, d) {
    const j = i + d;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((s, n) => { if (s.track !== n + 1) { s.track = n + 1; store.touch('songs', s); } });
    drawTracks();
  }
  addSel.addEventListener('change', () => {
    const s = store.songs.get(addSel.value);
    if (!s) return;
    s.releaseId = rec.id; s.track = store.nextTrack(rec.id);
    store.touch('songs', s);
    drawTracks();
  });
  drawTracks();

  return h('div', { class: 'view editor' },
    h('a', { class: 'back', href: '#/releases' }, '← Releases'),
    datalist('dl-artists', store.artistNames()),
    datalist('dl-platforms', ['Spotify', 'Apple Music', 'YouTube Music', 'Amazon Music', 'Bandcamp', 'SoundCloud', 'Tidal', 'Deezer', 'Pre-save']),
    datalist('dl-distributors', ['DistroKid', 'TuneCore', 'CD Baby', 'Amuse', 'UnitedMasters', 'Ditto', 'RouteNote']),
    h('input', { class: 'title-input', value: rec.title, placeholder: 'Untitled release', 'aria-label': 'Release title', autocomplete: 'off', oninput: e => { rec.title = e.target.value; save(); } }),
    h('div', { class: 'cover-row' }, coverHolder, field('Cover file name', coverName), fileIn),
    h('div', { class: 'grid' },
      field('Type', select(RELEASE_TYPES, rec.type, v => { rec.type = v; save(); })),
      field('Artist name', textInput(rec, 'releases', 'artist', { list: 'dl-artists' })),
      field('Planned date', textInput(rec, 'releases', 'plannedDate', { type: 'date' })),
      field('Actual date', textInput(rec, 'releases', 'actualDate', { type: 'date' })),
      field('Distributor', textInput(rec, 'releases', 'distributor', { list: 'dl-distributors' })),
      field('UPC', textInput(rec, 'releases', 'upc', { attrs: { inputmode: 'numeric' } }))),
    h('section', { class: 'panel' }, h('h3', {}, 'Tracklist'), tracksEl, h('div', { class: 'actions' }, addSel)),
    h('section', { class: 'panel' }, h('h3', {}, 'Platform links'), linksEl,
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { rec.links.push({ platform: '', url: '' }); save(); drawLinks(); } }, '+ Add link'))),
    field('Notes', textArea(rec, 'releases', 'notes', 4)),
    h('div', { class: 'actions end' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this release?', '“' + (rec.title || 'Untitled') + '” will be removed. Its songs stay in your catalogue; they just lose this release.', 'Delete', true))) return;
          await store.deleteRelease(rec.id);
          location.hash = '#/releases';
        },
      }, 'Delete release')));
}

// ---------- DATA ----------
function dataView() {
  const counts = store.songs.size + ' song' + (store.songs.size === 1 ? '' : 's') + ', ' + store.releases.size + ' release' + (store.releases.size === 1 ? '' : 's');
  const last = io.lastBackup();
  const backupLine = h('p', { class: 'muted' }, last ? 'Last backup: ' + new Date(last).toLocaleString() : 'You have not made a backup on this device yet.');
  const persistLine = h('p', { class: 'muted' }, 'Checking storage…');
  const settings = store.getSettings();

  async function refreshStorage() {
    try {
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const used = est && est.usage != null ? (est.usage > 1048576 ? (est.usage / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(est.usage / 1024)) + ' KB') + ' used. ' : '';
      persistLine.textContent = used + (persisted ? 'The browser has agreed to keep this data.' : 'The browser may clear this data if the device runs low on space. Export a backup now and then.');
    } catch { persistLine.textContent = ''; }
  }
  refreshStorage();

  const themeSel = select([['dark', 'Black'], ['gray', 'Gray'], ['light', 'Light']], document.documentElement.dataset.theme || 'dark', v => {
    try { localStorage.setItem('studio.theme', v); } catch { /* ignore */ }
    document.documentElement.dataset.theme = v;
    ctx.applyTheme && ctx.applyTheme();
  });

  return h('div', { class: 'view' },
    h('section', { class: 'panel' },
      h('h3', {}, 'Back up and move'),
      h('p', {}, 'Your catalogue lives on this device only (' + counts + '). Export it to back it up or to move it between your phone and Chromebook; there is no sync yet.'),
      backupLine,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { io.downloadBackup(); backupLine.textContent = 'Last backup: ' + new Date().toLocaleString(); toast('Backup downloaded.'); } }, 'Export catalogue'),
        h('button', { class: 'btn', type: 'button', onclick: importBackup }, 'Import backup'))),
    h('section', { class: 'panel' },
      h('h3', {}, 'Settings'),
      h('div', { class: 'grid' },
        field('Default artist name for new songs', h('input', { type: 'text', value: settings.defaultArtist, autocomplete: 'off', oninput: e => store.setSetting('defaultArtist', e.target.value.trim()) })),
        field('Theme (shared with the other apps)', themeSel))),
    h('section', { class: 'panel' },
      h('h3', {}, 'This device'),
      persistLine,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { const ok = await store.requestPersist(); toast(ok ? 'The browser will keep your data.' : 'The browser did not grant it. Keep a backup.'); refreshStorage(); } }, 'Ask the browser to keep my data')),
      h('p', { class: 'muted', id: 'swStatus' }, swLabel()),
      h('p', { class: 'muted small' }, 'Annales ' + ctx.version)));
}

async function importBackup() {
  const text = await pickText('Import backup', 'Choose an Annales backup (.json) exported from another device, or paste it below.');
  if (text === null) return;
  if (!text.trim()) { toast('Choose a file or paste a backup first.'); return; }
  const parsed = io.parseBackup(text);
  if (parsed.error) { await info('Could not import', parsed.error); return; }
  let mode = 'merge';
  const out = h('div', {});
  const draw = () => {
    const p = io.planBackup(parsed, mode);
    out.replaceChildren(
      h('p', {}, mode === 'merge'
        ? 'Adds ' + p.addedSongs + ' song(s) and ' + p.addedReleases + ' release(s); updates ' + p.updatedSongs + ' and ' + p.updatedReleases + ' that are newer in the backup. Nothing is deleted.'
        : 'Replaces your whole catalogue with the backup (' + p.songs.length + ' songs, ' + p.releases.length + ' releases). This removes ' + p.removedSongs + ' song(s) and ' + p.removedReleases + ' release(s) that are not in it.'),
      mode === 'replace' ? h('p', { class: 'warn' }, 'Export your current catalogue first if you might want it back.') : null,
      parsed.dropped ? h('p', { class: 'muted' }, parsed.dropped + ' invalid record(s) in the file were ignored.') : null);
  };
  const radio = (value, label) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'imode', value, checked: value === mode, onchange: () => { mode = value; draw(); } }), label);
  draw();
  if ((await modal('Import backup', [
    h('p', {}, 'Backup contains ' + parsed.songs.length + ' song(s) and ' + parsed.releases.length + ' release(s).'),
    radio('merge', 'Merge into what I have (recommended)'), radio('replace', 'Replace everything'), out,
  ], [{ label: 'Cancel', value: false }, { label: 'Import', value: true, kind: 'primary' }])) !== true) return;
  const plan = io.planBackup(parsed, mode);
  await io.applyBackup(plan, mode);
  toast('Backup imported.');
  route();
}
