// Annales entry point. Keep APP_VERSION in sync with VERSION in sw.js and "version" in suite-app.json.
import * as store from './store.js';
import * as ui from './ui.js';

export const APP_VERSION = '0.4.0';

const THEMES = ['dark', 'gray', 'light'];
const THEME_COLORS = { dark: '#111216', gray: '#25252b', light: '#f6f3f4' };

// ---- shared suite theme (the one key every app reads: studio.theme) ----
function applyTheme() {
  let t = 'dark';
  try { const v = localStorage.getItem('studio.theme'); if (THEMES.includes(v)) t = v; } catch { /* default */ }
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[t]);
}
applyTheme();
window.addEventListener('storage', e => { if (e.key === 'studio.theme') applyTheme(); });

// ---- service worker (offline) ----
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) { ui.setSwStatus('unsupported'); return; }
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to refresh
    ui.showBanner('A new version of Annales is ready.', 'Reload', () => { reloading = true; location.reload(); });
  });
  navigator.serviceWorker.register('sw.js', { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => ui.setSwStatus('ready'))
    .catch(() => ui.setSwStatus('unsupported'));
}

async function boot() {
  store.configure({ version: APP_VERSION });
  try {
    await store.load();
  } catch (err) {
    console.error(err);
    document.getElementById('app').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'pad warn',
      textContent: 'Annales could not open its storage: ' + (err && err.message ? err.message : 'unknown error') + ' Private/guest windows and some browser settings block it.',
    }));
    return;
  }
  ui.init({ version: APP_VERSION, applyTheme });
  setupServiceWorker();
  store.requestPersist();
  store.markOpened();

  // Never lose the last keystrokes: write pending edits whenever the page is hidden or closed.
  const flush = () => { store.stashPending(); store.flushAll(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(); else store.markOpened();
  });
  window.addEventListener('pagehide', flush);
}

boot();
