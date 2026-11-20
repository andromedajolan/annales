// Whole-catalogue Export / Import (format "annales-backup", schema 1; see docs/DATA_FORMAT.md).
import * as store from './store.js';
import { SCHEMA, normalizeSong, normalizeRelease } from './model.js';

const LAST_BACKUP_KEY = 'annales.lastBackup';
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export function lastBackup() {
  try { return localStorage.getItem(LAST_BACKUP_KEY) || ''; } catch { return ''; }
}

export function downloadBackup() {
  const obj = store.buildBackup();
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'annales-backup-' + obj.exported.slice(0, 10) + '.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  try { localStorage.setItem(LAST_BACKUP_KEY, obj.exported); } catch { /* ignore */ }
  return obj;
}

export function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { error: 'That is not valid JSON.' }; }
  if (o && o.format === 'lyricwriter-backup') return { error: 'That is a Stilus backup. Use "Import from Stilus" on the Songs tab.' };
  if (!o || o.format !== 'annales-backup') return { error: 'This is not an Annales backup.' };
  if (typeof o.schema !== 'number' || o.schema > SCHEMA) return { error: 'This backup was made by a newer version of Annales. Update the app first.' };
  if (!Array.isArray(o.songs) || !Array.isArray(o.releases)) return { error: 'The backup is missing its songs or releases list.' };
  const songs = [], releases = [];
  let dropped = 0;
  const seenS = new Set(), seenR = new Set();
  for (const x of o.songs) { const n = normalizeSong(x); if (n && !seenS.has(n.id)) { seenS.add(n.id); songs.push(n); } else dropped++; }
  for (const x of o.releases) { const n = normalizeRelease(x); if (n && !seenR.has(n.id)) { seenR.add(n.id); releases.push(n); } else dropped++; }
  return { songs, releases, dropped, exported: typeof o.exported === 'string' ? o.exported : '' };
}

// Merge: incoming records are added; existing ones are replaced only if the incoming copy is newer.
export function planBackup(parsed, mode) {
  if (mode === 'replace') {
    return {
      songs: parsed.songs, releases: parsed.releases,
      addedSongs: parsed.songs.length, updatedSongs: 0, addedReleases: parsed.releases.length, updatedReleases: 0,
      removedSongs: [...store.songs.keys()].filter(id => !parsed.songs.some(s => s.id === id)).length,
      removedReleases: [...store.releases.keys()].filter(id => !parsed.releases.some(r => r.id === id)).length,
    };
  }
  const pick = (incoming, existing) => {
    const take = []; let added = 0, updated = 0;
    for (const rec of incoming) {
      const ex = existing.get(rec.id);
      if (!ex) { take.push(rec); added++; }
      else if (rec.updated > ex.updated) { take.push(rec); updated++; }
    }
    return { take, added, updated };
  };
  const s = pick(parsed.songs, store.songs);
  const r = pick(parsed.releases, store.releases);
  return {
    songs: s.take, releases: r.take,
    addedSongs: s.added, updatedSongs: s.updated, addedReleases: r.added, updatedReleases: r.updated,
    removedSongs: 0, removedReleases: 0,
  };
}

export const applyBackup = (plan, mode) => store.applyRecords(plan.songs, plan.releases, mode);
