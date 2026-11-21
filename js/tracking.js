// Stage 4: Tracking tab and the per-release summary.
import * as store from './store.js';
import { h, pill, plural, notFound, typeLabel } from './kit.js';
import { METRIC_LABELS, fmtDate, fmtDayLong } from './model.js';
import { fmtNum, rankedBars } from './chart.js';
import { tile, tilesFor, metricPanel } from './metrics.js';
import { postCard, postLabel } from './posts.js';
import { checklistProgress } from './checklist.js';

const coverBox = (r, cls) => r.cover ? h('img', { class: cls, src: r.cover.thumb, alt: '' }) : h('div', { class: cls + ' ph', 'aria-hidden': 'true' }, (r.title || '?').charAt(0).toUpperCase());

export function trackingView() {
  const releases = Array.from(store.releases.values()).sort((a, b) => (store.releaseDate(b) || '0').localeCompare(store.releaseDate(a) || '0'));
  const cards = releases.map(r => {
    const latest = store.latestValues('release', r.id);
    const bits = ['streams', 'saves', 'followersGained'].filter(k => latest[k]).map(k => METRIC_LABELS[k] + ' ' + fmtNum(latest[k].value));
    const posts = store.releasePosts(r.id);
    return h('a', { class: 'card', href: '#/summary/' + r.id },
      coverBox(r, 'cover-sm'),
      h('div', { class: 'card-main' },
        h('div', { class: 'card-title' }, r.title || 'Untitled'),
        h('div', { class: 'card-meta' }, bits.length ? bits.join(' · ') : 'No numbers yet'),
        h('div', { class: 'card-meta' }, plural(posts.length, 'post') + ', ' + posts.filter(p => p.status === 'posted').length + ' posted')));
  });
  return h('div', { class: 'view' },
    h('p', { class: 'muted' }, 'Pick a release to see its summary and type in its numbers. Numbers for each post are on the post page.'),
    h('div', { class: 'list' }, cards.length ? cards : [h('div', { class: 'empty' }, h('p', {}, 'No releases yet.'), h('p', { class: 'muted' }, 'Add a release first, then come back to track it.'))]));
}

export function summaryView(id) {
  const rec = store.releases.get(id);
  if (!rec) return notFound('Release', '#/tracking');
  const tracks = store.releaseSongs(rec.id);
  const posts = store.releasePosts(rec.id).sort((a, b) => (a.postDate || '9').localeCompare(b.postDate || '9'));
  const prog = checklistProgress(rec);
  const when = rec.actualDate ? 'Released ' + fmtDate(rec.actualDate) : rec.plannedDate ? 'Planned ' + fmtDate(rec.plannedDate) : 'No date yet';

  // post views: latest total per post
  const withViews = posts.map(p => ({ p, v: store.latestValues('post', p.id).views })).filter(x => x.v);
  const totalViews = withViews.reduce((n, x) => n + x.v.value, 0);
  const posted = posts.filter(p => p.status === 'posted').length;

  const makeTiles = () => [
    ...tilesFor('release', rec.id),
    withViews.length ? tile('Post views', fmtNum(totalViews), null, 'latest totals, ' + plural(withViews.length, 'post')) : null,
    tile('Posts', posted + ' of ' + posts.length, null, 'posted'),
    tile('Checklist', prog.done + ' of ' + prog.total, prog.overdue ? { dir: 'down', text: prog.overdue + ' overdue' } : null, prog.total ? 'done' : 'no items'),
  ].filter(Boolean);
  const tilesBox = h('div', { class: 'tiles' }, makeTiles());

  const open = rec.checklist.filter(i => !i.done);
  const next = open.filter(i => i.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  const meterPct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return h('div', { class: 'view' },
    h('a', { class: 'back', href: '#/tracking' }, '← Tracking'),
    h('div', { class: 'summary-head' },
      coverBox(rec, 'cover-lg'),
      h('div', {},
        h('h2', { class: 'page-title' }, rec.title || 'Untitled release'),
        h('p', { class: 'muted' }, [typeLabel(rec.type), rec.artist, when].filter(Boolean).join(' · ')),
        h('a', { class: 'btn', href: '#/releases/' + rec.id }, 'Edit release'))),
    tilesBox,
    metricPanel('release', rec, { tiles: false, onChange: () => tilesBox.replaceChildren(...makeTiles()) }),
    h('section', { class: 'panel' },
      h('h3', {}, 'Promo posts'),
      withViews.length >= 2 ? [h('p', { class: 'muted small' }, 'Views per post (latest total)'), rankedBars(withViews.map(x => ({ label: postLabel(x.p), href: '#/posts/' + x.p.id, value: x.v.value })))] : null,
      posts.length ? h('div', { class: 'list' }, posts.map(postCard)) : h('p', { class: 'muted' }, 'No posts for this release yet. Open the release to plan some.')),
    h('section', { class: 'panel' },
      h('h3', {}, 'Checklist'),
      prog.total ? [
        h('div', { class: 'meter', role: 'img', 'aria-label': prog.done + ' of ' + prog.total + ' done' }, h('i', { style: 'width:' + meterPct + '%' })),
        h('p', { class: 'muted' }, prog.done + ' of ' + prog.total + ' done' + (next ? '. Next: ' + (next.text || 'Untitled item') + ', due ' + fmtDayLong(next.due) + '.' : '.')),
      ] : h('p', { class: 'muted' }, 'No checklist items yet.'),
      h('a', { class: 'btn', href: '#/releases/' + rec.id }, 'Open checklist')),
    tracks.length ? h('section', { class: 'panel' }, h('h3', {}, 'Tracklist'),
      h('div', { class: 'tracks' }, tracks.map((s, i) => h('div', { class: 'track-row' }, h('span', { class: 'track-no' }, String(i + 1)), h('a', { class: 'track-title', href: '#/songs/' + s.id }, s.title || 'Untitled'), pill(s.status))))) : null);
}
