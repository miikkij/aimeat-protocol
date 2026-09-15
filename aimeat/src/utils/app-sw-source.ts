/**
 * @file src/utils/app-sw-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text of the app-origin service worker, read off disk once so a route can serve
 *   it at /sw.js on a published app's own origin. The worker itself is a real file
 *   (src/static/app-sw.js), not a template string in this module: it has to stay something
 *   `node --check` can parse and an editor can open, because a classic worker fails by REJECTING
 *   REGISTRATION with no visible error on the page (public/sw.js v1.2.0).
 *
 *   IT IS NOT public/sw.js. That one is the apex SPA's worker and carries the share-target intake,
 *   the offline page and cache management; none of it belongs on an app origin. A route serving
 *   /sw.js for an app origin must be registered BEFORE the express.static(publicDir) mount, which
 *   would otherwise answer /sw.js with the apex worker on every host (static-files.ts says so).
 * @structure appOriginServiceWorker() — the worker source, or null when the static tree was not
 *   shipped with this node. Cached after the first successful read.
 * @usage
 *   import { appOriginServiceWorker } from '../utils/app-sw-source.js';
 *   const sw = appOriginServiceWorker();
 *   if (!sw) return next();
 *   res.setHeader('Cache-Control', 'no-cache');
 *   res.setHeader('Service-Worker-Allowed', '/');
 *   res.type('application/javascript').send(sw);
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial, for "an installed app receives push on its own origin".
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../server-bootstrap/asset-dirs.js';

/** The worker text once read. `undefined` means "not looked for yet"; `null` means "not there". */
let cached: string | null | undefined;

/**
 * The app-origin service worker source, or null when this node ships no static/ tree.
 *
 * resolveAssetDir carries the four layouts the node runs in, and it exists because src/static is
 * the one asset tree whose name CHANGES in the package (src/static → dist/static): every
 * npm-installed node served no /app-login.js at all until that was found in production. Do not
 * hand-roll the path here; ask the same helper the static mount asks.
 */
export function appOriginServiceWorker(): string | null {
  if (cached !== undefined) return cached;
  const staticDir = resolveAssetDir('static', dirname(fileURLToPath(import.meta.url)), process.cwd());
  if (!staticDir) {
    cached = null;
    return cached;
  }
  try {
    cached = readFileSync(join(staticDir, 'app-sw.js'), 'utf-8');
  } catch (err) {
    // The tree exists and the file in it does not, which is a packaging fault rather than a request
    // fault. Say so once at boot-adjacent time and let the route answer 404 instead of 500.
    console.warn(`[app-sw] src/static/app-sw.js is not readable; app origins will serve no /sw.js: ${(err as Error).message}`);
    cached = null;
  }
  return cached;
}
