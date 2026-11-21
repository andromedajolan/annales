// Whole-catalogue Export / Import (format "annales-backup", schema 1; see docs/DATA_FORMAT.md).
import * as store from './store.js';
import { SCHEMA, normalizeSong, normalizeRelease, normalizePost, normalizeMetric, normalizeTemplate } from './model.js';

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

const NORMALIZERS = { songs: normalizeSong, releases: normalizeRelease, posts: normalizePost, metrics: normalizeMetric, templates: normalizeTemplate };

export function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { error: 'That is not valid JSON.' }; }
  if (o && o.format === 'lyricwriter-backup') return { error: 'That is a Stilus backup. Use "Import from Stilus" on the Songs tab.' };
  if (!o || o.format !== 'annales-backup') return { error: 'This is not an Annales backup.' };
  if (typeof o.schema !== 'number' || o.schema > SCHEMA) return { error: 'This backup was made by a newer version of Annales. Update the app first.' };
  if (!Array.isArray(o.songs) || !Array.isArray(o.releases)) return { error: 'The backup is missing its songs or releases list.' };
  const records = {};
  let dropped = 0;
  for (const name of store.COLLECTIONS) {
    records[name] = [];
    const seen = new Set();
    // posts, metrics and templates arrived in schema 2; older backups simply do not have them
    for (const x of Array.isArray(o[name]) ? o[name] : []) {
      const n = NORMALIZERS[name](x);
      if (n && !seen.has(n.id)) { seen.add(n.id); records[name].push(n); } else dropped++;
    }
  }
  return { records, dropped, exported: typeof o.exported === 'string' ? o.exported : '' };
}

// What an import would do, per collection. Merge: add new records; replace an existing one only if the incoming copy is newer.
export function planBackup(parsed, mode) {
  const records = {}, counts = {};
  for (const name of store.COLLECTIONS) {
    const incoming = parsed.records[name], existing = store.maps[name];
    if (mode === 'replace') {
      records[name] = incoming;
      counts[name] = { added: incoming.length, updated: 0, removed: Array.from(existing.keys()).filter(id => !incoming.some(r => r.id === id)).length };
      continue;
    }
    const take = []; let added = 0, updated = 0;
    for (const rec of incoming) {
      const ex = existing.get(rec.id);
      if (!ex) { take.push(rec); added++; } else if (rec.updated > ex.updated) { take.push(rec); updated++; }
    }
    records[name] = take;
    counts[name] = { added, updated, removed: 0 };
  }
  return { records, counts };
}

export const applyBackup = (plan, mode) => store.applyRecords(plan.records, mode);
