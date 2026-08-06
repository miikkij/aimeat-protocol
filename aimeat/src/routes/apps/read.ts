/**
 * @file src/routes/apps/read.ts
 * @description App-catalog read routes: version list, fork list, lineage, screenshot GET/POST/DELETE,
 *   and the app download (GET /v1/apps/:owner/:filename incl. draft preview + H-2 app-origin redirect +
 *   copy-protection). Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 4 step 0a: the published app and the draft preview are
 *     served through appContentType(), so their `text/html` finally carries `charset=utf-8`. Without
 *     it the browser fell back to windows-1252 and every UTF-8 byte in the document arrived as
 *     mojibake — shipping since v1.3.0 in July, found when a Finnish compliance string rendered as
 *     `TekoÃ¤lyn tuottama`. Preceded by a scan of all 110 published apps for the double-encoding
 *     signature (0 found), because an HTTP charset overrides an app's own `<meta charset>`.
 *   v1.2.0 — 2026-07-30 — The inline + draft CSP now comes from utils/app-csp.ts (shared with the
 *     app origin) and permits WebAssembly compilation ('wasm-unsafe-eval'); wasm apps could not
 *     compile at all before, self-hosted bytes included. No 'unsafe-eval', no COOP/COEP.
 *   v1.1.0 — 2026-07-14 — Agent Face: the download route negotiates text/markdown (Accept or
 *     ?format=md) — serves the public apps.{filename}.agentface record (else converted HTML)
 *     with the agent-affordances footer, after the hidden/access-code/paid gates.
 *   v1.4.0 — 2026-08-07 — Protected app + browser navigation: a human unlock page with a code
 *     field (params preserved, bilingual) replaces the raw ACCESS_DENIED JSON that dead-ended
 *     even the owner's own Open button (UX-remake v3, P6). API callers keep the JSON.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { verifyDraftToken, DraftTokenError } from '../../services/draft-token.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { applyServeMarks } from '../../services/app-serve-marks.js';
import { appCsp } from '../../utils/app-csp.js';
import { appContentType } from '../../utils/app-content-type.js';
import { detectLocale } from '../../i18n.js';
import { collectAppLineage, resolveAppStatus } from '../../services/app-lineage.js';
import { applyAppProtection, hasAnyProtection } from '../../utils/app-protect.js';
import { prefersMarkdown } from '../../services/markdown-negotiation.js';
import { serveAppAgentFace } from '../../services/agent-face.js';
import { appOriginUrl, type CanonicalOwner } from './helpers.js';
import { logger } from '../../utils/logger.js';
import {
    loadServedProvenance, envelopeMeta, setProvenanceHeaders,
} from '../../services/ai-provenance-marks.js';

/**
 * The unlock page a BROWSER gets for a protected app instead of raw JSON: a code field that
 * resubmits the same URL as a plain GET, every non-code query param preserved as hidden inputs.
 * No script, minimal inline style (the global CSP allows 'unsafe-inline' styles). Bilingual by
 * Accept-Language; `wrongCode` distinguishes a bad code from a missing one.
 */
function accessCodeUnlockPage(req: { path: string; query: Record<string, unknown>; headers: Record<string, unknown> }, wrongCode: boolean): string {
    const fi = String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fi');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const hidden = Object.entries(req.query)
        .filter(([k, v]) => k !== 'code' && typeof v === 'string')
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v as string)}">`)
        .join('');
    const t = fi
        ? {
            title: 'Tämä appi on suojattu koodilla',
            lead: 'Appin omistaja on asettanut pääsykoodin. Syötä koodi avataksesi appin.',
            wrong: 'Koodi ei täsmännyt. Tarkista se ja yritä uudelleen.',
            label: 'Pääsykoodi', submit: 'Avaa appi',
        }
        : {
            title: 'This app is protected by a code',
            lead: 'The app\'s owner set an access code. Enter it to open the app.',
            wrong: 'That code did not match. Check it and try again.',
            label: 'Access code', submit: 'Open the app',
        };
    return `<!DOCTYPE html><html lang="${fi ? 'fi' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#FAFAF8;color:#1c1c1e;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
.card{background:#fff;border:1px solid #e3e3de;border-radius:12px;padding:2rem;max-width:420px;width:100%}
h1{font-size:1.15rem;margin:0 0 .5rem}p{font-size:.9rem;line-height:1.55;color:#555;margin:0 0 1rem}
.err{color:#c04b40}label{display:block;font-size:.8rem;color:#555;margin-bottom:.3rem}
input[type=text]{width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid #ccc;border-radius:8px;font-size:1rem;margin-bottom:1rem}
button{width:100%;padding:.7rem;border:0;border-radius:8px;background:#E8564A;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}</style></head>
<body><div class="card"><h1>${esc(t.title)}</h1><p>${esc(t.lead)}</p>${wrongCode ? `<p class="err">${esc(t.wrong)}</p>` : ''}
<form method="GET" action="${esc(req.path)}">${hidden}<label for="code">${esc(t.label)}</label>
<input type="text" id="code" name="code" autocomplete="off" autofocus required>
<button type="submit">${esc(t.submit)}</button></form></div></body></html>`;
}

export function registerReadRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    canonicalOwner: CanonicalOwner,
): void {
    // GET /v1/apps/:owner/:filename/versions — List all versions
    router.get('/v1/apps/:owner/:filename/versions', async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        // Tolerate the legacy full-GHII owner segment (owner@node) in old links.
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        // Apps live in the owner's canonical bucket (ownerGaii = owner@nodeId),
        // not under any agent GAII. Resolve the row by owner name, then list that
        // exact bucket so every published version is returned.
        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const versions = await storage.listAppVersions(app.ownerGaii, filename);
        // TARGET-058: per version, because each publish is its own content and carries its own
        // statement; `meta.provenance` is the LIVE version's, on the one envelope carrier.
        const prov = await loadServedProvenance(storage, config, app.aiProvenanceId);
        setProvenanceHeaders(res, prov);
        res.json(success(config.nodeId, {
            owner,
            filename,
            versions: versions.map(v => ({
                version_number: v.versionNumber,
                version: v.manifest.version,
                size: v.size,
                created_at: v.createdAt,
                ai_provenance_id: v.aiProvenanceId ?? null,
            })),
            total: versions.length,
        }, undefined, envelopeMeta(prov)));
    });

    // GET /v1/apps/:owner/:filename/forks — the direct forks of this app, each with
    // its CURRENT live status (public / parked / hidden / deleted). Public read; the
    // fork chain is public provenance. Answers "who forked this, when, and is it still
    // around?". Rows come from the append-only app_forks log, so a fork that was later
    // deleted still shows (as status: deleted).
    router.get('/v1/apps/:owner/:filename/forks', async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const events = await storage.listAppForks(app.ownerGaii, filename);
        const forks = await Promise.all(events.map(async (f) => ({
            owner: f.childOwnerName,
            filename: f.childFilename,
            forked_at: f.forkedAt,
            forked_by: f.forkedByGaii,
            status: await resolveAppStatus(storage, f.childOwnerName, f.childFilename),
            download_url: `/v1/apps/${encodeURIComponent(f.childOwnerName)}/${encodeURIComponent(f.childFilename)}`,
        })));
        res.json(success(config.nodeId, { owner: app.ownerName, filename, count: forks.length, forks }));
    });

    // GET /v1/apps/:owner/:filename/lineage — the full cross-owner fork tree: ancestry
    // (walking manifest.forkedFrom up) + descendants (walking app_forks down, which
    // survives deletions), every node carrying its live status. Public read. Feeds the
    // catalog's lineage view — "the chain of how different versions evolved from this".
    router.get('/v1/apps/:owner/:filename/lineage', async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        const lineage = await collectAppLineage(storage, owner, filename);
        if (!lineage) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }
        res.json(success(config.nodeId, lineage));
    });

    // GET /v1/apps/:owner/:filename/screenshot — Serve app screenshot (no auth)
    router.get('/v1/apps/:owner/:filename/screenshot', async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        // Tolerate the legacy full-GHII owner segment (owner@node) in old links.
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        // SECURITY: Defense-in-depth path traversal protection
        const decodedFn = decodeURIComponent(filename);
        if (decodedFn.includes('..') || decodedFn.includes('/') || decodedFn.includes('\\')
            || decodedFn.includes('%2f') || decodedFn.includes('%2F')
            || decodedFn.includes('%5c') || decodedFn.includes('%5C')
            || decodedFn.includes('\0')) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        // Screenshots are stored alongside the app under its ownerGaii bucket
        // (see POST /v1/apps), not under any agent GAII. Resolve the app first.
        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const screenshotKey = `apps/screenshots/${filename}`;
        const file = await storage.getStorageFile(app.ownerGaii, screenshotKey);
        if (file) {
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Length', file.size.toString());
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(file.data);
            return;
        }

        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Screenshot not found for app "${filename}"`));
    });

    // POST /v1/apps/:owner/:filename/screenshot — set/replace an app's screenshot WITHOUT
    // re-publishing it. The app's owner can set their own; a node operator can set any app's,
    // so the screenshot worker can backfill defaults for apps that have none. createStorageFile
    // upserts, so this overwrites an existing screenshot.
    router.post('/v1/apps/:owner/:filename/screenshot', requireAuth(), async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        const decodedFn = decodeURIComponent(filename);
        if (decodedFn.includes('..') || decodedFn.includes('/') || decodedFn.includes('\\')
            || decodedFn.includes('%2f') || decodedFn.includes('%2F')
            || decodedFn.includes('%5c') || decodedFn.includes('%5C')
            || decodedFn.includes('\0')) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        // Ownership: the app's owner, or a node operator (the screenshot worker runs as operator).
        const isOperator = req.auth!.roles?.includes('operator') ?? false;
        const { owner: callerOwner } = await canonicalOwner(req);
        if (!isOperator && callerOwner !== app.ownerName) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only set the screenshot for your own apps'));
            return;
        }

        const { screenshot, screenshot_mime_type } = req.body ?? {};
        if (!screenshot || typeof screenshot !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'screenshot (base64 image) is required'));
            return;
        }
        const screenshotData = decodeStrictBase64(screenshot);
        if (!screenshotData) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'screenshot must be base64-encoded image data'));
            return;
        }
        const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024;
        if (screenshotData.length > MAX_SCREENSHOT_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `Screenshot exceeds 2MB limit (${screenshotData.length} bytes)`));
            return;
        }
        const screenshotMime = typeof screenshot_mime_type === 'string' ? screenshot_mime_type : 'image/png';

        await storage.createStorageFile({
            key: `apps/screenshots/${filename}`,
            ownerGaii: app.ownerGaii,   // match the app row's bucket so the GET route finds it
            visibility: 'public',
            mimeType: screenshotMime,
            size: screenshotData.length,
            data: screenshotData,
            createdAt: new Date().toISOString(),
        });

        emitChange('apps');
        res.json(success(config.nodeId, {
            filename,
            owner: app.ownerName,
            screenshot_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(filename)}/screenshot`,
        }));
    });

    // DELETE /v1/apps/:owner/:filename/screenshot — clear an app's screenshot WITHOUT rendering a new
    // one. The node's scheduled auto-capture job regenerates it on its next scan. This is the
    // "refresh thumbnail" action: clearing is cheap and queues a batch recapture, so there is no
    // on-demand server render to hammer (DoS-safe). The app's owner, or a node operator, may clear.
    router.delete('/v1/apps/:owner/:filename/screenshot', requireAuth(), async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        const decodedFn = decodeURIComponent(filename);
        if (decodedFn.includes('..') || decodedFn.includes('/') || decodedFn.includes('\\')
            || decodedFn.includes('%2f') || decodedFn.includes('%2F')
            || decodedFn.includes('%5c') || decodedFn.includes('%5C')
            || decodedFn.includes('\0')) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const isOperator = req.auth!.roles?.includes('operator') ?? false;
        const { owner: callerOwner } = await canonicalOwner(req);
        if (!isOperator && callerOwner !== app.ownerName) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only clear the screenshot for your own apps'));
            return;
        }

        await storage.deleteStorageFile(app.ownerGaii, `apps/screenshots/${filename}`);
        emitChange('apps');
        res.json(success(config.nodeId, {
            filename,
            owner: app.ownerName,
            cleared: true,
            note: config.screenshotAutoCapture
                ? 'Screenshot cleared. The node will capture a fresh one on its next scheduled scan.'
                : 'Screenshot cleared. Auto-capture is off on this node — set a new one manually, or enable AIMEAT_SCREENSHOT_AUTO.',
        }));
    });

    // GET /v1/apps/:owner/:filename — Download app (supports ?version=N)
    router.get('/v1/apps/:owner/:filename', optionalAuth(), async (req, res) => {
        const owner = req.params.owner as string;
        const filename = req.params.filename as string;
        const code = (req.query.code as string) || req.headers['x-access-code'] as string | undefined;
        const versionParam = req.query.version as string | undefined;
        const version = versionParam ? parseInt(versionParam, 10) : undefined;

        // SECURITY: Defense-in-depth path traversal protection
        const decodedFilename = decodeURIComponent(filename);
        if (decodedFilename.includes('..') || decodedFilename.includes('/') || decodedFilename.includes('\\')
            || decodedFilename.includes('%2f') || decodedFilename.includes('%2F')
            || decodedFilename.includes('%5c') || decodedFilename.includes('%5C')
            || decodedFilename.includes('\0')) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        // ── Draft preview (staging) ──────────────────────────────────────────
        // A short-lived, signed draft-preview token serves the app's UNPUBLISHED
        // draft instead of the live version — so the owner can test the next
        // version end-to-end (real origin, real permissions: mic/camera work) on
        // the isolated app origin, while the LIVE app stays untouched for users.
        // The token is minted from the authenticated apex (POST .../draft/preview-token);
        // this origin needs no session — the token IS the authorization.
        const previewToken = req.query.preview as string | undefined;
        if (previewToken) {
            let claim;
            try {
                claim = await verifyDraftToken(previewToken);
            } catch (err) {
                const code = err instanceof DraftTokenError ? err.code : 'TOKEN_INVALID';
                res.status(403).json(error(config.nodeId, code, err instanceof Error ? err.message : 'Invalid draft preview token'));
                return;
            }
            // The token is scoped to one filename; the URL must match it.
            if (claim.filename !== filename) {
                res.status(403).json(error(config.nodeId, 'TOKEN_INVALID', 'Draft preview token does not match this app'));
                return;
            }
            const draftOwnerGhii = claim.sub;
            // H-2: never execute runnable draft HTML on the authenticated apex origin.
            // When the app origin is provisioned and this request is on the apex, 301 to
            // the isolated origin, preserving the preview token so the draft is served there.
            if (config.appOriginEnabled && config.appHost && !req.appOrigin) {
                const base = await appOriginUrl(config, storage, draftOwnerGhii, filename);
                const sep = base.includes('?') ? '&' : '?';
                res.redirect(301, `${base}${sep}preview=${encodeURIComponent(previewToken)}`);
                return;
            }
            const draft = await storage.getAppDraft(draftOwnerGhii, filename);
            if (!draft) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft exists for "${filename}"`));
                return;
            }
            res.setHeader('Content-Type', appContentType(draft.mimeType));
            const draftIsHtml = /html/i.test(draft.mimeType);
            const draftBody = draftIsHtml ? applyServeMarks(draft.data, { badge: true }) : draft.data;
            res.setHeader('Content-Length', draftBody.length.toString());
            // Same inline CSP a published app gets, so the draft behaves identically to
            // what it will once published. A draft is never cached (no-store).
            res.setHeader('Content-Security-Policy', appCsp());
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.status(200).send(draftBody);
            return;
        }

        let app = await storage.getAppByOwnerName(owner, filename, version);
        // Backward-compat: older links carry the full GHII (`owner@node`) as the
        // owner segment. ownerName is now normalized to the bare name, so retry
        // with the bare prefix when the literal lookup misses.
        if (!app && owner.includes('@')) {
            app = await storage.getAppByOwnerName(owner.split('@')[0], filename, version);
        }
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"${version ? ` (version ${version})` : ''}`));
            return;
        }

        // Operator-hidden apps are removed from public view entirely: only the
        // owner (who still manages it, badged) and operators may fetch it. Anyone
        // else gets the same 404 as a non-existent app — the moderated app must
        // not be reachable by direct link either. Mirror the not-found message so
        // moderation status isn't leaked.
        if (app.operatorHidden) {
            const isOperator = !!req.auth?.roles?.includes('operator');
            let isOwner = false;
            if (req.auth) {
                const { owner: viewerOwner } = await canonicalOwner(req);
                isOwner = viewerOwner === app.ownerName;
            }
            if (!isOperator && !isOwner) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"${version ? ` (version ${version})` : ''}`));
                return;
            }
        }

        if (app.accessCode && app.accessCode !== code) {
            // The code gates OTHER people, never the app's own owner or an operator: an
            // authenticated owner request (the catalog's Details/version/fork fetches carry a
            // Bearer) used to 403 here silently, dead-ending the owner on their own app
            // (UX-remake v3, P6, measured).
            let codeExempt = false;
            if (req.auth) {
                if (req.auth.roles?.includes('operator')) codeExempt = true;
                else {
                    const { owner: viewerOwner } = await canonicalOwner(req);
                    codeExempt = viewerOwner === app.ownerName;
                }
            }
            if (!codeExempt) {
                // A browser NAVIGATION gets a human page with a code field instead of raw JSON
                // (the other half of the same measured dead end). API callers keep the JSON.
                if ((req.headers.accept ?? '').includes('text/html')) {
                    res.status(403).type('html').send(accessCodeUnlockPage(req, !!code));
                    return;
                }
                res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
                    'This app is protected. Provide the access code via ?code= query parameter or X-Access-Code header.'));
                return;
            }
        }

        // Paid app check: if marketplace enabled and app has a price, require valid license
        if (config.marketplaceEnabled && app.manifest.priceMorsels && app.manifest.priceMorsels > 0) {
            if (!req.auth) {
                res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED',
                    'This is a paid app. Authenticate and purchase it first via POST /v1/app-store/purchase'));
                return;
            }
            // Seller can always download their own app
            if (req.auth.sub !== app.ownerGaii) {
                const hasLicense = await storage.hasValidLicense(req.auth.sub, app.ownerGaii, filename);
                if (!hasLicense) {
                    res.status(402).json(error(config.nodeId, 'PURCHASE_REQUIRED',
                        `This app costs ${app.manifest.priceMorsels} morsels. Purchase it first via POST /v1/app-store/purchase`));
                    return;
                }
            }
        }

        // Agent Face: a request that prefers text/markdown (Accept negotiation, or an explicit
        // ?format=md) gets the app's markdown read-surface — the public apps.{filename}.agentface
        // record when declared, else the app HTML converted — with the node-generated affordances
        // footer. Runs AFTER the hidden/access-code/paid gates so a restricted app stays exactly
        // as restricted in markdown as in HTML. Browsers (Accept: text/html) are unaffected.
        if (req.query.format === 'md' || (req.query.format === undefined && prefersMarkdown(req))) {
            if (await serveAppAgentFace(res, config, storage, app)) return;
        }

        const mode = req.query.mode as string | undefined;

        // H-2: never serve RUNNABLE app HTML from the apex (authenticated SPA) origin.
        // When the app origin is provisioned (flag on) and this request arrived on the
        // apex, 301 inline (runnable) requests to the isolated app origin. The raw
        // download form (attachment, not executed) and access-code/paid apps stay on
        // apex for now. Requests already on the app origin (req.appOrigin) serve normally.
        if (mode === 'inline' && config.appOriginEnabled && config.appHost && !req.appOrigin) {
            const restricted = !!app.accessCode
                || (config.marketplaceEnabled && !!app.manifest.priceMorsels && app.manifest.priceMorsels > 0);
            if (!restricted) {
                const target = await appOriginUrl(config, storage, owner, filename);
                res.redirect(301, target);
                return;
            }
        }

        // Copy-protection `noRawDownload`: the owner can block the raw (attachment)
        // source download so the app is only delivered in runnable inline form. The
        // owner + operators may still download their own source (backup/management).
        if (mode !== 'inline' && app.manifest.protection?.noRawDownload) {
            const isOperator = !!req.auth?.roles?.includes('operator');
            let isOwner = false;
            if (req.auth) { const { owner: viewerOwner } = await canonicalOwner(req); isOwner = viewerOwner === app.ownerName; }
            if (!isOperator && !isOwner) {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'This app is not available as a raw download. Open it inline (runnable) instead.'));
                return;
            }
        }

        // charset=utf-8, via appContentType(): a bare `text/html` falls back to windows-1252 and
        // turns every UTF-8 byte in the document into mojibake. See utils/app-content-type.ts for
        // the corpus scan that had to happen before this could be declared.
        res.setHeader('Content-Type', appContentType(app.mimeType));

        // Inline (runnable) HTML gets the viral "back to {node} · publish your own
        // app" badge appended; the raw download (attachment) is served byte-for-byte.
        // Opt-in copy-protection (obfuscate / domainLock / watermark) is layered onto
        // the inline body only — a no-op unless the owner enabled a flag.
        const isHtml = /html/i.test(app.mimeType);
        // TARGET-058, SERVE TIME ONLY. The AI-disclosure marks (the `ai-disclosure` attribute, the
        // meta tag, the schema.org JSON-LD, the link to the record) are added to the bytes on their
        // way OUT and are never written back — `app.data` is what the author uploaded and stays
        // that way, which is what keeps the content hash in the provenance record meaningful. This
        // codebase has published from a served copy before; that is why this lives here and not in
        // the publish path. The raw (attachment) download stays byte-for-byte, so anyone verifying
        // the hash downloads the source rather than the rendered page.
        const prov = await loadServedProvenance(storage, config, app.aiProvenanceId);
        setProvenanceHeaders(res, prov);
        let body = (mode === 'inline' && isHtml)
            // The visible label rides ONLY on the inline (runnable) form. A raw download stays
            // byte-for-byte, which is what keeps the content hash in the record verifiable.
            ? applyServeMarks(app.data, {
                badge: true,
                provenance: prov,
                visibleLabel: { config, locale: detectLocale(req.headers['accept-language']) },
            })
            : app.data;
        if (mode === 'inline' && isHtml && hasAnyProtection(app.manifest.protection)) {
            body = applyAppProtection(body, {
                protection: app.manifest.protection!,
                config,
                viewer: req.auth?.sub ?? 'anon',
                appOwner: app.ownerName,
                appFilename: filename,
                version: app.versionNumber,
                servedAt: new Date().toISOString(),
            });
        }
        res.setHeader('Content-Length', body.length.toString());

        if (mode === 'inline') {
            // No apex argument: this response comes FROM the apex, so 'self' already covers it.
            res.setHeader('Content-Security-Policy', appCsp());
            // Force browsers to always validate with the server (ETag round-trip).
            // Without this, heuristic caching can keep users on a stale app
            // version for hours after a republish. We still respond 304 when
            // the ETag matches, so the bandwidth cost is just a HEAD-sized hit.
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\\]/g, '_')}"`);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');

        storage.incrementAppDownloads(app.ownerGaii, filename).catch(err => { logger.warn('body: continuing after a suppressed failure', { error: String(err) }); });

        res.send(body);
    });
}
