/**
 * @file config.js
 * @description Shared SDK-libs core — resolves the node URL, apex URL, node id and heartbeat
 *   interval for every served AIMEAT browser helper library. Replaces the NODE_URL / APEX_URL /
 *   NODE_ID bootstrap that was copy-pasted (as JS-inside-a-template-string) into ~13 libs. The
 *   node-URL resolution order is preserved EXACTLY from the legacy libs:
 *   `<meta name="aimeat-node">` → `location.origin` (http/https) → the node-provided fallback,
 *   which is now injected as `window.__AIMEAT_SDK_CFG__` by a tiny prelude the route prepends at
 *   serve time (in place of the old build-time `${config.baseUrl}` interpolation).
 * @structure resolveNodeUrl() · NODE_URL · APEX_URL · NODE_ID · HEARTBEAT_MS
 * @usage import { NODE_URL, APEX_URL, NODE_ID } from '../_core/config.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted from the per-lib inline bootstrap (SDK-libs migration Phase 0).
 */

/**
 * @typedef {Object} SdkConfig
 * @property {string} nodeId    Node id baked by the serving node.
 * @property {string} baseUrl   Apex base URL baked by the serving node.
 * @property {number} [heartbeatMs] Personal-node heartbeat interval, in ms.
 */

/** @returns {SdkConfig} The serve-time config prelude, or empty defaults if absent. */
function cfg() {
  return window.__AIMEAT_SDK_CFG__ || { nodeId: '', baseUrl: '' };
}

/**
 * Resolve the node URL this library talks to. Order is unchanged from the legacy per-lib bootstrap:
 *   1. `<meta name="aimeat-node" content="…">` (trailing slash trimmed)
 *   2. `location.origin` on http/https
 *   3. the node-provided baseUrl fallback (serve-time prelude)
 * @returns {string}
 */
export function resolveNodeUrl() {
  const meta = document.querySelector('meta[name="aimeat-node"]');
  if (meta) return (meta.getAttribute('content') || '').replace(/\/$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return cfg().baseUrl;
}

/** The resolved node URL, evaluated once at load — same timing as the legacy IIFE bootstrap. */
export const NODE_URL = resolveNodeUrl();

/** The apex base URL baked by the serving node (used for the H-2 app-origin bridge). */
export const APEX_URL = cfg().baseUrl;

/** The serving node's id. */
export const NODE_ID = cfg().nodeId;

/** Personal-node heartbeat interval in ms (default 30000 — matches lib-tunnel's legacy default). */
export const HEARTBEAT_MS = cfg().heartbeatMs || 30000;
