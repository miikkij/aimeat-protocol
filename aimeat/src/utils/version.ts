/**
 * @file version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolve the running AIMEAT software version (from aimeat/package.json) at runtime,
 *   cached. Used to advertise the node's version to the federation (well-known, heartbeat, node-card)
 *   so peers can see which AIMEAT each other runs and infer feature gaps. Tries the candidate paths
 *   that work in both dev (src/utils → aimeat/) and the built dist layout (dist/src/utils → aimeat/).
 * @structure getSoftwareVersion(): string · versionAtLeast(version, floor): boolean
 * @usage import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
 * @version-history
 *   v1.1.0 — 2026-10-12 — versionAtLeast(), the comparison a *_REMOVED_IN gate makes, for the MCP
 *     OAuth gate (mcp/oauth-binding.ts). config-pacing.ts and config-federation.ts keep their own copy.
 *   v1.0.0 — 2026-06-19 — Initial runtime version resolver (federation version visibility).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cached: string | null = null;

/** The AIMEAT software version (e.g. "1.25.1"), or "unknown" if package.json can't be located. */
export function getSoftwareVersion(): string {
  if (cached !== null) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: src/utils → ../../ = aimeat ; dist: dist/src/utils → ../../../ = aimeat
  const candidates = [join(here, '..', '..', 'package.json'), join(here, '..', '..', '..', 'package.json')];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf-8')) as { name?: string; version?: string };
      if (pkg.version && (pkg.name === 'aimeat' || !pkg.name)) { cached = pkg.version; return cached; }
      if (pkg.version) { cached = pkg.version; return cached; }
    // eslint-disable-next-line aimeat/no-silent-catch -- try next candidate
    } catch { /* try next candidate */ }
  }
  cached = 'unknown';
  return cached;
}

/** True when `version` is at or past `floor`, compared part by part as numbers. An unparseable version is below every floor. */
export function versionAtLeast(version: string, floor: string): boolean {
  const a = version.split('.').map(n => parseInt(n, 10));
  const b = floor.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isFinite(a[i]) ? a[i] as number : -1;
    const y = Number.isFinite(b[i]) ? b[i] as number : 0;
    if (x !== y) return x > y;
  }
  return true;
}
