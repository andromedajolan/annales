// IndexedDB wrapper. Database name is private to Annales: "annales-db".
// Every write resolves only when its transaction has completed.

const DB_NAME = 'annales-db';
const DB_VERSION = 2;

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('IndexedDB is not available in this browser.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1: songs, releases. v2: posts, metrics, templates. Stores are only ever added, never removed.
      for (const name of ['songs', 'releases', 'posts', 'metrics', 'templates']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('Could not open the database.')); };
    req.onblocked = () => { dbPromise = null; reject(new Error('The database is blocked by another Annales tab. Close it and reload.')); };
  });
  return dbPromise;
}

function transaction(db, stores, mode) {
  try { return db.transaction(stores, mode, { durability: 'strict' }); }
  catch { return db.transaction(stores, mode); }
}

function run(stores, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = transaction(db, stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted.'));
    result = fn(tx);
  }));
}

export function getAll(store) {
  return open().then(db => new Promise((resolve, reject) => {
    const req = transaction(db, [store], 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const put = (store, rec) => run([store], 'readwrite', tx => { tx.objectStore(store).put(rec); });
export const del = (store, id) => run([store], 'readwrite', tx => { tx.objectStore(store).delete(id); });

// Write and delete across several stores in one atomic transaction.
// ops: { songs: { put: [], del: [] }, releases: { put: [], del: [] } }
export function batch(ops) {
  const stores = Object.keys(ops);
  return run(stores, 'readwrite', tx => {
    for (const s of stores) {
      const os = tx.objectStore(s);
      for (const id of ops[s].del || []) os.delete(id);
      for (const rec of ops[s].put || []) os.put(rec);
    }
  });
}
