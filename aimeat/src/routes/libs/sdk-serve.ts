/**
 * @file sdk-serve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serving glue for the migrated SDK libraries. Each /v1/libs/aimeat-<name>.js route
 *   serves the committed, node-independent esbuild IIFE bundle (src/static/sdk-libs/dist/) with a
 *   tiny per-node config prelude prepended — `window.__AIMEAT_SDK_CFG__ = {…}` — which _core/config.js
 *   reads as the final fallback in its `<meta> → location.origin → prelude` resolution. This replaces
 *   the old build-time `${config.baseUrl}` / `${config.nodeId}` interpolation into a JS string.
 *   Bundles are read once and cached in memory; the prelude is the only per-request variance.
 * @structure configPrelude(config) · readSdkBundle(name) · sdkLibSource(config, name)
 * @usage import { sdkLibSource } from './libs/sdk-serve.js';  sendJavascriptLibrary(res, sdkLibSource(config, 'speech'));
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: prelude + committed-bundle serving (SDK-libs migration Phase 0).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Candidate locations of the committed dist bundles (dev tree, built dist, scaffolded CWD). */
const DIST_CANDIDATES = [
  join(__dirname, '..', '..', 'static', 'sdk-libs', 'dist'),          // dev: src/routes/libs → src/static/…
  join(__dirname, '..', '..', '..', 'static', 'sdk-libs', 'dist'),    // dist: dist/src/routes/libs → dist/static/…
  join(process.cwd(), 'static', 'sdk-libs', 'dist'),                  // scaffolded: CWD/static/…
];

/** Resolve the dist dir once (first candidate that exists), or the dev path as a last resort. */
const DIST_DIR = DIST_CANDIDATES.find((p) => existsSync(p)) ?? DIST_CANDIDATES[0];

/** In-memory cache of read bundles, keyed by library name. */
const bundleCache = new Map<string, string>();

/**
 * The per-node config prelude prepended to every served bundle. Injection-safe (JSON-encoded);
 * carries exactly the values the old inline bootstrap baked in: node id, apex base URL, heartbeat.
 */
export function configPrelude(config: AimeatConfig): string {
  const cfg = {
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
    heartbeatMs: config.personalNodeHeartbeatIntervalMs || 30000,
  };
  return `window.__AIMEAT_SDK_CFG__=${JSON.stringify(cfg)};\n`;
}

/** Read (and cache) the committed IIFE bundle for `name` → the static text served to every node. */
export function readSdkBundle(name: string): string {
  const cached = bundleCache.get(name);
  if (cached !== undefined) return cached;
  const source = readFileSync(join(DIST_DIR, `aimeat-${name}.js`), 'utf-8');
  bundleCache.set(name, source);
  return source;
}

/** The full served source for `/v1/libs/aimeat-<name>.js`: config prelude + committed bundle. */
export function sdkLibSource(config: AimeatConfig, name: string): string {
  return configPrelude(config) + readSdkBundle(name);
}
