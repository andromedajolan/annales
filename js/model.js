// Record shapes, normalisers and small helpers. No DOM, no storage.

export const SCHEMA = 2;

export const SONG_STATUS = ['idea', 'written', 'produced', 'mastered', 'released'];
export const COPYRIGHT_STATES = [['none', 'Not registered'], ['pending', 'Pending'], ['registered', 'Registered']];
export const RELEASE_TYPES = [['album', 'Album'], ['single', 'Single'], ['pool', 'Pool']];
export const POST_STATUS = ['idea', 'drafted', 'scheduled', 'posted'];
export const METRIC_LABELS = { streams: 'Streams', saves: 'Saves', views: 'Views', comments: 'Comments', followersGained: 'Followers gained' };
export const METRIC_KEYS = Object.keys(METRIC_LABELS);
export const METRICS_BY_SCOPE = { release: ['streams', 'saves', 'followersGained'], post: ['views', 'comments', 'saves', 'followersGained'] };

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COVER_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const COVER_MAX_CHARS = 150000;

export function newId(prefix) {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return prefix + '_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export const nowIso = () => new Date().toISOString();

const str = (v, max = 2000) =>
  typeof v === 'string' ? v.trim().slice(0, max)
  : typeof v === 'number' && isFinite(v) ? String(v) : '';
const text = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');
const numIn = (v, min, max) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
};
const intIn = (v, min, max) => { const n = numIn(v, min, max); return n == null ? null : Math.round(n); };
const dateStr = v => (typeof v === 'string' && DATE_RE.test(v.trim()) ? v.trim() : '');

export function toIso(v, fallback) {
  let d = null;
  if (typeof v === 'number' && isFinite(v)) d = new Date(v < 1e11 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim()) d = new Date(v);
  return d && !isNaN(d) ? d.toISOString() : fallback;
}

export function validId(v) { return typeof v === 'string' && ID_RE.test(v); }

export function normalizeCover(c) {
  if (!c || typeof c !== 'object') return null;
  const thumb = typeof c.thumb === 'string' && c.thumb.length <= COVER_MAX_CHARS && COVER_RE.test(c.thumb) ? c.thumb : '';
  if (!thumb) return null;
  return { thumb, name: str(c.name, 200) };
}

export function normalizeSong(r) {
  if (!r || typeof r !== 'object' || !validId(r.id)) return null;
  const now = nowIso();
  const cr = r.copyright && typeof r.copyright === 'object' ? r.copyright : {};
  const created = toIso(r.created, now);
  return {
    id: r.id,
    title: str(r.title, 300),
    artist: str(r.artist, 200),
    releaseId: validId(r.releaseId) ? r.releaseId : null,
    track: intIn(r.track, 1, 999),
    key: str(r.key, 12),
    mode: str(r.mode, 20).toLowerCase(),
    bpm: numIn(r.bpm, 20, 400),
    timeSig: str(r.timeSig, 12),
    length: intIn(r.length, 0, 36000),
    releaseDate: dateStr(r.releaseDate),
    status: SONG_STATUS.includes(r.status) ? r.status : 'idea',
    isrc: str(r.isrc, 20),
    upc: str(r.upc, 20),
    copyright: {
      status: COPYRIGHT_STATES.some(s => s[0] === cr.status) ? cr.status : 'none',
      date: dateStr(cr.date),
    },
    meaning: text(r.meaning),
    notes: text(r.notes),
    stilusId: str(r.stilusId, 120),
    created,
    updated: toIso(r.updated, created),
  };
}

export function normalizeRelease(r) {
  if (!r || typeof r !== 'object' || !validId(r.id)) return null;
  const now = nowIso();
  const created = toIso(r.created, now);
  const links = Array.isArray(r.links)
    ? r.links.slice(0, 40).map(l => ({ platform: str(l && l.platform, 60), url: str(l && l.url, 600) })).filter(l => l.platform || l.url)
    : [];
  return {
    id: r.id,
    type: RELEASE_TYPES.some(t => t[0] === r.type) ? r.type : 'single',
    title: str(r.title, 300),
    artist: str(r.artist, 200),
    plannedDate: dateStr(r.plannedDate),
    actualDate: dateStr(r.actualDate),
    distributor: str(r.distributor, 100),
    upc: str(r.upc, 20),
    cover: normalizeCover(r.cover),
    links,
    checklist: normalizeChecklist(r.checklist),
    notes: text(r.notes),
    created,
    updated: toIso(r.updated, created),
  };
}

export function normalizeChecklist(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set(), out = [];
  for (const it of arr.slice(0, 200)) {
    if (!it || typeof it !== 'object') continue;
    let id = validId(it.id) ? it.id : newId('chk');
    if (seen.has(id)) id = newId('chk');
    seen.add(id);
    out.push({ id, text: str(it.text, 300), done: it.done === true, due: dateStr(it.due) });
  }
  return out;
}

export function normalizeTemplate(r) {
  if (!r || typeof r !== 'object' || !validId(r.id)) return null;
  const created = toIso(r.created, nowIso());
  const seen = new Set(), items = [];
  for (const it of (Array.isArray(r.items) ? r.items.slice(0, 200) : [])) {
    if (!it || typeof it !== 'object') continue;
    let id = validId(it.id) ? it.id : newId('itm');
    if (seen.has(id)) id = newId('itm');
    seen.add(id);
    items.push({ id, text: str(it.text, 300), offset: intIn(it.offset, -730, 730) });
  }
  return { id: r.id, name: str(r.name, 120), items, created, updated: toIso(r.updated, created) };
}

export function normalizePost(r) {
  if (!r || typeof r !== 'object' || !validId(r.id)) return null;
  const created = toIso(r.created, nowIso());
  return {
    id: r.id,
    releaseId: validId(r.releaseId) ? r.releaseId : null,
    songId: validId(r.songId) ? r.songId : null,
    caption: text(r.caption, 10000),
    onScreenText: text(r.onScreenText, 2000),
    clipNote: text(r.clipNote, 2000),
    postDate: dateStr(r.postDate),
    status: POST_STATUS.includes(r.status) ? r.status : 'idea',
    created,
    updated: toIso(r.updated, created),
  };
}

export function normalizeMetric(r) {
  if (!r || typeof r !== 'object' || !validId(r.id) || !validId(r.targetId)) return null;
  if (r.scope !== 'release' && r.scope !== 'post') return null;
  const date = dateStr(r.date);
  if (!date) return null;
  const values = {};
  const v = r.values && typeof r.values === 'object' ? r.values : {};
  for (const k of METRIC_KEYS) { const n = intIn(v[k], 0, 1e12); if (n != null) values[k] = n; }
  if (!Object.keys(values).length) return null;
  const created = toIso(r.created, nowIso());
  return { id: r.id, scope: r.scope, targetId: r.targetId, date, values, note: str(r.note, 300), created, updated: toIso(r.updated, created) };
}

// ---- dates (all dates are local-calendar YYYY-MM-DD strings) ----

export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return todayStr(d); }
// whole days from a to b (b - a)
export function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
export const weekdayOf = s => parseDay(s).getDay();
export const fmtDateShort = s => (DATE_RE.test(s || '') ? parseDay(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
export const fmtDayLong = s => (DATE_RE.test(s || '') ? parseDay(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
export const fmtMonth = (y, m0) => new Date(y, m0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
// 6 weeks x 7 days (Sunday first) covering the month
export function monthGrid(y, m0) {
  const first = todayStr(new Date(y, m0, 1));
  const start = addDays(first, -weekdayOf(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

// ---- display / parsing helpers ----

export function fmtLength(sec) {
  if (sec == null || !isFinite(sec)) return '';
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// "3:42" -> 222, "222" -> 222, "3m42s" -> 222, "" -> null, junk -> NaN
export function parseLength(t) {
  t = String(t).trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+):([0-5]?\d)$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+)$/))) return +m[1];
  if ((m = t.match(/^(\d+)\s*m(?:in)?\s*(\d+)?\s*s?$/i))) return +m[1] * 60 + (+m[2] || 0);
  return NaN;
}

export function fmtDate(d) {
  if (!DATE_RE.test(d || '')) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const isIsrc = v => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(String(v).replace(/[\s-]/g, ''));
export const isUpc = v => /^\d{12,13}$/.test(String(v).replace(/[\s-]/g, ''));

// Only http(s) links are ever rendered as anchors.
export function safeHref(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  try {
    const p = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : '';
  } catch { return ''; }
}
