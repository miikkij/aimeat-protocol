/**
 * @file src/routes/page-host.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page frame: serves the HTML pages of workspaces on the page host
 *   (`config.pageHost`, e.g. pages.aimeat.io), at `/p/<frame token>/` and the page's own files beside
 *   it. It serves STORED content, the bytes a member wrote, the way an app origin serves an app's
 *   file; it builds no page of its own.
 *
 *   WHY IT CANNOT BE AN ATTACK. Two locks, each enough on its own for what it guards.
 *     1. The CSP `sandbox` directive (services/html-page.ts pageFrameCsp): the page runs in an opaque
 *        origin, so it has no cookie, no storage and no session, reads nothing of the node or of
 *        another page, and nothing it sends leaves (connect-src, form-action and frame-src 'none';
 *        images and media only from its own files). It cannot see who opens it.
 *     2. A host of its own. Should one response ever lose the sandbox, the page still runs on an
 *        origin that holds no session and is not the node's: H-2 moved apps off the apex in June
 *        2026 for exactly this.
 *   It is served ONLY into a frame (`Sec-Fetch-Dest: iframe`); a top-level open goes to the page's
 *   viewer, so the page never fills a tab of its own and never shows under its own address with
 *   nothing around it. Only the node's own pages may frame it (frame-ancestors).
 *
 *   The token (services/page-frame-token.ts) names the one record to serve; the node minted it after
 *   the caller passed the page's gate. A public page's share is read again here on every load, so a
 *   page whose share ended or was turned off stops loading at once.
 * @structure pageHostRouter(config, storage) — GET/HEAD /p/:token/{*path}
 * @usage app.use(pageHostRouter(config, storage)); // only answers on the page host
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { verifyPageFrameToken, PageFrameTokenError, type PageFrameClaims } from '../services/page-frame-token.js';
import { findWorkspaceRecord } from '../services/workspace-write.js';
import { readShareMetaOf, isDocPublicAt, publicViewerPath } from '../services/workspace-share.js';
import {
    isHtmlPageValue, pageFrameCsp, pageOriginOf, pageFileNameOk, isServablePageFileType, PAGE_PERMISSIONS_POLICY,
} from '../services/html-page.js';
import { withPageFrameShim } from '../utils/app-frame-assets.js';
import { localAccountName } from '../utils/gaii.js';
import { decodeUriSegment } from '../utils/uri-decode.js';
import { logger } from '../utils/logger.js';

/** Plain words for a refusal: the frame shows them in place of the page. */
function sendText(res: Response, status: number, words: string): void {
    res.status(status).type('text/plain; charset=utf-8').send(words);
}

/** Where a page opens for a person: the public viewer for a shared page, the member's own view otherwise. */
function viewerOf(config: AimeatConfig, c: PageFrameClaims): string {
    return c.k === 'pub'
        ? `${config.baseUrl}${publicViewerPath(c.org, c.ws, c.sp, c.id)}`
        : `${config.baseUrl}/v1/profile?tab=organisms`;
}

/** `/v1/pub/<owner>/<key>` (an upload's embed_url) or a bare storage key: the owner when it names one, and the key. */
function parseFileRef(ref: string): { owner?: string; key: string } | null {
    const path = ref.split(/[?#]/)[0];
    const m = path.match(/^(?:https?:\/\/[^/]+)?\/v1\/pub\/([^/]+)\/(.+)$/);
    if (m) {
        const owner = decodeUriSegment(m[1]);
        const segs = m[2].split('/').map(decodeUriSegment);
        if (owner === null || segs.some(s => s === null)) return null;
        return { owner, key: segs.join('/') };
    }
    if (/^\/?v1\//.test(path)) return null;
    return { key: path.replace(/^\/+/, '') };
}

/**
 * The stored file a page maps under `name`, or null. A file of the page's owner or one of their
 * agents is served; a file of anybody else only when its own visibility already lets this page's
 * readers see it: public, or bound to this workspace. A page never opens a file further than its
 * owner had.
 */
async function pageFile(
    storage: Storage, pageOwner: string, ref: string, c: PageFrameClaims,
): Promise<StorageFileRecord | null> {
    const parsed = parseFileRef(ref);
    if (!parsed || !parsed.key) return null;
    const account = localAccountName(pageOwner);
    const agents = await storage.getAgentsByOwner(account).catch(err => { logger.warn('page host: the owner\'s agents could not be listed', { error: String(err) }); return []; });
    const family = [pageOwner, ...agents.map(a => a.gaii)];
    const owners = parsed.owner ? [parsed.owner] : family;
    for (const owner of owners) {
        const file = await storage.getStorageFile(owner, parsed.key).catch(err => { logger.warn('page host: a page file could not be read', { error: String(err) }); return null; });
        if (!file) continue;
        if (family.includes(owner)) return file;
        if (file.visibility === 'public') return file;
        const refs = (file.workspaceRef ?? '').split(/\s+/).filter(Boolean);
        if (file.visibility === 'workspace' && refs.includes(`${c.org}/${c.ws}`)) return file;
        return null;
    }
    return null;
}

export function pageHostRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const pageOrigin = pageOriginOf(config);
    // An unparseable baseUrl has no apex to name in frame-ancestors, and leaves the page host inert.
    const apexOrigin = URL.canParse(config.baseUrl) ? new URL(config.baseUrl).origin : '';
    const csp = pageOrigin && apexOrigin ? pageFrameCsp(pageOrigin, apexOrigin) : '';

    const serve = async (req: Request, res: Response): Promise<void> => {
        if (!req.pageOrigin || !csp) { sendText(res, 404, 'Not found'); return; }
        let claims: PageFrameClaims;
        try {
            claims = await verifyPageFrameToken(String(req.params.token ?? ''));
        } catch (err) {
            if (!(err instanceof PageFrameTokenError)) throw err;
            sendText(res, 404, 'This page address has expired. Open the page again from the place it was shared in.');
            return;
        }
        const raw = req.params.path;
        const path = Array.isArray(raw) ? raw.join('/') : (typeof raw === 'string' ? raw : '');
        const isPage = path === '' || path === 'index.html';
        // Into a frame only. A browser that opens the address in a tab of its own is sent to the
        // page's viewer; one that says nothing about where the response goes is told so, because the
        // frame is the one place this page is allowed to run.
        const dest = req.get('sec-fetch-dest');
        if (dest === 'document' || (isPage && dest && dest !== 'iframe')) { res.redirect(302, viewerOf(config, claims)); return; }
        if (!dest) { sendText(res, 403, `This page opens inside its viewer: ${viewerOf(config, claims)}`); return; }

        const key = `organism.${claims.org}.w.${claims.ws}.${claims.ns}.${claims.id}.${claims.r}`;
        const rec = await findWorkspaceRecord(storage, key);
        if (!rec || !isHtmlPageValue(rec.value)) { sendText(res, 404, 'This page is no longer here.'); return; }
        if (claims.k === 'pub' && !isDocPublicAt(await readShareMetaOf(storage, config, claims.org, claims.ws), claims.sp, claims.id)) {
            sendText(res, 404, 'This page is no longer shared.');
            return;
        }

        // The same headers on the page and on every file of it: a file the frame navigates to is as
        // sandboxed as the page.
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', csp);
        res.setHeader('Permissions-Policy', PAGE_PERMISSIONS_POLICY);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // The token is in the path: no Referer may carry it to a library host the page loads from.
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

        if (isPage) {
            const buf = withPageFrameShim(rec.value.html);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('Content-Length', String(buf.length));
            if (req.method === 'HEAD') { res.end(); return; }
            res.send(buf);
            return;
        }
        const files = rec.value.files && typeof rec.value.files === 'object' ? rec.value.files : {};
        const ref = pageFileNameOk(path) ? files[path] : undefined;
        const file = typeof ref === 'string' ? await pageFile(storage, rec.ownerGaii, ref, claims) : null;
        if (!file || !isServablePageFileType(file.mimeType)) { sendText(res, 404, 'Not found'); return; }
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('Content-Length', String(file.data.length));
        if (req.method === 'HEAD') { res.end(); return; }
        res.send(file.data);
    };

    const guarded = (req: Request, res: Response): void => {
        serve(req, res).catch(err => {
            logger.warn('page host: a page could not be served', { error: String(err), path: req.path });
            if (!res.headersSent) sendText(res, 500, 'This page could not be loaded.');
        });
    };
    // The address of the page without its slash: the page's relative file names would resolve one
    // level up, so it moves to the address that ends in one.
    router.get('/p/:token', (req, res, next) => {
        if (!req.pageOrigin) { next(); return; }
        res.redirect(301, `/p/${encodeURIComponent(String(req.params.token))}/`);
    });
    router.get('/p/:token/{*path}', (req, res, next) => { if (!req.pageOrigin) { next(); return; } guarded(req, res); });
    router.head('/p/:token/{*path}', (req, res, next) => { if (!req.pageOrigin) { next(); return; } guarded(req, res); });
    return router;
}
