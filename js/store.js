// In-memory catalogue backed by IndexedDB, with debounced, flush-on-hide autosave.
import * as db from './db.js';
import { SCHEMA, newId, nowIso, normalizeSong, normalizeRelease } from './model.js';

export const songs = new Map();
export const releases = new Map();
const maps = { songs, releases };

let version = '0.0.0';
let lastOpened = nowIso();
export function configure(opts) { if (opts.version) version = opts.version; }
export function markOpened() { lastOpened = nowIso(); publishSummary(); }

// ---------- settings (localStorage, annales.* keys only) ----------
const SETTINGS_KEY = 'annales.settings';
const DEFAULT_SETTINGS = { defaultArtist: 'Andromeda Dunn' };
export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function setSetting(k, v) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), [k]: v })); } catch { /* ignore */ }
}

// ---------- autosave ----------
const dirty = new Map();   // "store:id" -> [store, record]
const timers = new Map();
const since = new Map();   // "store:id" -> when it first became dirty (caps the debounce)
const PENDING_KEY = 'annales.pending';
const DEBOUNCE_MS = 350, MAX_WAIT_MS = 1500;
let inflight = 0, failed = false, lastSaved = null;
const listeners = new Set();

export function onSaveState(fn) { listeners.add(fn); }
function emit() {
  const state = failed ? 'error' : (dirty.size || inflight) ? 'saving' : 'saved';
  listeners.forEach(f => f(state, lastSaved));
}

export function touch(storeName, rec) {
  rec.updated = nowIso();
  const k = storeName + ':' + rec.id;
  dirty.set(k, [storeName, rec]);
  const now = Date.now();
  if (!since.has(k)) since.set(k, now);
  // Debounce typing, but never postpone a write by more than MAX_WAIT_MS in total.
  if (now - since.get(k) < MAX_WAIT_MS || !timers.has(k)) {
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => flushKey(k), DEBOUNCE_MS));
  }
  emit();
}

async function flushKey(k) {
  const entry = dirty.get(k);
  clearTimeout(timers.get(k));
  timers.delete(k);
  since.delete(k);
  if (!entry) return;
  dirty.delete(k);
  inflight++;
  try {
    await db.put(entry[0], entry[1]);
    failed = false;
    lastSaved = new Date();
  } catch (err) {
    console.error('Annales save failed', err);
    failed = true;
    if (!dirty.has(k)) { dirty.set(k, entry); timers.set(k, setTimeout(() => flushKey(k), 3000)); }
  } finally {
    inflight--;
    if (!dirty.size && !inflight) { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }
    emit();
    publishSummary();
  }
}

// IndexedDB writes are asynchronous and a closing page can cut them off. When the page is hidden or
// closing, also copy unsaved records to localStorage (synchronous). They are restored on the next open.
export function stashPending() {
  if (!dirty.size) return;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(Array.from(dirty.values()))); } catch { /* ignore */ }
}

async function recoverPending() {
  let raw = null;
  try { raw = localStorage.getItem(PENDING_KEY); } catch { return; }
  if (!raw) return;
  try {
    for (const [storeName, rec] of JSON.parse(raw)) {
      const n = storeName === 'songs' ? normalizeSong(rec) : storeName === 'releases' ? normalizeRelease(rec) : null;
      if (!n) continue;
      const have = maps[storeName].get(n.id);
      if (!have || n.updated >= have.updated) { await db.put(storeName, n); maps[storeName].set(n.id, n); }
    }
  } catch (err) { console.error('Could not restore unsaved edits', err); return; }
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

export function flushAll() { return Promise.all(Array.from(dirty.keys(), flushKey)); }

function dropPending(storeName, id) {
  const k = storeName + ':' + id;
  clearTimeout(timers.get(k));
  timers.delete(k);
  since.delete(k);
  dirty.delete(k);
}

// ---------- load / CRUD ----------
export async function load() {
  const [s, r] = await Promise.all([db.getAll('songs'), db.getAll('releases')]);
  songs.clear(); releases.clear();
  for (const x of s) { const n = normalizeSong(x); if (n) songs.set(n.id, n); }
  for (const x of r) { const n = normalizeRelease(x); if (n) releases.set(n.id, n); }
  await recoverPending();
  publishSummary();
}

export function createSong(partial = {}) {
  const now = nowIso();
  const rec = normalizeSong({
    id: newId('sng'), artist: getSettings().defaultArtist, status: 'idea',
    created: now, updated: now, ...partial,
  });
  songs.set(rec.id, rec);
  touch('songs', rec);
  return rec;
}

export function createRelease(partial = {}) {
  const now = nowIso();
  const rec = normalizeRelease({
    id: newId('rel'), type: 'single', artist: getSettings().defaultArtist,
    created: now, updated: now, ...partial,
  });
  releases.set(rec.id, rec);
  touch('releases', rec);
  return rec;
}

export async function deleteSong(id) {
  dropPending('songs', id);
  songs.delete(id);
  await db.del('songs', id);
  emit(); publishSummary();
}

export async function deleteRelease(id) {
  dropPending('releases', id);
  releases.delete(id);
  const unlinked = [];
  for (const s of songs.values()) {
    if (s.releaseId === id) { s.releaseId = null; s.track = null; s.updated = nowIso(); dropPending('songs', s.id); unlinked.push(s); }
  }
  await db.batch({ songs: { put: unlinked }, releases: { del: [id] } });
  emit(); publishSummary();
}

// Apply an import in one atomic write.
// mode "replace": the incoming set becomes the whole catalogue. mode "merge": incoming records are added/updated.
export async function applyRecords(incomingSongs, incomingReleases, mode) {
  await flushAll();
  const finalReleases = new Map(mode === 'replace' ? [] : releases);
  for (const r of incomingReleases) finalReleases.set(r.id, r);
  const finalSongs = new Map(mode === 'replace' ? [] : songs);
  for (const s of incomingSongs) finalSongs.set(s.id, s);
  // repair dangling release links
  for (const s of finalSongs.values()) if (s.releaseId && !finalReleases.has(s.releaseId)) { s.releaseId = null; s.track = null; }

  const ops = { songs: { put: incomingSongs, del: [] }, releases: { put: incomingReleases, del: [] } };
  if (mode === 'replace') {
    ops.songs.del = [...songs.keys()].filter(id => !finalSongs.has(id));
    ops.releases.del = [...releases.keys()].filter(id => !finalReleases.has(id));
  }
  // Repaired links only ever touch incoming songs (merge never removes releases), and those are in ops.songs.put.
  await db.batch(ops);
  songs.clear(); releases.clear();
  finalSongs.forEach((v, k) => songs.set(k, v));
  finalReleases.forEach((v, k) => releases.set(k, v));
  emit(); publishSummary();
}

// ---------- helpers ----------
export function releaseSongs(releaseId) {
  return Array.from(songs.values())
    .filter(s => s.releaseId === releaseId)
    .sort((a, b) => (a.track ?? 9999) - (b.track ?? 9999) || a.title.localeCompare(b.title));
}

export function nextTrack(releaseId) {
  let max = 0;
  for (const s of songs.values()) if (s.releaseId === releaseId && s.track && s.track > max) max = s.track;
  return max + 1;
}

export function artistNames() {
  const set = new Set([getSettings().defaultArtist]);
  for (const s of songs.values()) if (s.artist) set.add(s.artist);
  for (const r of releases.values()) if (r.artist) set.add(r.artist);
  set.delete('');
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function buildBackup() {
  return {
    format: 'annales-backup', schema: SCHEMA, app: 'annales', appVersion: version, exported: nowIso(),
    songs: Array.from(songs.values()), releases: Array.from(releases.values()),
  };
}

// ---------- launcher summary (read-only for Ianua) ----------
export function publishSummary() {
  try {
    const recent = [...songs.values(), ...releases.values()]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, 8)
      .map(r => ({ id: r.id, title: r.title || 'Untitled', updated: r.updated }));
    localStorage.setItem('annales.summary', JSON.stringify({
      schema: 1, appId: 'annales', version, lastOpened, recent,
    }));
  } catch { /* storage full or blocked: the launcher just shows nothing */ }
}

// ---------- persistence ----------
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
