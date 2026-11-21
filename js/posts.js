// Stage 3: promo planner (month grid or list) and the caption tool.
// One caption per post (pasted across Instagram, Facebook and Threads), separate on-screen video text.
import * as store from './store.js';
import { lyricsPicker } from './lyrics.js';
import { h, toast, modal, confirmBox, notFound, getUi, setUi, select, field, pill, plural, cap, copyText } from './kit.js';
import { POST_STATUS, todayStr, addDays, weekdayOf, fmtDayLong, fmtMonth, monthGrid } from './model.js';
import { metricPanel } from './metrics.js';

export function postLabel(p) {
  const song = p.songId && store.songs.get(p.songId);
  if (song && song.title) return song.title;
  const first = (p.caption || '').trim().split('\n')[0];
  return first ? (first.length > 48 ? first.slice(0, 47) + '…' : first) : 'Untitled post';
}

export function copyButtons(p, big) {
  const cls = big ? ' big' : '';
  return [
    h('button', { class: 'btn' + cls + (big ? ' primary' : ''), type: 'button', onclick: () => copyText(p.caption, 'Caption') }, 'Copy caption'),
    (big || (p.onScreenText || '').trim())
      ? h('button', { class: 'btn' + cls, type: 'button', onclick: () => copyText(p.onScreenText, 'On-screen text') }, 'Copy on-screen text') : null,
  ];
}

export function postCard(p) {
  const rel = p.releaseId && store.releases.get(p.releaseId);
  const snippet = (p.caption || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  return h('div', { class: 'post-card' },
    h('a', { class: 'post-main', href: '#/posts/' + p.id },
      h('div', { class: 'post-head' }, h('span', { class: 'card-title' }, postLabel(p)), pill(p.status)),
      h('div', { class: 'card-meta' }, [rel ? (rel.title || 'Untitled release') : '', p.postDate ? fmtDayLong(p.postDate) : 'No date'].filter(Boolean).join(' · ')),
      snippet ? h('div', { class: 'snippet' }, snippet) : h('div', { class: 'snippet muted' }, 'No caption yet')),
    h('div', { class: 'post-actions' }, copyButtons(p, false)));
}

// ---------- posts tab ----------
export function postsView() {
  const ui = () => getUi();
  const now = new Date();
  let cursor = { y: now.getFullYear(), m: now.getMonth() };
  let selected = todayStr();

  const body = h('div', { class: 'post-body' });
  const matches = p => (!ui().pRelease || p.releaseId === ui().pRelease) && (!ui().pStatus || p.status === ui().pStatus);

  const relOptions = () => [['', 'All releases'],
    ...Array.from(store.releases.values()).sort((a, b) => a.title.localeCompare(b.title)).map(r => [r.id, r.title || 'Untitled release'])];
  const relSel = select(relOptions(), ui().pRelease, v => { setUi('pRelease', v); draw(); });
  const statusSel = select([['', 'Any status'], ...POST_STATUS.map(s => [s, cap(s)])], ui().pStatus, v => { setUi('pStatus', v); draw(); });
  const btnMonth = h('button', { class: 'seg-btn', type: 'button', onclick: () => { setUi('pView', 'month'); draw(); } }, 'Month');
  const btnList = h('button', { class: 'seg-btn', type: 'button', onclick: () => { setUi('pView', 'list'); draw(); } }, 'List');

  const addPost = date => {
    const p = store.createPost({ releaseId: ui().pRelease || null, postDate: date || '' });
    location.hash = '#/posts/' + p.id;
  };

  function todayStrip() {
    const t = todayStr();
    const due = Array.from(store.posts.values()).filter(p => p.postDate === t && p.status !== 'posted');
    if (!due.length) return null;
    return h('div', { class: 'notice' },
      h('span', {}, 'Today: ' + plural(due.length, 'post') + ' to publish.'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { selected = t; cursor = { y: now.getFullYear(), m: now.getMonth() }; setUi('pView', 'month'); draw(); } }, 'Show'));
  }

  function drawMonth() {
    const byDate = new Map();
    for (const p of store.posts.values()) if (p.postDate && matches(p)) {
      if (!byDate.has(p.postDate)) byDate.set(p.postDate, []);
      byDate.get(p.postDate).push(p);
    }
    const today = todayStr();
    const shift = d => { const n = new Date(cursor.y, cursor.m + d, 1); cursor = { y: n.getFullYear(), m: n.getMonth() }; draw(); };
    const head = h('div', { class: 'month-head' },
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h('h3', { 'aria-live': 'polite' }, fmtMonth(cursor.y, cursor.m)),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, '›'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { cursor = { y: now.getFullYear(), m: now.getMonth() }; selected = today; draw(); } }, 'Today'));
    const dow = h('div', { class: 'dow', 'aria-hidden': 'true' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => h('span', {}, d)));
    const cells = monthGrid(cursor.y, cursor.m).flat().map(date => {
      const list = byDate.get(date) || [];
      const dayNum = Number(date.slice(8));
      const inMonth = Number(date.slice(5, 7)) - 1 === cursor.m;
      const el = h('button', {
        type: 'button',
        class: 'day' + (inMonth ? '' : ' out') + (date === today ? ' today' : '') + (date === selected ? ' selected' : ''),
        'aria-label': fmtDayLong(date) + ', ' + (list.length ? plural(list.length, 'post') : 'no posts'),
        'aria-pressed': date === selected ? 'true' : 'false',
        onclick: () => { selected = date; if (!inMonth) cursor = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) - 1 }; draw(); },
      }, h('span', { class: 'num' }, String(dayNum)),
        h('span', { class: 'dots' }, list.slice(0, 4).map(p => h('i', { class: 'dot s-' + p.status })), list.length > 4 ? h('b', {}, '+') : null));
      return el;
    });
    const dayPosts = (byDate.get(selected) || []).sort((a, b) => a.created.localeCompare(b.created));
    const undated = Array.from(store.posts.values()).filter(p => !p.postDate && matches(p));
    return [
      head, dow, h('div', { class: 'month' }, cells),
      h('section', { class: 'day-panel' },
        h('h3', {}, fmtDayLong(selected) + (selected === today ? ' (today)' : '')),
        ...(dayPosts.length ? dayPosts.map(postCard) : [h('p', { class: 'muted' }, 'Nothing planned for this day.')]),
        h('button', { class: 'btn', type: 'button', onclick: () => addPost(selected) }, '+ Add post for this day')),
      undated.length ? h('details', { class: 'panel' }, h('summary', {}, 'No date yet (' + undated.length + ')'), h('div', { class: 'list' }, undated.map(postCard))) : null,
    ];
  }

  function drawList() {
    const today = todayStr();
    const all = Array.from(store.posts.values()).filter(matches);
    const upcoming = all.filter(p => p.postDate && p.postDate >= today).sort((a, b) => a.postDate.localeCompare(b.postDate));
    const undated = all.filter(p => !p.postDate).sort((a, b) => b.updated.localeCompare(a.updated));
    const past = all.filter(p => p.postDate && p.postDate < today).sort((a, b) => b.postDate.localeCompare(a.postDate));
    const section = (title, rows) => rows.length ? h('section', { class: 'post-section' }, h('h3', {}, title + ' (' + rows.length + ')'), h('div', { class: 'list' }, rows.map(postCard))) : null;
    if (!all.length) return [h('div', { class: 'empty' }, h('p', {}, store.posts.size ? 'No posts match these filters.' : 'No posts yet.'),
      store.posts.size ? null : h('p', { class: 'muted' }, 'Add one here, or open a release and choose Plan 3 a week.'))];
    return [section('Upcoming', upcoming), section('No date yet', undated), section('Past', past)];
  }

  function draw() {
    const view = ui().pView;
    btnMonth.setAttribute('aria-pressed', String(view === 'month'));
    btnList.setAttribute('aria-pressed', String(view === 'list'));
    body.replaceChildren(...[todayStrip(), ...(view === 'list' ? drawList() : drawMonth())].filter(Boolean));
  }

  const wrap = h('div', { class: 'view' },
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => addPost(ui().pView === 'month' ? selected : '') }, '+ Add post'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, btnMonth, btnList)),
    h('div', { class: 'filters' }, h('div', { class: 'filter-row' }, relSel, statusSel)),
    body);
  draw();
  return wrap;
}

// ---------- post editor (caption tool) ----------
export function postEditor(id) {
  const rec = store.posts.get(id);
  if (!rec) return notFound('Post', '#/posts');
  const save = () => store.touch('posts', rec);

  // caption
  const caption = h('textarea', { rows: 9, placeholder: 'One caption for Instagram, Facebook and Threads', value: rec.caption, 'aria-label': 'Caption' });
  const counter = h('small', { class: 'hint counter' });
  const updateCounter = () => {
    const n = Array.from(caption.value).length;
    counter.textContent = n + ' characters' + (n > 2200 ? '. Over the Instagram limit of 2,200.' : n > 500 ? '. Threads cuts posts off at 500.' : '');
    counter.classList.toggle('over', n > 500);
  };
  caption.addEventListener('input', () => { rec.caption = caption.value; updateCounter(); save(); });
  updateCounter();

  const screenText = h('textarea', { rows: 3, placeholder: 'Text shown on the video', value: rec.onScreenText, 'aria-label': 'On-screen text' });
  screenText.addEventListener('input', () => { rec.onScreenText = screenText.value; save(); });
  const clip = h('textarea', { rows: 2, placeholder: 'e.g. verse 2 lyric clip, vertical', value: rec.clipNote, 'aria-label': 'Clip note' });
  clip.addEventListener('input', () => { rec.clipNote = clip.value; save(); });

  // release + song + date + status
  const songSel = h('select', { 'aria-label': 'Song' });
  const meaningBox = h('div', {});
  const lyricsBox = h('div', { class: 'lyrics-box' });
  const drawSongOptions = () => {
    const opt = s => h('option', { value: s.id }, s.title || 'Untitled');
    const sorted = Array.from(store.songs.values()).sort((a, b) => a.title.localeCompare(b.title));
    const onRel = rec.releaseId ? store.releaseSongs(rec.releaseId) : [];
    const ids = new Set(onRel.map(s => s.id));
    const rest = sorted.filter(s => !ids.has(s.id));
    songSel.replaceChildren(h('option', { value: '' }, '— None —'),
      ...(onRel.length ? [h('optgroup', { label: 'On this release' }, onRel.map(opt)), h('optgroup', { label: 'Other songs' }, rest.map(opt))] : rest.map(opt)));
    songSel.value = rec.songId || '';
  };
  const drawMeaning = () => {
    const song = rec.songId && store.songs.get(rec.songId);
    if (!song) { meaningBox.replaceChildren(); return; }
    if (!(song.meaning || '').trim()) {
      meaningBox.replaceChildren(h('p', { class: 'muted small' }, 'No meaning written for this song yet. ', h('a', { href: '#/songs/' + song.id }, 'Add it on the song page'), '.'));
      return;
    }
    meaningBox.replaceChildren(h('details', { class: 'panel', open: true },
      h('summary', {}, 'What “' + (song.title || 'this song') + '” is about'),
      h('p', { class: 'meaning' }, song.meaning),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const cur = caption.value.replace(/\s+$/, '');
          caption.value = (cur ? cur + '\n\n' : '') + song.meaning.trim();
          rec.caption = caption.value; updateCounter(); save();
          toast('Added to the caption.');
        },
      }, 'Add to caption')));
  };
  const drawLyrics = () => {
    const song = rec.songId && store.songs.get(rec.songId);
    lyricsBox.replaceChildren(song && (song.lyrics || '').trim()
      ? lyricsPicker(song, { caption, screenText, changed: ta => { rec[ta === caption ? 'caption' : 'onScreenText'] = ta.value; if (ta === caption) updateCounter(); save(); } })
      : null);
    lyricsBox.hidden = !lyricsBox.firstChild;
  };
  songSel.addEventListener('change', () => { rec.songId = songSel.value || null; save(); drawMeaning(); drawLyrics(); });

  const relSel = select([['', '— None —'], ...Array.from(store.releases.values()).sort((a, b) => a.title.localeCompare(b.title)).map(r => [r.id, r.title || 'Untitled release'])], rec.releaseId || '', v => {
    rec.releaseId = v || null; save(); drawSongOptions();
  });
  const dateIn = h('input', { type: 'date', value: rec.postDate });
  dateIn.addEventListener('input', () => { rec.postDate = dateIn.value; save(); });
  const statusSel = select(POST_STATUS.map(s => [s, cap(s)]), rec.status, v => { rec.status = v; save(); });
  drawSongOptions(); drawMeaning(); drawLyrics();

  const markPosted = () => {
    rec.status = 'posted';
    if (!rec.postDate) { rec.postDate = todayStr(); dateIn.value = rec.postDate; }
    statusSel.value = 'posted';
    save();
    toast('Marked as posted.');
  };

  return h('div', { class: 'view editor' },
    h('a', { class: 'back', href: '#/posts' }, '← Posts'),
    h('div', { class: 'copybar' }, copyButtons(rec, true)),
    h('div', { class: 'cap-row' },
      h('div', { class: 'cap-fields' },
        field('Caption (one for all Meta apps)', caption, counter),
        field('On-screen video text', screenText)),
      lyricsBox),
    field('Clip note', clip),
    h('div', { class: 'grid' },
      field('Release', relSel), field('Song', songSel), field('Post date', dateIn), field('Status', statusSel)),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: markPosted }, 'Mark as posted')),
    meaningBox,
    metricPanel('post', rec),
    h('div', { class: 'actions end' },
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!(await confirmBox('Delete this post?', 'The post and any numbers you recorded for it will be removed. This cannot be undone.', 'Delete', true))) return;
          await store.deletePost(rec.id);
          location.hash = '#/posts';
        },
      }, 'Delete post')));
}

// ---------- promo section of the release editor ----------
const PLAN_DAYS = [1, 3, 5]; // Mon, Wed, Fri

function planDates(release, start, weeks) {
  const taken = new Set(store.releasePosts(release.id).map(p => p.postDate).filter(Boolean));
  const out = [];
  let d = addDays(start, 1);
  for (let guard = 0; out.length < weeks * 3 && guard < 800; guard++, d = addDays(d, 1)) {
    if (PLAN_DAYS.includes(weekdayOf(d)) && !taken.has(d)) out.push(d);
  }
  return out;
}

async function planDialog(release) {
  const weeks = h('input', { type: 'number', value: 4, min: 1, max: 12, step: 1 });
  weeks.setAttribute('inputmode', 'numeric');
  const start = h('input', { type: 'date', value: store.releaseDate(release) || todayStr() });
  const summary = h('p', { class: 'muted' });
  const current = () => {
    const w = Math.min(12, Math.max(1, Math.round(Number(weeks.value) || 0)));
    return start.value ? planDates(release, start.value, w) : [];
  };
  const paint = () => {
    const d = current();
    summary.textContent = d.length ? plural(d.length, 'post idea') + ', Mon, Wed and Fri, from ' + fmtDayLong(d[0]) + ' to ' + fmtDayLong(d[d.length - 1]) + '.' : 'Pick a start date.';
  };
  weeks.addEventListener('input', paint); start.addEventListener('input', paint); paint();
  const v = await modal('Plan 3 posts a week', [
    h('p', {}, 'Creates empty post ideas after the start date (Monday, Wednesday and Friday), cycling through the tracklist. You fill in the words.'),
    field('Weeks', weeks), field('Starting after', start), summary,
  ], [{ label: 'Cancel', value: false }, { label: 'Create posts', value: true, kind: 'primary' }]);
  if (v !== true) return 0;
  const dates = current();
  const tracks = store.releaseSongs(release.id);
  dates.forEach((date, i) => store.createPost({ releaseId: release.id, songId: tracks.length ? tracks[i % tracks.length].id : null, postDate: date, status: 'idea' }));
  return dates.length;
}

export function promoPanel(rec) {
  const box = h('section', { class: 'panel' });
  const draw = () => {
    const list = store.releasePosts(rec.id);
    const posted = list.filter(p => p.status === 'posted').length;
    box.replaceChildren(
      h('h3', {}, 'Promo posts'),
      h('p', { class: 'muted' }, list.length ? plural(list.length, 'post') + ', ' + posted + ' posted.' : 'No posts planned for this release yet.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { const p = store.createPost({ releaseId: rec.id }); location.hash = '#/posts/' + p.id; } }, '+ Add post'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { const n = await planDialog(rec); if (n) { toast('Created ' + plural(n, 'post idea') + '.'); draw(); } } }, 'Plan 3 a week'),
        list.length ? h('button', { class: 'btn', type: 'button', onclick: () => { setUi('pRelease', rec.id); setUi('pStatus', ''); location.hash = '#/posts'; } }, 'Open in calendar') : null));
  };
  draw();
  return box;
}
