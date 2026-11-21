// Lyrics from Stilus. Read-only in Annales: edit them in Stilus and import again.
import { h, toast, copyText } from './kit.js';

const HEADER_RE = /^(Intro|Verse|Pre-Chorus|Chorus|Post-Chorus|Bridge|Hook|Refrain|Interlude|Instrumental|Outro|Other)( \d+)?$/i;

// [{ header: 'Verse 1', lines: [...] }, ...] from the stored clean text
export function lyricBlocks(text) {
  return String(text || '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(l => l.length).map(lines =>
    lines.length > 1 && HEADER_RE.test(lines[0]) ? { header: lines[0], lines: lines.slice(1) } : { header: '', lines });
}

const when = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

// Song editor: the whole text, selectable, with one Copy button.
export function lyricsPanel(song) {
  return h('details', { class: 'panel lyrics-panel' },
    h('summary', {}, 'Lyrics'),
    h('p', { class: 'muted small' }, 'From Stilus' + (song.lyricsUpdated ? ', as of ' + when(song.lyricsUpdated) : '') + '. Read-only here. Change them in Stilus and import again to refresh.'),
    h('div', { class: 'lyrics-text', tabindex: 0, role: 'region', 'aria-label': 'Lyrics of ' + (song.title || 'this song') }, song.lyrics),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => copyText(song.lyrics, 'Lyrics') }, 'Copy lyrics')));
}

// Posts: tap lines, then add them to the caption or the on-screen text.
export function lyricsPicker(song, { caption, screenText, changed }) {
  const picked = new Set();
  const blocks = lyricBlocks(song.lyrics);
  const rows = [];
  const body = h('div', { class: 'lyric-lines' });
  const addCap = h('button', { class: 'btn', type: 'button' });
  const addScr = h('button', { class: 'btn', type: 'button' });
  const clear = h('button', { class: 'btn', type: 'button', onclick: () => { picked.clear(); sync(); } }, 'Clear');
  let n = 0;
  for (const b of blocks) {
    if (b.header) body.append(h('div', { class: 'lyric-head' }, b.header));
    for (const text of b.lines) {
      const i = n++;
      const el = h('button', { class: 'lyric-line', type: 'button', 'aria-pressed': 'false', onclick: () => { picked.has(i) ? picked.delete(i) : picked.add(i); sync(); } }, text);
      rows.push({ i, text, el });
      body.append(el);
    }
  }
  const chosen = () => rows.filter(r => picked.has(r.i)).map(r => r.text);
  function sync() {
    for (const r of rows) { const on = picked.has(r.i); r.el.classList.toggle('sel', on); r.el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const k = picked.size;
    addCap.textContent = k ? 'Add ' + k + (k === 1 ? ' line' : ' lines') + ' to caption' : 'Add to caption';
    addScr.textContent = k ? 'Add ' + k + (k === 1 ? ' line' : ' lines') + ' to on-screen text' : 'Add to on-screen text';
    addCap.disabled = addScr.disabled = clear.disabled = !k;
  }
  const add = (ta, label) => {
    const lines = chosen();
    if (!lines.length) return;
    const cur = ta.value.replace(/\s+$/, '');
    ta.value = (cur ? cur + '\n' : '') + lines.join('\n');
    changed(ta);
    toast('Added ' + (lines.length === 1 ? '1 line' : lines.length + ' lines') + ' to the ' + label + '.');
    picked.clear(); sync();
  };
  addCap.onclick = () => add(caption, 'caption');
  addScr.onclick = () => add(screenText, 'on-screen text');
  sync();
  return h('details', { class: 'panel lyrics-pick', open: window.matchMedia('(min-width: 900px)').matches },
    h('summary', {}, 'Lyrics of “' + (song.title || 'this song') + '”'),
    h('p', { class: 'muted small' }, 'Tap the lines you want, then add them.'),
    h('div', { class: 'actions' }, addCap, addScr, clear),
    body,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => copyText(song.lyrics, 'Lyrics') }, 'Copy all lyrics')));
}
