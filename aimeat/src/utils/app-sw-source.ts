/**
 * @file src/utils/app-sw-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text of the app-origin service workers, read off disk once so a route can serve
 *   them on a published app's own origin: /sw.js (push only) and /sw-offline.js (push plus the kept
 *   copy of the app's page, for an app that opens with no connection). The workers themselves are
 *   real files (src/static/app-sw.js, src/static/app-sw-offline.js), not template strings in this
 *   module: they have to stay something `node --check` can parse and an editor can open, because a
 *   classic worker fails by REJECTING REGISTRATION with no visible error on the page
 *   (public/sw.js v1.2.0).
 *
 *   NEITHER IS public/sw.js. That one is the apex SPA's worker and carries the share-target intake,
 *   the offline page and cache management; none of it belongs on an app origin. A route serving
 *   /sw.js for an app origin must be registered BEFORE the express.static(publicDir) mount, which
 *   would otherwise answer /sw.js with the apex worker on every host (static-files.ts says so).
 * @structure appOriginServiceWorker() and appOriginOfflineWorker(): the worker source, or null when
 *   the static tree was not shipped with this node. Each is cached after its first successful read.
 * @usage
 *   import { appOriginServiceWorker } from '../utils/app-sw-source.js';
 *   const sw = appOriginServiceWorker();
 *   if (!sw) return next();
 *   res.setHeader('Cache-Control', 'no-cache');
 *   res.setHeader('Service-Worker-Allowed', '/');
 *   res.type('application/javascript').send(sw);
 * @version-history
 *   v1.1.0 — 2026-11-10 — appOriginOfflineWorker(): the worker of an app that opens with no
 *     connection (src/static/app-sw-offline.js).
 *   v1.0.0 — 2026-09-15 — Initial, for "an installed app receives push on its own origin".
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../server-bootstrap/asset-dirs.js';

/** The worker texts once read, by file name. A missing key means "not looked for yet"; `null` means "not there". */
let cached: Record<string, string | null> = {};

/**
 * One worker file's source, or null when this node ships no static/ tree or the file is not in it.
 *
 * resolveAssetDir carries the four layouts the node runs in, and it exists because src/static is
 * the one asset tree whose name CHANGES in the package (src/static → dist/static): every
 * npm-installed node served no /app-login.js at all until that was found in production. Do not
 * hand-roll the path here; ask the same helper the static mount asks.
 */
function workerSource(file: string): string | null {
  if (file in cached) return cached[file];
  const staticDir = resolveAssetDir('static', dirname(fileURLToPath(import.meta.url)), process.cwd());
  if (!staticDir) {
    cached = { ...cached, [file]: null };
    return null;
  }
  let text: string | null;
  try {
    text = readFileSync(join(staticDir, file), 'utf-8');
  } catch (err) {
    // The tree exists and the file in it does not, which is a packaging fault rather than a request
    // fault. Say so once at boot-adjacent time and let the route answer 404 instead of 500.
    console.warn(`[app-sw] src/static/${file} is not readable; app origins will not serve it: ${(err as Error).message}`);
    text = null;
  }
  cached = { ...cached, [file]: text };
  return text;
}

/** The app-origin service worker source (push only), or null when this node ships no static/ tree. */
export function appOriginServiceWorker(): string | null {
  return workerSource('app-sw.js');
}

/** The source of the worker for an app that opens with no connection, or null when it is not shipped. */
export function appOriginOfflineWorker(): string | null {
  return workerSource('app-sw-offline.js');
}
