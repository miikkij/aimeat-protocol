/**
 * @file src/middleware/app-ref-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Lets every REST route that addresses an app as `<owner>/<filename>` in its path take
 *   the app's name without `.html`: `/v1/apps/alice/lifecycle-central/tools` reaches the same route
 *   as `/v1/apps/alice/lifecycle-central.html/tools`.
 *
 *   WHY HERE. About a hundred routes in sixteen router files take `:owner/:filename`. Resolving the
 *   name in each handler is a hundred places to forget it in. This middleware runs once, before the
 *   routers, and rewrites the filename segment of the URL to the stored filename when the name as
 *   given names no app of that owner but the name with `.html` does (services/app/app-ref.ts, THE
 *   RULE). The routes then see the filename they always saw.
 *
 *   WHAT IT LEAVES ALONE. A segment that already ends in `.html` or `.htm`, a name that matches an app
 *   exactly, and a name that matches nothing (the route answers its own 404 with the name sent). The
 *   static routes that share the `/v1/apps/<a>/<b>` shape (`/v1/apps/ui/catalogue`,
 *   `/v1/apps/backup/inspect`, ...) are listed in RESERVED_APP_OWNER_SEGMENTS and never rewritten;
 *   test/unit/app-ref-path.test.ts fails when a new static route of that shape is not in the list.
 *   The routes where the owner is the caller (`/v1/apps/:filename`, `/v1/apps/me/:filename`) need
 *   the signed-in caller and resolve the name in their handler instead.
 * @structure APP_OWNER_FILENAME_PATHS · RESERVED_APP_OWNER_SEGMENTS · appRefPathMiddleware
 * @usage app.use(appRefPathMiddleware(storage)); // before the routers, in mountRoutes()
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Storage } from '../storage/interface.js';
import { findAppFilename, isHtmlAppFile } from '../services/app/app-ref.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/**
 * The path prefixes whose next two segments are `<owner>/<filename>`. Every route declared with
 * `:owner/:filename` in src/routes sits under one of these; the unit test holds the list to the code.
 */
export const APP_OWNER_FILENAME_PATHS: readonly string[] = [
  '/v1/apps/',
  '/v1/datamap/apps/',
  '/v1/admin/apps/',
  '/v1/admin/internet-openings/',
  '/v1/admin/app-party-registrations/',
  '/v1/use-with-ai/',
];

/**
 * First segments under `/v1/apps/` that belong to a static route, not to an owner: a request there
 * is never rewritten, whatever account carries the same name.
 */
export const RESERVED_APP_OWNER_SEGMENTS: ReadonlySet<string> = new Set(['backup', 'ui', 'visitors', 'cost', 'me']);

/**
 * The segment decoded, or null when it is not valid percent-encoding: such a segment names no app,
 * and the request goes on unchanged for the route to answer. Checked before decoding, so nothing is
 * thrown and caught here. A `%` must start two hex digits, and the bytes they make must be UTF-8.
 */
function decodeSegment(s: string): string | null {
  if (/%(?![0-9a-f]{2})/i.test(s)) return null;
  const bytes = s.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  const raw = Buffer.from(bytes, 'latin1');
  const text = raw.toString('utf8');
  return Buffer.from(text, 'utf8').equals(raw) ? text : null;
}

/** The middleware. Reads only; on a lookup failure it lets the request through unchanged. */
export function appRefPathMiddleware(storage: Pick<Storage, 'appFilenamesAmong'>): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const prefix = APP_OWNER_FILENAME_PATHS.find(p => req.path.startsWith(p));
    if (!prefix) return next();
    const rest = req.path.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return next();
    const owner = decodeSegment(parts[0]);
    const name = decodeSegment(parts[1]);
    if (!owner || !name || isHtmlAppFile(name)) return next();
    if (prefix === '/v1/apps/' && RESERVED_APP_OWNER_SEGMENTS.has(owner)) return next();
    try {
      const found = await findAppFilename(storage, { ownerName: localAccountName(owner) }, name);
      if (found.filename && found.filename !== name) {
        const q = req.url.indexOf('?');
        const query = q >= 0 ? req.url.slice(q) : '';
        parts[1] = encodeURIComponent(found.filename);
        req.url = prefix + parts.join('/') + query;
      }
    } catch (err) {
      logger.warn('app reference in path not resolved; the route sees the name as sent', { path: req.path, error: String(err) });
    }
    next();
  };
}
