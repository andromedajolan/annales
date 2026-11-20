// Stilus (lyric writer) song import. Everything here is optional: Annales never reads Stilus storage,
// it only accepts JSON that Romy exports from Stilus (file or pasted text).
import * as store from './store.js';
import { normalizeSong, newId, nowIso, toIso } from './model.js';

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
export function planStilus(mapped) {
  const byStilus = new Map();
  for (const s of store.songs.values()) if (s.stilusId) byStilus.set(s.stilusId, s);
  const ops = [];
  const seen = new Set();
  const newReleaseKeys = new Set();
  const releaseKey = (t, n) => t + '|' + n.toLowerCase();
  const existingRel = new Set(Array.from(store.releases.values(), r => releaseKey(r.type, r.title)));
  for (const m of mapped) {
    if (seen.has(m.stilusId)) continue; // duplicate id inside the same file: first wins
    seen.add(m.stilusId);
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
  };
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
