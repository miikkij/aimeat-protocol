/**
 * @file db.js
 * @description Transient in-memory working-set for the catalog. The catalog is SERVER-ONLY —
 *   there is no browser persistence (no IndexedDB). This module holds a page-session array of
 *   app records that the detail view materializes on demand for editing (downloaded from the
 *   server, edited in memory, then published back). The set is empty on every load and rebuilt
 *   from the server; nothing here survives a reload. Keeps the getAllApps/saveApp/deleteApp
 *   surface the rest of the catalog imports, so callers are unchanged.
 * @usage import { getAllApps, saveApp, deleteApp } from './db.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 2).
 *   v2.0.0 — 2026-07-20 — Server-only catalog: drop IndexedDB + the Shared/Mine DB-mode entirely;
 *     back the same CRUD surface with a transient in-memory working-set (no browser persistence).
 */

// Page-session working set. Holds only transient records the detail view materialized for editing;
// empty on load, discarded on unload. NOT a store — the server is the sole source of truth.
let workingSet = [];

/** Resolve the current working set (a copy so callers can't mutate our array by reference). */
export function getAllApps() {
  return Promise.resolve(workingSet.slice());
}

/** Upsert a transient record by id (in memory only — persistence is publishing to the server). */
export function saveApp(app) {
  if (app && app.id) {
    var idx = workingSet.findIndex(function (a) { return a.id === app.id; });
    if (idx >= 0) workingSet[idx] = app; else workingSet.push(app);
  }
  return Promise.resolve();
}

/** Drop a transient record by id (does NOT delete the server app — that is deleteServerApp). */
export function deleteApp(id) {
  workingSet = workingSet.filter(function (a) { return a.id !== id; });
  return Promise.resolve();
}
