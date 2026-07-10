/**
 * @file db.js
 * @description Local catalog data layer — IndexedDB, per-mode (Global shared vs Personal
 *   per-account). Encapsulates the DB handle + current mode as module-private state and exposes
 *   the app CRUD + mode get/set/close, so UI actions (switchDbMode) live in the feature layer.
 *   Carved from the former monolithic main.js.
 * @usage import { getAllApps, saveApp, deleteApp, getDbMode, setDbMode, closeDbInstance } from './db.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 2).
 */

const DB_NAME_GLOBAL = 'AppLauncherDB';
const DB_VERSION = 2;
const STORE_NAME = 'apps';

let dbInstance = null;
let currentDbMode = localStorage.getItem('appCatalogMode') || 'global';

export function getDbMode() { return currentDbMode; }

export function setDbMode(mode) {
  currentDbMode = mode;
  try { localStorage.setItem('appCatalogMode', mode); } catch (e) { /* private mode */ }
}

export function closeDbInstance() {
  if (dbInstance) { try { dbInstance.close(); } catch (e) {} dbInstance = null; }
}

/** DB name is per-account in Personal mode (falls back to the shared Global DB otherwise). */
export function getDbName() {
  if (currentDbMode === 'personal') {
    var owner = null;
    try {
      if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
        owner = window.AIMEAT.auth.getSession().owner || null;
      }
      if (!owner) {
        var stored = localStorage.getItem('aimeat_session');
        if (stored) owner = JSON.parse(stored).owner || null;
      }
    } catch (e) {}
    if (owner) return DB_NAME_GLOBAL + '_' + owner;
  }
  return DB_NAME_GLOBAL;
}

export function openDB() {
  var name = getDbName();
  if (dbInstance && dbInstance.name === name) return Promise.resolve(dbInstance);
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      var store;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('tags', 'tags', { multiEntry: true });
        store.createIndex('source', 'source', { unique: false });
        store.createIndex('favorite', 'favorite', { unique: false });
        store.createIndex('sortOrder', 'sortOrder', { unique: false });
      } else {
        store = event.target.transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('sortOrder')) {
          store.createIndex('sortOrder', 'sortOrder', { unique: false });
        }
      }
    };
    request.onsuccess = function (event) { dbInstance = event.target.result; resolve(dbInstance); };
    request.onerror = function (event) { reject(event.target.error); };
  });
}

export function getAllApps() {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  });
}

export function saveApp(app) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(app);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}

export function deleteApp(id) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  });
}
