// Stilus (lyric writer) song import. Everything here is optional: Annales never reads Stilus storage,
// it only accepts JSON that Romy exports from Stilus (file or pasted text).
import * as store from './store.js';
import { normalizeSong, newId, nowIso, toIso } from './model.js';

// ---- lyrics: clean text with section names, no chords, no Suno tags ----

export function cleanLyricLines(raw) {
  const out = [];
  for (const line of String(raw || '').replace(/\r\n?/g, '\n').split('\n')) {
    let removed = false;
    // chords and any other bracketed text (Suno tags, stage directions) are not lyrics
    let t = line.replace(/\[[^\]]*\]/g, () => (removed = true, ''));
    if (removed) t = t.replace(/[ \t]{2,}/g, ' ');
    t = t.trim();
    if (removed && !t) continue; // a line that held only chords
    out.push(t);
  }
  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function buildLyrics(o) {
  const secs = Array.isArray(o.sections) ? o.sections.filter(x => x && typeof x === 'object') : [];
  let text = '';
  if (secs.length) {
    const totals = {}, seen = {};
    for (const x of secs) totals[x.type] = (totals[x.type] || 0) + 1;
    const blocks = [];
    for (const x of secs) {
      seen[x.type] = (seen[x.type] || 0) + 1;
      const body = cleanLyricLines(x.lyrics);
      if (!body) continue;
      const custom = typeof x.label === 'string' ? x.label.trim() : '';
      const type = typeof x.type === 'string' && x.type ? x.type : 'Other';
      const name = custom || (totals[x.type] > 1 && type !== 'Other' ? type + ' ' + seen[x.type] : type);
      blocks.push(name + '\n' + body);
    }
    text = blocks.join('\n\n');
  } else if (typeof o.lyrics === 'string') {
    text = cleanLyricLines(o.lyrics);
  }
  return text.slice(0, 60000);
}

const dateOf = v => {
  if (typeof v === 'number' && isFinite(v)) { const d = new Date(v < 1e11 ? v * 1000 : v); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  return '';
};

const str = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : '');

function mapStilusSong(o) {
  if (!o || typeof o !== 'object') return null;
  const id = str(o.id);
  if (!id) return null;
  const rel = o.release && typeof o.release === 'object' ? o.release : {};
  const type = ['album', 'single', 'pool'].includes(rel.type) ? rel.type : 'none';
  const notes = o.notes && typeof o.notes === 'object' ? o.notes : {};
  const bpm = typeof o.bpm === 'number' ? o.bpm : parseFloat(o.bpm);
  return {
    stilusId: id.slice(0, 120),
    title: str(o.title).slice(0, 300),
    key: str(o.key).slice(0, 12),
    mode: str(o.mode).toLowerCase().slice(0, 20),
    bpm: isFinite(bpm) && bpm >= 20 && bpm <= 400 ? bpm : null,
    timeSig: str(o.timeSig).slice(0, 12),
    meaning: typeof notes.meaning === 'string' ? notes.meaning.slice(0, 20000) : '',
    release: { type, name: str(rel.name).slice(0, 300) },
    releaseDate: dateOf(rel.date),
    lyrics: buildLyrics(o),
    lyricsUpdated: toIso(o.updated, ''),
    created: toIso(o.created, nowIso()),
  };
}

// Accepts a Stilus backup, an array of songs, or a single song.
export function parseStilus(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'That is not valid JSON.' }; }
  let list;
  if (data && data.format === 'annales-backup') return { error: 'That is an Annales backup. Import it from the Data tab instead.' };
  if (data && data.format === 'lyricwriter-backup') {
    if (!Array.isArray(data.songs)) return { error: 'The Stilus backup has no songs list.' };
    list = data.songs;
  } else if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object' && ('id' in data) && ('title' in data)) list = [data];
  else return { error: 'This does not look like Stilus songs (expected a Stilus backup, a list of songs, or one song).' };
  const mapped = []; let skipped = 0;
  for (const o of list) { const m = mapStilusSong(o); if (m) mapped.push(m); else skipped++; }
  return { mapped, skipped };
}

const FIELDS = ['title', 'key', 'mode', 'bpm', 'timeSig', 'meaning'];

// Work out what an import would do, without changing anything.
// opts.datedOnly: leave out songs with no release date (drafts) and count them.
export function planStilus(mapped, opts = {}) {
  const byStilus = new Map();
  for (const s of store.songs.values()) if (s.stilusId) byStilus.set(s.stilusId, s);
  const ops = [];
  let drafts = 0;
  const seen = new Set();
  const newReleaseKeys = new Set();
  const releaseKey = (t, n) => t + '|' + n.toLowerCase();
  const existingRel = new Set(Array.from(store.releases.values(), r => releaseKey(r.type, r.title)));
  for (const m of mapped) {
    if (seen.has(m.stilusId)) continue; // duplicate id inside the same file: first wins
    seen.add(m.stilusId);
    if (opts.datedOnly && !m.releaseDate) { drafts++; continue; }
    const wantsRelease = m.release.type !== 'none' && m.release.name;
    const ex = byStilus.get(m.stilusId);
    if (!ex) {
      ops.push({ kind: 'add', m });
      if (wantsRelease) { const k = releaseKey(m.release.type, m.release.name); if (!existingRel.has(k)) newReleaseKeys.add(k); }
      continue;
    }
    // Existing song: Stilus owns title/key/mode/bpm/timeSig; meaning only overwrites when Stilus has text.
    const patch = {};
    for (const f of FIELDS) {
      const v = m[f];
      if (f === 'title' ? (v && v !== ex.title) : (v !== '' && v != null && v !== ex[f])) patch[f] = v;
    }
    if (!ex.releaseDate && m.releaseDate) patch.releaseDate = m.releaseDate;
    if (lyricsNewer(ex, m)) { patch.lyrics = m.lyrics; patch.lyricsUpdated = m.lyricsUpdated; }
    const linkRelease = !ex.releaseId && wantsRelease;
    if (linkRelease) { const k = releaseKey(m.release.type, m.release.name); if (!existingRel.has(k)) newReleaseKeys.add(k); }
    ops.push(Object.keys(patch).length || linkRelease ? { kind: 'update', m, ex, patch, linkRelease } : { kind: 'same', m, ex });
  }
  return {
    ops,
    added: ops.filter(o => o.kind === 'add'),
    updated: ops.filter(o => o.kind === 'update'),
    same: ops.filter(o => o.kind === 'same'),
    newReleases: newReleaseKeys.size,
    drafts,
    total: mapped.length,
  };
}

// Lyrics are read-only here. Refresh when Stilus has text and it is newer than what was imported
// (or nothing was imported yet). Empty Stilus lyrics never clear what is already here.
function lyricsNewer(ex, m) {
  if (!m.lyrics || m.lyrics === (ex.lyrics || '')) return false;
  if (!ex.lyrics || !ex.lyricsUpdated || !m.lyricsUpdated) return true;
  return m.lyricsUpdated > ex.lyricsUpdated;
}

function findOrCreateRelease(type, name, artist) {
  const key = name.toLowerCase();
  for (const r of store.releases.values()) if (r.type === type && r.title.toLowerCase() === key) return r;
  return store.createRelease({ type, title: name, artist });
}

export async function applyStilus(plan) {
  const artist = store.getSettings().defaultArtist;
  for (const op of plan.ops) {
    const { m } = op;
    if (op.kind === 'add') {
      const rec = normalizeSong({
        id: newId('sng'), stilusId: m.stilusId, title: m.title, artist, status: 'written',
        key: m.key, mode: m.mode, bpm: m.bpm, timeSig: m.timeSig, meaning: m.meaning,
        releaseDate: m.releaseDate, lyrics: m.lyrics, lyricsUpdated: m.lyrics ? m.lyricsUpdated : '',
        created: m.created, updated: nowIso(),
      });
      if (m.release.type !== 'none' && m.release.name) {
        const rel = findOrCreateRelease(m.release.type, m.release.name, artist);
        rec.releaseId = rel.id; rec.track = store.nextTrack(rel.id);
      }
      store.songs.set(rec.id, rec);
      store.touch('songs', rec);
    } else if (op.kind === 'update') {
      Object.assign(op.ex, op.patch);
      if (op.linkRelease) {
        const rel = findOrCreateRelease(m.release.type, m.release.name, op.ex.artist || artist);
        op.ex.releaseId = rel.id; op.ex.track = store.nextTrack(rel.id);
      }
      store.touch('songs', op.ex);
    }
  }
  await store.flushAll();
}
