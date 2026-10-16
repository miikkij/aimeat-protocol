/**
 * @file src/middleware/page-host-only.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page host answers the page frame and nothing else. Every other route of the node
 *   (the API, the SPA, the static files, the sign-in) would otherwise answer on `pages.<apex>` too, the
 *   way they answer on an app host, and a host whose whole point is to hold nobody's session has no
 *   reason to serve the pages that make one. Its root goes to the node's own address; everything but
 *   GET and HEAD of `/p/…` (routes/page-host.ts) is 404. Mounted right after subdomainMiddleware,
 *   ahead of the static files.
 * @structure pageHostOnly(config)
 * @usage app.use(pageHostOnly(config)); // after subdomainMiddleware
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';

export function pageHostOnly(config: AimeatConfig): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.pageOrigin) { next(); return; }
        const read = req.method === 'GET' || req.method === 'HEAD';
        if (read && req.path.startsWith('/p/')) { next(); return; }
        if (read && req.path === '/') { res.redirect(302, `${config.baseUrl}/`); return; }
        res.status(404).type('text/plain; charset=utf-8').send('Not found');
    };
}
