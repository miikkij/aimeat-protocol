/**
 * @file src/routes/apps/catalogue-admin.ts
 * @description App-catalog listing + operator moderation routes: GET /v1/apps, GET /v1/admin/apps,
 *   /v1/admin/apps/similar, /v1/admin/apps/watermark/decode, /v1/admin/apps/:owner/:filename/moderate,
 *   DELETE /v1/admin/apps/:owner/:filename. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PeerInfo } from '../../services/federation.js';
import { requireAuth, optionalAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { randomBytes } from 'node:crypto';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { decodeWatermark } from '../../utils/app-protect.js';
import { scanCatalogForCopies } from '../../services/app-similarity.js';
import type { CanonicalOwner } from './helpers.js';

export function registerCatalogueAdminRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
    canonicalOwner: CanonicalOwner,
): void {
    // GET /v1/apps — Catalogue listing with search/filter/pagination
    router.get('/v1/apps', optionalAuth(), async (req, res) => {
        // Parked + operator-hidden apps are hidden from the public listing but must
        // still show to their OWNER. Resolve the authenticated caller's owner GHII
        // (if any) and hand it to listApps as viewerGhii — visibility is decided
        // purely from who is authenticated: the owner sees their own (hidden ones
        // carry operator_hidden=true so the client badges them), everyone else does
        // not. No client flag needed.
        let viewerGhii: string | undefined;
        if (req.auth) {
            const { ownerGhii } = await canonicalOwner(req);
            viewerGhii = ownerGhii;
        }
        const opts = {
            category: req.query.category as string | undefined,
            q: req.query.q as string | undefined,
            tag: req.query.tag as string | undefined,
            sort: (req.query.sort as 'newest' | 'popular' | undefined) || 'newest',
            limit: Math.min(parseInt(req.query.limit as string) || 50, 200),
            offset: parseInt(req.query.offset as string) || 0,
            freeOnly: req.query.free_only === 'true',
            viewerGhii,
        };

        const { apps, total } = await storage.listApps(opts);

        const result = await Promise.all(apps.map(async (app) => {
            const downloads = await storage.getAppDownloads(app.ownerGaii, app.filename);
            const forks = await storage.countAppForks(app.ownerGaii, app.filename);
            const screenshotFile = await storage.getStorageFile(app.ownerGaii, `apps/screenshots/${app.filename}`);
            const hasScreenshot = !!screenshotFile;
            return {
                owner: app.ownerName,
                filename: app.filename,
                version_number: app.versionNumber,
                manifest: app.manifest,
                size: app.size,
                mime_type: app.mimeType,
                protected: !!app.accessCode,
                parked: !!app.parked,
                forkable: !!app.forkable,
                operator_hidden: !!app.operatorHidden,
                operator_hide_reason: app.operatorHideReason ?? null,
                has_screenshot: hasScreenshot,
                downloads,
                forks,
                download_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`,
                screenshot_url: hasScreenshot ? `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/screenshot` : null,
                created_at: app.createdAt,
            };
        }));

        // Federated peer apps (H1 + H2)
        const peerApps: Record<string, unknown>[] = [];
        if (req.query.include_peers === 'true' && peers.size > 0) {
            const activePeers = Array.from(peers.values()).filter(p => p.status === 'active');
            const queryParams = new URLSearchParams();
            if (opts.category) queryParams.set('category', opts.category);
            if (opts.q) queryParams.set('q', opts.q);
            if (opts.tag) queryParams.set('tag', opts.tag);
            if (opts.sort) queryParams.set('sort', opts.sort);
            if (opts.freeOnly) queryParams.set('free_only', 'true');
            queryParams.set('limit', String(opts.limit));
            queryParams.set('offset', '0');
            const qs = queryParams.toString();

            const peerResults = await Promise.allSettled(
                activePeers.map(async (peer) => {
                    const ssrfCheck = await validateOutboundUrl(peer.url);
                    if (!ssrfCheck.valid) return [];
                    const resp = await fetch(`${peer.url}/v1/apps?${qs}`, {
                        signal: AbortSignal.timeout(5_000),
                    });
                    if (!resp.ok) return [];
                    const json = await resp.json() as { data?: { apps?: Record<string, unknown>[] } };
                    const apps = json.data?.apps ?? [];
                    return apps.map(a => ({ ...a, _peer_node: peer.nodeId, _peer_url: peer.url }));
                })
            );

            for (const r of peerResults) {
                if (r.status === 'fulfilled') peerApps.push(...r.value);
            }
        }

        res.json(success(config.nodeId, {
            apps: result,
            total,
            offset: opts.offset,
            limit: opts.limit,
            ...(peerApps.length > 0 ? { peer_apps: peerApps } : {}),
        }));
    });

    // ── Operator moderation ──────────────────────────────────────────────
    // GET /v1/admin/apps — operator-only: list EVERY app on the node (all owners,
    // including parked + operator-hidden) for the admin moderation surface. Static
    // path, registered before the parameterized download route below.
    router.get('/v1/admin/apps', requireAuth(), requireRole('operator'), async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);
        const offset = parseInt(req.query.offset as string) || 0;
        const { apps, total } = await storage.listApps({ adminView: true, limit, offset, sort: 'newest' });

        const result = await Promise.all(apps.map(async (app) => {
            const downloads = await storage.getAppDownloads(app.ownerGaii, app.filename);
            const forks = await storage.countAppForks(app.ownerGaii, app.filename);
            return {
                owner: app.ownerName,
                filename: app.filename,
                version_number: app.versionNumber,
                manifest: app.manifest,
                size: app.size,
                mime_type: app.mimeType,
                protected: !!app.accessCode,
                parked: !!app.parked,
                forkable: !!app.forkable,
                operator_hidden: !!app.operatorHidden,
                operator_hidden_by: app.operatorHiddenBy ?? null,
                operator_hidden_at: app.operatorHiddenAt ?? null,
                operator_hide_reason: app.operatorHideReason ?? null,
                downloads,
                forks,
                download_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`,
                created_at: app.createdAt,
            };
        }));

        res.json(success(config.nodeId, { apps: result, total, offset, limit }));
    });

    // GET /v1/admin/apps/similar — operator-only: catalog-wide unattributed-copy scan. Flags
    // apps whose content closely matches another they are NOT fork-linked to (copied without
    // forking), plus any watermark evidence (a stored app that embeds another app's per-serve
    // fingerprint). A moderation SIGNAL to review, not proof. ?threshold=0..1 (default 0.7).
    router.get('/v1/admin/apps/similar', requireAuth(), requireRole('operator'), async (req, res) => {
        const thresholdRaw = parseFloat(req.query.threshold as string);
        const threshold = Number.isFinite(thresholdRaw) ? Math.min(1, Math.max(0.1, thresholdRaw)) : 0.7;
        const { apps } = await storage.listApps({ adminView: true, limit: 1000, sort: 'newest' });
        const result = scanCatalogForCopies(apps, config, { threshold });
        res.json(success(config.nodeId, {
            ...result,
            note: result.suspiciousPairs.length || result.watermarkHits.length
                ? 'Review these — high similarity or a watermark hit suggests a copy made without forking. This is a signal, not proof.'
                : 'No unattributed copies detected above the threshold.',
        }));
    });

    // POST /v1/admin/apps/watermark/decode — operator-only: trace a leaked copy. Given a
    // watermark token (the `iv:tag:ct` string or the full `<!--aimeat-wm:...-->` comment
    // pulled from a suspiciously-copied app), decode it back to which viewer was served
    // it, for which app/version, and when. Only decodable with the node key. Static path,
    // registered before the parameterized moderate route below.
    router.post('/v1/admin/apps/watermark/decode', requireAuth(), requireRole('operator'), async (req, res) => {
        const token = typeof req.body?.token === 'string' ? req.body.token : '';
        if (!token) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'token is required (the watermark string or the aimeat-wm comment from a leaked copy)'));
            return;
        }
        const decoded = decodeWatermark(token, config);
        if (!decoded) {
            res.status(422).json(error(config.nodeId, 'UNDECODABLE', 'Could not decode this watermark. It may be tampered, from another node, or the node has no encryption key configured.'));
            return;
        }
        res.json(success(config.nodeId, {
            viewer: decoded.viewer,
            app: decoded.app,
            version: decoded.version,
            served_at: decoded.servedAt,
            note: `This copy was served to "${decoded.viewer}" for app "${decoded.app}" (v${decoded.version}) at ${decoded.servedAt}.`,
        }));
    });

    // POST /v1/admin/apps/:owner/:filename/moderate — operator-only: hide or
    // un-hide an app from every public surface. Body: { hidden: boolean, reason?: string }.
    // Unlike the owner's `parked` toggle, only an operator can lift this.
    router.post('/v1/admin/apps/:owner/:filename/moderate', requireAuth(), requireRole('operator'), async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        const body = req.body ?? {};
        if (typeof body.hidden !== 'boolean') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'hidden must be a boolean'));
            return;
        }
        const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;

        // Resolve the app's canonical bucket from the owner name, then flag every
        // version row in that bucket.
        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const { owner: operatorName } = await canonicalOwner(req);
        const ok = await storage.setAppOperatorHidden(app.ownerGaii, filename, body.hidden, {
            by: operatorName,
            at: new Date().toISOString(),
            reason,
        });
        if (!ok) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        emitChange('apps');
        res.json(success(config.nodeId, {
            owner,
            filename,
            operator_hidden: body.hidden,
            operator_hide_reason: body.hidden ? (reason ?? null) : null,
            note: body.hidden
                ? 'App hidden by operator. It is removed from every public surface; the owner sees a "moderated by operator: hidden" badge but cannot unhide it.'
                : 'App restored. It is visible in the public catalogue again.',
        }));
    });

    // DELETE /v1/admin/apps/:owner/:filename — operator-only HARD delete. Removes
    // the app entirely from the node (every version row across every bucket for
    // that owner+filename, the download counter, and the screenshot). Unlike the
    // owner DELETE this targets ANY owner. Irreversible — the moderation hide is
    // the soft alternative.
    router.delete('/v1/admin/apps/:owner/:filename', requireAuth(), requireRole('operator'), async (req, res) => {
        const ownerParam = req.params.owner as string;
        const filename = req.params.filename as string;
        const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;

        // Sweep every bucket holding this owner+filename (handles legacy shadow
        // buckets), deleting all versions + the screenshot each time.
        let sweepCount = 0;
        for (;;) {
            const app = await storage.getAppByOwnerName(owner, filename);
            if (!app || app.ownerName !== owner) break;
            await storage.deleteApp(app.ownerGaii, filename);
            await storage.deleteStorageFile(app.ownerGaii, `apps/screenshots/${filename}`).catch(() => {});
            sweepCount++;
            if (sweepCount > 10) break; // safety cap, no real owner has >10 buckets
        }
        if (sweepCount === 0) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const { owner: operatorName } = await canonicalOwner(req);
        await storage.addSiteChangeLog({
            id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
            action: 'app_delete',
            summary: `Operator ${operatorName} deleted app "${filename}" owned by "${owner}" (all versions)`,
            changedBy: operatorName,
            changedAt: new Date().toISOString(),
        });

        emitChange('apps');
        res.json(success(config.nodeId, {
            owner,
            filename,
            deleted: true,
            note: 'App permanently deleted from the node (all versions + screenshot).',
        }));
    });
}
