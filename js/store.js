// In-memory catalogue backed by IndexedDB, with debounced, flush-on-hide autosave.
import * as db from './db.js';
import {
  SCHEMA, METRIC_KEYS, newId, nowIso, todayStr, addDays,
  normalizeSong, normalizeRelease, normalizePost, normalizeMetric, normalizeTemplate,
} from './model.js';

export const songs = new Map();
export const releases = new Map();
export const posts = new Map();
export const metrics = new Map();
export const templates = new Map();
export const maps = { songs, releases, posts, metrics, templates };
export const COLLECTIONS = Object.keys(maps);
const normalizers = { songs: normalizeSong, releases: normalizeRelease, posts: normalizePost, metrics: normalizeMetric, templates: normalizeTemplate };

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
      const norm = normalizers[storeName];
      const n = norm ? norm(rec) : null;
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

// ---------- default checklist template ----------
export const DEFAULT_TEMPLATE_ID = 'tpl_default';
const DEFAULT_ITEMS = [
  ['Master finished', -21], ['Cover done at 3000x3000', -21], ['Metadata and credits ready', -18],
  ['Copyright registered or filed', -14], ['Upload to distributor', -14], ['Pre-save link set up', -10],
  ['Announcement post', -7], ['Release day post', 0], ['Add streaming links to the release', 1],
];

async function seedDefaultTemplate() {
  if (getSettings().templatesSeeded) return;
  if (!templates.size) {
    const now = nowIso();
    const t = normalizeTemplate({
      id: DEFAULT_TEMPLATE_ID, name: 'Standard release', created: now, updated: now,
      items: DEFAULT_ITEMS.map(([text, offset]) => ({ id: newId('itm'), text, offset })),
    });
    templates.set(t.id, t);
    try { await db.put('templates', t); } catch (err) { console.error(err); return; }
  }
  setSetting('templatesSeeded', true);
}

// ---------- load / CRUD ----------
export async function load() {
  const names = COLLECTIONS;
  const all = await Promise.all(names.map(n => db.getAll(n)));
  names.forEach((name, i) => {
    maps[name].clear();
    for (const x of all[i]) { const n = normalizers[name](x); if (n) maps[name].set(n.id, n); }
  });
  await recoverPending();
  await seedDefaultTemplate();
  publishSummary();
}

function create(storeName, prefix, defaults, partial) {
  const now = nowIso();
  const rec = normalizers[storeName]({ id: newId(prefix), created: now, updated: now, ...defaults, ...partial });
  maps[storeName].set(rec.id, rec);
  touch(storeName, rec);
  return rec;
}

export const createSong = (p = {}) => create('songs', 'sng', { artist: getSettings().defaultArtist, status: 'idea' }, p);
export const createRelease = (p = {}) => create('releases', 'rel', { type: 'single', artist: getSettings().defaultArtist }, p);
export const createPost = (p = {}) => create('posts', 'pst', { status: 'idea' }, p);
export const createTemplate = (p = {}) => create('templates', 'tpl', { name: 'New template', items: [] }, p);

// One entry per target per date: adding numbers for an existing date replaces just the values you typed.
export function saveMetric(scope, targetId, date, values, note = '') {
  const existing = Array.from(metrics.values()).find(m => m.scope === scope && m.targetId === targetId && m.date === date);
  if (existing) {
    existing.values = { ...existing.values, ...values };
    if (note) existing.note = note;
    touch('metrics', existing);
    return existing;
  }
  return create('metrics', 'met', {}, { scope, targetId, date, values, note });
}

export async function deleteSong(id) {
  dropPending('songs', id);
  songs.delete(id);
  const unlinked = [];
  for (const p of posts.values()) if (p.songId === id) { p.songId = null; p.updated = nowIso(); dropPending('posts', p.id); unlinked.push(p); }
  await db.batch({ songs: { del: [id] }, posts: { put: unlinked } });
  emit(); publishSummary();
}

export async function deleteRelease(id) {
  dropPending('releases', id);
  releases.delete(id);
  const unlinkedSongs = [], unlinkedPosts = [], goneMetrics = [];
  for (const s of songs.values()) if (s.releaseId === id) { s.releaseId = null; s.track = null; s.updated = nowIso(); dropPending('songs', s.id); unlinkedSongs.push(s); }
  for (const p of posts.values()) if (p.releaseId === id) { p.releaseId = null; p.updated = nowIso(); dropPending('posts', p.id); unlinkedPosts.push(p); }
  for (const m of metrics.values()) if (m.scope === 'release' && m.targetId === id) { dropPending('metrics', m.id); goneMetrics.push(m.id); }
  goneMetrics.forEach(mid => metrics.delete(mid));
  await db.batch({ songs: { put: unlinkedSongs }, posts: { put: unlinkedPosts }, metrics: { del: goneMetrics }, releases: { del: [id] } });
  emit(); publishSummary();
}

export async function deletePost(id) {
  dropPending('posts', id);
  posts.delete(id);
  const goneMetrics = [];
  for (const m of metrics.values()) if (m.scope === 'post' && m.targetId === id) { dropPending('metrics', m.id); goneMetrics.push(m.id); }
  goneMetrics.forEach(mid => metrics.delete(mid));
  await db.batch({ posts: { del: [id] }, metrics: { del: goneMetrics } });
  emit(); publishSummary();
}

export async function deleteSimple(storeName, id) {
  dropPending(storeName, id);
  maps[storeName].delete(id);
  await db.del(storeName, id);
  emit(); publishSummary();
}

// Apply an import in one atomic write.
// mode "replace": the incoming set becomes the whole catalogue. mode "merge": incoming records are added/updated.
// incoming: { songs: [], releases: [], posts: [], metrics: [], templates: [] } of normalised records.
export async function applyRecords(incoming, mode) {
  await flushAll();
  const fin = {};
  for (const name of COLLECTIONS) {
    fin[name] = new Map(mode === 'replace' ? [] : maps[name]);
    for (const r of incoming[name] || []) fin[name].set(r.id, r);
  }
  // repair links that point at records that are not in the result
  for (const s of fin.songs.values()) if (s.releaseId && !fin.releases.has(s.releaseId)) { s.releaseId = null; s.track = null; }
  for (const p of fin.posts.values()) {
    if (p.releaseId && !fin.releases.has(p.releaseId)) p.releaseId = null;
    if (p.songId && !fin.songs.has(p.songId)) p.songId = null;
  }
  for (const [id, m] of Array.from(fin.metrics)) {
    if (!(m.scope === 'release' ? fin.releases : fin.posts).has(m.targetId)) fin.metrics.delete(id);
  }
  const ops = {};
  for (const name of COLLECTIONS) {
    ops[name] = {
      put: (incoming[name] || []).filter(r => fin[name].has(r.id)),
      del: mode === 'replace' ? Array.from(maps[name].keys()).filter(id => !fin[name].has(id)) : [],
    };
  }
  await db.batch(ops);
  for (const name of COLLECTIONS) { maps[name].clear(); fin[name].forEach((v, k) => maps[name].set(k, v)); }
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

export const releaseDate = r => r.actualDate || r.plannedDate || '';

export function releasePosts(releaseId) {
  return Array.from(posts.values()).filter(p => p.releaseId === releaseId);
}

// Entries for one release or post, oldest first.
export function metricsFor(scope, targetId) {
  return Array.from(metrics.values()).filter(m => m.scope === scope && m.targetId === targetId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// For each metric key that has data: the latest value, its date, and the previous value (if any).
export function latestValues(scope, targetId) {
  const entries = metricsFor(scope, targetId);
  const out = {};
  for (const k of METRIC_KEYS) {
    const withKey = entries.filter(e => e.values[k] != null);
    if (!withKey.length) continue;
    const last = withKey[withKey.length - 1], prev = withKey[withKey.length - 2];
    out[k] = { value: last.values[k], date: last.date, prev: prev ? prev.values[k] : null, prevDate: prev ? prev.date : '' };
  }
  return out;
}

// Open checklist items with a due date within `days` (overdue included), soonest first.
export function dueItems(days = 7) {
  const today = todayStr(), limit = addDays(today, days), out = [];
  for (const r of releases.values()) for (const it of r.checklist) if (!it.done && it.due && it.due <= limit) out.push({ release: r, item: it });
  return out.sort((a, b) => a.item.due.localeCompare(b.item.due));
}

export function buildBackup() {
  const out = { format: 'annales-backup', schema: SCHEMA, app: 'annales', appVersion: version, exported: nowIso() };
  for (const name of COLLECTIONS) out[name] = Array.from(maps[name].values());
  return out;
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
