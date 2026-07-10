/**
 * @file config.js
 * @description Catalog configuration persisted in localStorage — the DEFAULT_CONFIG shape plus
 *   load/save. The node URL is always forced to the serving origin (the standalone "point it at any
 *   node" story is retired), so loadConfig() is the single source of truth for aimeatUrl. Pure
 *   localStorage + window.location.origin; no other module state. Carved out of main.js so feature
 *   modules can read config without a cycle back through the entry module.
 * @usage import { loadConfig, saveConfig } from './config.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 5).
 */

const DEFAULT_CONFIG = {
  theme: 'light',
  defaultOpenMode: 'tab',
  aimeatUrl: window.location.origin,
  language: 'en'
};

export function loadConfig() {
  var cfg;
  try {
    cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem('appLauncherConfig') || '{}'));
  } catch (e) {
    cfg = Object.assign({}, DEFAULT_CONFIG);
  }
  // The catalog is SERVED BY its node and talks to it same-origin. The old "download it and point
  // it at any node" standalone story is retired: it forced CORS `*`, could never sign in from a
  // foreign origin (auth-lib loads same-origin), and is increasingly blocked by browsers' Private/
  // Local Network Access. localhost / aimeat-desktop / federation all work because each node serves
  // its OWN catalog same-origin. Always use the serving origin as the node URL.
  cfg.aimeatUrl = window.location.origin;
  return cfg;
}

export function saveConfig(config) {
  localStorage.setItem('appLauncherConfig', JSON.stringify(config));
}
