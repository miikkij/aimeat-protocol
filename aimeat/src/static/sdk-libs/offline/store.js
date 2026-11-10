/**
 * @file offline/store.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the aimeat-offline library keeps things on the device: one IndexedDB database
 *   of this origin, with a store for copies of data and a store for waiting changes. Each value is
 *   kept under a text key and carries the time it was written.
 *
 *   A BROWSER MAY REFUSE. A private window, a blocked site setting or a full disk gives no database.
 *   The library then keeps everything in the page's memory, so the app works until the page closes,
 *   and persistent() answers false so the app can say that nothing is kept.
 * @structure openStore() → { persistent, get, put, remove, keys }
 * @usage const store = openStore();  await store.put('copy', key, value);  const kept = await store.get('copy', key);
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-teht-v-t-todoist-kind-task-app-on-aimeat-with-agents-app-too).
 */

const DB_NAME = 'aimeat-offline';
const STORES = ['copy', 'queue'];

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise(function (resolve, reject) {
    /** @type {IDBOpenDBRequest} */
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = function () {
      STORES.forEach(function (name) { if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
    req.onblocked = function () { reject(new Error('The database is held open by another page')); };
  });
}

/**
 * The device's store, opened once per page. Every method resolves; none rejects.
 */
export function openStore() {
  /** @type {Record<string, Map<string, any>>} What is kept in memory when the browser gives no database. */
  const memory = { copy: new Map(), queue: new Map() };
  /** @type {Promise<IDBDatabase|null>} */
  const db = openDb().then(null, function (err) {
    console.warn('[aimeat-offline] this browser keeps nothing for this app; it works until the page closes:', err && err.message);
    return null;
  });

  /**
   * One request on one store, or the same done on the page's memory.
   * @param {string} store
   * @param {IDBTransactionMode} mode
   * @param {(s: IDBObjectStore) => IDBRequest} run
   * @param {(m: Map<string, any>) => any} inMemory
   */
  function ask(store, mode, run, inMemory) {
    return db.then(function (d) {
      if (!d) return inMemory(memory[store]);
      return new Promise(function (resolve) {
        /** @type {IDBRequest} */
        let req;
        try {
          const tx = d.transaction(store, mode);
          req = run(tx.objectStore(store));
          tx.oncomplete = function () { resolve(req.result); };
          tx.onerror = tx.onabort = function () {
            console.warn('[aimeat-offline] a write to the device failed:', tx.error && tx.error.message);
            resolve(undefined);
          };
        } catch (err) {
          console.warn('[aimeat-offline] the device store could not be used:', err && /** @type {Error} */ (err).message);
          resolve(undefined);
        }
      });
    });
  }

  return {
    /** True when the browser gave a database; false when everything lives in the page's memory. */
    persistent: function () { return db.then(function (d) { return !!d; }); },
    /** @returns {Promise<{ value: any, at: string } | null>} */
    get: function (store, key) {
      return ask(store, 'readonly', function (s) { return s.get(key); }, function (m) { return m.get(key); })
        .then(function (v) { return v && typeof v === 'object' && 'value' in v ? v : null; });
    },
    put: function (store, key, value) {
      const row = { value: value, at: new Date().toISOString() };
      return ask(store, 'readwrite', function (s) { return s.put(row, key); }, function (m) { m.set(key, row); return key; })
        .then(function (done) { return done !== undefined; });
    },
    remove: function (store, key) {
      return ask(store, 'readwrite', function (s) { return s.delete(key); }, function (m) { m.delete(key); return true; }).then(function () { return true; });
    },
    /** Every key of the store that starts with the prefix. @returns {Promise<string[]>} */
    keys: function (store, prefix) {
      return ask(store, 'readonly', function (s) { return s.getAllKeys(); }, function (m) { return Array.from(m.keys()); })
        .then(function (all) { return (Array.isArray(all) ? all : []).map(String).filter(function (k) { return k.indexOf(prefix) === 0; }); });
    },
  };
}
