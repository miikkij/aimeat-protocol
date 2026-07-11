/**
 * @file apps.ts
 * @description App Catalog routes -- single-file HTML apps with manifest, version
 *   history, search, screenshot, and access-code-gated download. Apps are stored
 *   in the dedicated apps table. Each publish auto-increments the version number;
 *   old versions are preserved. Screenshots use the storage system with key prefix
 *   `apps/screenshots/`.
 * @structure
 *   - appsRouter() -- main router factory
 *   - GET /v1/apps -- catalogue listing
 *   - POST /v1/apps -- inline-upload OR presigned-upload publish
 *   - GET /v1/apps/:owner/:filename -- download
 *   - (plus version, delete, screenshot routes)
 * @version-history
 *   v1.0.0 -- pre-2026-05 -- Initial app catalog with versions, manifest, search
 *   v1.1.0 -- 2026-05-29 -- Add strict base64 validation to POST /v1/apps inline
 *     content path. Buffer.from(str, 'base64') silently dropped non-base64 chars
 *     and accepted raw HTML, yielding successful publishes with tiny garbage
 *     payloads served as 200 to downloaders. Now rejects with 400 INVALID_INPUT
 *     before storage write.
 *   v1.2.0 -- 2026-06-05 -- GET download tolerates the legacy full-GHII owner
 *     segment (owner@node) by retrying the lookup with the bare prefix, so links
 *     shared before ownerName normalization still resolve. Fix /versions and
 *     /screenshot routes: they scanned per-agent GAII buckets, but apps + their
 *     screenshots live in the owner's GHII bucket, so both 404'd for every app
 *     published under the current scheme. Now resolve the row via
 *     getAppByOwnerName() and read that bucket directly.
 *   v1.3.0 -- 2026-06-09 -- Canonicalize the owner before computing the storage
 *     bucket in publish/patch/delete (canonicalOwner): strip any @node suffix
 *     and resolve to the owner's GHII. The raw `owner` claim varies by identity
 *     form (dashboard bare name vs MCP/PAT full GHII), which forked the same
 *     owner's app into two buckets with independent version counters. The
 *     startup mergeForkedAppBuckets() migration consolidates pre-existing forks.
 *   v1.4.0 -- 2026-06-16 -- Record a public-activity-feed event on publish/update.
 *   v1.5.0 -- 2026-06-20 -- H-2: when the app origin is provisioned (config.appOriginEnabled),
 *     301-redirect apex inline (runnable) app requests to the isolated app origin
 *     (appOriginUrl: assigned subdomain, else apps.<apex>/<owner>/<file>).
 *   v1.6.0 -- 2026-06-20 -- Add POST /v1/apps/:owner/:filename/screenshot: set/replace an app's
 *     screenshot without re-publishing (owner OR operator). Backs the screenshot worker + manual
 *     override. createStorageFile upserts, so it overwrites any existing screenshot.
 *   v1.7.0 -- 2026-06-20 -- Require a non-empty description when publishing a NEW app (so the
 *     catalogue + landing wall always have one); on an update, carry the existing description
 *     forward when omitted so a re-publish / restore never blanks it.
 *   v1.8.0 -- 2026-06-20 -- appOriginUrl auto-assigns a per-app subdomain (ensureAppSubdomain) so the
 *     apex inline 301 lands on the app's own origin → seamless SSO works with no manual subdomain step.
 *   v1.9.0 -- 2026-06-20 -- Add DELETE /v1/apps/:owner/:filename/screenshot: clear a screenshot
 *     (owner OR operator) without rendering a new one — the scheduled auto-capture job recaptures it
 *     on its next scan (DoS-safe "refresh thumbnail", no on-demand render).
 *   v1.10.0 -- 2026-06-20 -- Parked-app state: GET /v1/apps takes optionalAuth and includes the
 *     caller's own parked apps (hidden from everyone else); responses carry `parked`; PATCH accepts
 *     a `parked` boolean (now field-aware so it no longer clears access_code on a parked-only call);
 *     a re-publish inherits the existing parked state.
 *   v1.11.0 -- 2026-06-24 -- Inline-served HTML apps get a small fixed "aimeat.io · publish your
 *     own app — free" attribution badge appended (injectAimeatBadge): a shared app link is often a
 *     visitor's first contact with AIMEAT, so give them a way to the project + a publish CTA.
 *     Permanent aimeat.io mark (free hosting), idempotent, HTML-only; raw download stays byte-exact.
 *     Content-Length now reflects the injected body.
 *   v1.12.0 -- 2026-06-24 -- Operator moderation: GET /v1/admin/apps (operator) lists every app
 *     including parked + operator-hidden; POST /v1/admin/apps/:owner/:filename/moderate hides/
 *     restores an app from EVERY public surface. operator-hidden apps drop out of /v1/apps for
 *     everyone but the owner (who gets a "moderated by operator: hidden" badge and cannot lift it)
 *     and 404 on direct download for non-owner/non-operator; the flag survives a re-publish so an
 *     owner cannot re-upload to escape moderation. Responses carry operator_hidden + reason.
 *   v1.13.0 -- 2026-06-25 -- Operator hard delete: DELETE /v1/admin/apps/:owner/:filename (operator)
 *     permanently removes an app (every version + screenshot, any owner) from the node — the
 *     irreversible counterpart to the moderation hide.
 *   v1.14.0 -- 2026-07-06 -- Inline-app CSP: font-src gains 'self' so an app can @font-face fonts
 *     from its own origin's public storage (/v1/pub/...). https: already covered prod app origins
 *     but not the http://*.apps.localhost dev origin; 'self' is a tightening-style addition
 *     (same-origin only), verified against the TDR-kit font test (securitypolicyviolation on dev).
 *   v1.15.0 -- 2026-07-07 -- Fork control + provenance: POST /v1/apps/:owner/:filename/fork copies an
 *     app into the caller's catalogue behind two gates — derivative permission (owner/their agents/
 *     operator always; outsiders only when `forkable`) and the paid-app paywall — stamping
 *     manifest.forkedFrom and recording an app_forks lineage event. PATCH accepts a `forkable`
 *     boolean; it survives a re-publish; responses carry `forkable`. Replaces the old client-only
 *     read+republish fork (which had no gate or provenance).
 *   v1.16.0 -- 2026-07-07 -- Fork stats + lineage (Phase 2): listings carry a `forks` count (direct
 *     children); GET /v1/apps/:owner/:filename/forks lists the direct forks with each one's live
 *     status (public/parked/hidden/deleted); GET .../lineage returns the full cross-owner fork tree
 *     (ancestry via forkedFrom + descendants via app_forks, surviving deletions) as nodes/edges.
 *   v1.17.0 -- 2026-07-07 -- Copy-protection (Phase 3): opt-in manifest.protection
 *     (obfuscate/domainLock/watermark/noRawDownload) accepted on publish + PATCH, carried forward on
 *     re-publish, applied to inline serves via applyAppProtection; the raw download 403s when
 *     noRawDownload is set (owner/operator exempt); POST /v1/admin/apps/watermark/decode traces a
 *     leaked fingerprint. Phase 4: GET /v1/admin/apps/similar flags unattributed copies (high
 *     similarity with no fork link) + watermark hits.
 *   v1.18.0 -- 2026-07-10 -- Re-publish carries category, usesCortex and icon forward when the
 *     caller omits them (matching description/protection), so an update never silently resets the
 *     manifest to category 'utility' + empty cortex refs + no icon (TARGET-021 Aalto 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, optionalAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { recordPublicActivity } from '../services/public-activity.js';
import { generateUploadToken } from '../services/upload-token.js';
import { generateDraftToken, verifyDraftToken, DraftTokenError } from '../services/draft-token.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { randomBytes } from 'node:crypto';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { decodeStrictBase64 } from '../utils/base64.js';
import { ensureAppSubdomain } from './subdomains.js';
import { injectAimeatBadge } from '../utils/app-badge.js';
import { collectAppLineage, resolveAppStatus } from '../services/app-lineage.js';
import { sanitizeProtection, applyAppProtection, invalidateProtectionCache, hasAnyProtection, decodeWatermark } from '../utils/app-protect.js';
import { scanCatalogForCopies } from '../services/app-similarity.js';
import type { AppProtection } from '../storage/interface.js';

/**
 * Build the app-origin URL an apex app request should 301 to (H-2). Prefers an
 * assigned per-app subdomain (`https://<sub>.apps.<apex>/`, which also isolates the
 * app from other apps), falling back to the shared path form
 * (`https://apps.<apex>/<owner>/<filename>`). Caller guarantees config.appHost is set.
 */
async function appOriginUrl(config: AimeatConfig, storage: Storage, owner: string, filename: string): Promise<string> {
    // Inherit scheme + port from the apex baseUrl and only swap the host, so the redirect is
    // correct both in prod (https://apps.aimeat.io) and locally (http://apps.localhost:40050).
    let scheme = 'https';
    let portSuffix = '';
    try {
        const base = new URL(config.baseUrl);
        scheme = base.protocol.replace(':', '');
        portSuffix = base.port ? `:${base.port}` : '';
    } catch { /* keep https, no port */ }
    const bareOwner = owner.includes('@') ? owner.split('@')[0] : owner;
    try {
        // Auto-assign a per-app subdomain on first open so seamless SSO works with no manual step
        // (existing apps migrate transparently); fall back to the shared path form only if none is free.
        const sub = await ensureAppSubdomain(storage, config, bareOwner, filename);
        if (sub) return `${scheme}://${sub}.${config.appHost}${portSuffix}/`;
    } catch { /* fall through to path form */ }
    return `${scheme}://${config.appHost}${portSuffix}/${encodeURIComponent(bareOwner)}/${encodeURIComponent(filename)}`;
}

export function appsRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Apps are OWNER-scoped. The same owner can authenticate under different
    // identity forms: the dashboard presents the bare owner name as the `owner`
    // claim, while MCP / a Personal Access Token presents the full GHII
    // (`owner@node`). Left unnormalized, those forks the owner into two app
    // buckets with independent version counters. Strip any `@node` suffix to a
    // single bare owner name, then resolve to the owner's canonical GHII via the
    // identity table — the SAME key the startup `mergeForkedAppBuckets()`
    // migration consolidates onto, so route and migration never diverge.
    const canonicalOwner = async (req: Express.Request): Promise<{ owner: string; ownerGhii: string }> => {
        const rawOwner = req.auth!.owner;
        const owner = rawOwner.includes('@') ? rawOwner.split('@')[0] : rawOwner;
        const ownerGhii = await resolveGhii(storage, owner, `${owner}@${config.nodeId}`);
        return { owner, ownerGhii };
    };

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
        res.json(success(config.nodeId, {
            owner,
            filename,
            versions: versions.map(v => ({
                version_number: v.versionNumber,
                version: v.manifest.version,
                size: v.size,
                created_at: v.createdAt,
            })),
            total: versions.length,
        }));
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
            res.setHeader('Content-Type', draft.mimeType);
            const draftIsHtml = /html/i.test(draft.mimeType);
            const draftBody = draftIsHtml ? injectAimeatBadge(draft.data) : draft.data;
            res.setHeader('Content-Length', draftBody.length.toString());
            // Same inline CSP a published app gets, so the draft behaves identically to
            // what it will once published. A draft is never cached (no-store).
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' blob: https: http://localhost:*; style-src 'self' 'unsafe-inline' https: http://localhost:*; img-src * data: blob:; font-src 'self' data: https:; connect-src 'self' https: http://localhost:* wss: ws: data:; worker-src blob:; object-src 'none'; frame-src 'self' blob: data: https: http://localhost:*; frame-ancestors 'self'");
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
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
                'This app is protected. Provide the access code via ?code= query parameter or X-Access-Code header.'));
            return;
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

        res.setHeader('Content-Type', app.mimeType);

        // Inline (runnable) HTML gets the viral "back to {node} · publish your own
        // app" badge appended; the raw download (attachment) is served byte-for-byte.
        // Opt-in copy-protection (obfuscate / domainLock / watermark) is layered onto
        // the inline body only — a no-op unless the owner enabled a flag.
        const isHtml = /html/i.test(app.mimeType);
        let body = (mode === 'inline' && isHtml) ? injectAimeatBadge(app.data) : app.data;
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
            // font-src includes 'self' so an app can load fonts from its own origin's public
            // storage (/v1/pub/...) — https: does not cover the http://*.apps.localhost dev origin.
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' blob: https: http://localhost:*; style-src 'self' 'unsafe-inline' https: http://localhost:*; img-src * data: blob:; font-src 'self' data: https:; connect-src 'self' https: http://localhost:* wss: ws: data:; worker-src blob:; object-src 'none'; frame-src 'self' blob: data: https: http://localhost:*; frame-ancestors 'self'");
            // Force browsers to always validate with the server (ETag round-trip).
            // Without this, heuristic caching can keep users on a stale app
            // version for hours after a republish. We still respond 304 when
            // the ETag matches, so the bandwidth cost is just a HEAD-sized hit.
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\\]/g, '_')}"`);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');

        storage.incrementAppDownloads(app.ownerGaii, filename).catch(() => { });

        res.send(body);
    });

    // POST /v1/apps — Publish/update an app (requires auth)
    router.post('/v1/apps', requireAuth(), async (req, res) => {
        // Apps are OWNER-scoped resources. Whether the owner or one of their
        // agents publishes, the canonical record lives under the owner's GHII
        // so `/v1/apps/<owner>/<filename>` resolves to a single row and the
        // version counter is shared (not two parallel buckets that shadow
        // each other). The caller's GAII is preserved in audit logs only.
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const {
            filename, content, mime_type, access_code,
            screenshot, screenshot_mime_type,
            name, description, version: semver, category, tags, icon,
            uses_cortex, price_morsels, license_type, protection,
        } = req.body ?? {};

        if (!filename || typeof filename !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'filename is required'));
            return;
        }

        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.'));
            return;
        }

        // --- PRESIGNED MODE: return upload URL instead of requiring content ---
        if (req.body.mode === 'presigned') {
            const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
            const token = await generateUploadToken({
                sub: ownerGhii,
                utype: 'app',
                meta: { filename, name: req.body.name ?? filename, description, category, tags, icon, version: semver },
                maxBytes: MAX_APP_SIZE,
                contentType: 'text/html',
            });

            res.json(success(config.nodeId, {
                upload_url: `${config.baseUrl}/v1/upload/${token}`,
                upload_method: 'PUT',
                content_type: 'text/html',
                max_size_bytes: MAX_APP_SIZE,
                expires_in_seconds: 3600,
            }));
            return;
        }

        if (!content || typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required (base64 encoded)'));
            return;
        }

        const data = decodeStrictBase64(content);
        if (!data) {
            res.status(400).json(error(
                config.nodeId,
                'INVALID_INPUT',
                'content must be base64-encoded. Encode with Buffer.from(html).toString("base64") (Node) or btoa(html) (browser). For files larger than 1 KB, prefer the presigned upload mode (mode: "presigned").',
            ));
            return;
        }
        const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
        if (data.length > MAX_APP_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `App file exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)`));
            return;
        }

        // Per-owner app count quota (only check for new apps, not updates).
        // Keyed by owner GHII so agents publishing on the owner's behalf share
        // the same counter — same resource, one quota.
        const existingVersion = await storage.getLatestVersionNumber(ownerGhii, filename);
        if (existingVersion === 0 && config.maxAppsPerAgent > 0) {
            const { total } = await storage.listApps({ ownerGaii: ownerGhii, limit: 1 });
            if (total >= config.maxAppsPerAgent) {
                res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', `You have reached the maximum of ${config.maxAppsPerAgent} published apps`));
                return;
            }
        }

        const mimeType = typeof mime_type === 'string' ? mime_type : 'text/html';

        const accessCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
        if (accessCode && (accessCode.length < 4 || accessCode.length > 64)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
            return;
        }

        // Auto-increment version number
        const newVersion = existingVersion + 1;
        const isUpdate = existingVersion > 0;

        // A description is REQUIRED for a NEW app, so the catalogue + the landing wall always have
        // one (your AI can write it). On an UPDATE, carry the existing description forward when it
        // is omitted, so a re-publish / restore never blanks it.
        let effectiveDescription = typeof description === 'string' ? description.trim() : '';
        if (!effectiveDescription) {
            if (isUpdate) {
                const existingApp = await storage.getApp(ownerGhii, filename);
                effectiveDescription = existingApp?.manifest?.description ?? '';
            } else {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A description is required when publishing a new app — write 1-2 sentences about what it does (your AI can write it for you).'));
                return;
            }
        }

        // Carry the parked state forward across re-publishes: a parked app stays
        // parked (hidden) when updated, so an update never silently re-exposes it.
        // New apps are published (not parked) by default.
        let parkedState = false;
        // The fork-permission flag must ALSO survive a re-publish, so an update never
        // silently opens or closes forking. New apps are not forkable by default.
        let forkableState = false;
        // Operator-hide must ALSO survive a re-publish — otherwise an owner could
        // simply re-upload to escape moderation. Carry the flag + audit forward.
        let operatorHiddenState = false;
        let operatorHiddenBy: string | undefined;
        let operatorHiddenAt: string | undefined;
        let operatorHideReason: string | undefined;
        // Copy-protection flags survive a re-publish too (an update never silently
        // drops the owner's protection), unless the update explicitly sends `protection`.
        let protectionState: AppProtection | undefined;
        // Category, cortex refs and icon must ALSO survive a re-publish — otherwise every update
        // silently reset them (category → 'utility', usesCortex → [], icon dropped). Carry them
        // forward when the caller omits them, matching description/protection above.
        let carriedCategory: string | undefined;
        let carriedUsesCortex: string[] | undefined;
        let carriedIcon: string | undefined;
        if (isUpdate) {
            const existingApp = await storage.getApp(ownerGhii, filename);
            parkedState = !!existingApp?.parked;
            forkableState = !!existingApp?.forkable;
            operatorHiddenState = !!existingApp?.operatorHidden;
            operatorHiddenBy = existingApp?.operatorHiddenBy;
            operatorHiddenAt = existingApp?.operatorHiddenAt;
            operatorHideReason = existingApp?.operatorHideReason;
            protectionState = existingApp?.manifest?.protection;
            carriedCategory = existingApp?.manifest?.category;
            carriedUsesCortex = existingApp?.manifest?.usesCortex;
            carriedIcon = existingApp?.manifest?.icon;
        }

        const now = new Date().toISOString();
        const manifest: AppManifest = {
            name: typeof name === 'string' ? name : filename.replace(/\.html?$/i, ''),
            description: effectiveDescription,
            version: typeof semver === 'string' ? semver : `1.0.${newVersion - 1}`,
            category: typeof category === 'string' ? category : (carriedCategory ?? 'utility'),
            tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [],
            authorDisplay: owner,
            usesCortex: Array.isArray(uses_cortex) ? uses_cortex.filter((c: unknown) => typeof c === 'string') : (carriedUsesCortex ?? []),
        };
        if (typeof icon === 'string') manifest.icon = icon;
        else if (carriedIcon) manifest.icon = carriedIcon;
        if (typeof price_morsels === 'number' && price_morsels > 0) manifest.priceMorsels = price_morsels;
        if (license_type === 'single' || license_type === 'lifetime') manifest.licenseType = license_type;
        // Opt-in copy-protection: use the body's `protection` when provided, else carry
        // the existing flags forward on an update. Only stored when at least one is on.
        const effectiveProtection = sanitizeProtection(protection) ?? protectionState;
        if (effectiveProtection && Object.values(effectiveProtection).some(Boolean)) {
            manifest.protection = effectiveProtection;
        }
        // A re-publish changes the bytes → drop any cached obfuscated/locked base.
        invalidateProtectionCache(owner, filename);

        await storage.createApp({
            ownerGaii: ownerGhii,   // canonical owner key (NOT caller GAII)
            ownerName: owner,
            filename,
            versionNumber: newVersion,
            manifest,
            mimeType,
            size: data.length,
            data,
            accessCode,
            parked: parkedState,
            forkable: forkableState,
            operatorHidden: operatorHiddenState,
            operatorHiddenBy,
            operatorHiddenAt,
            operatorHideReason,
            createdAt: now,
        });

        // Handle optional screenshot upload (still uses file storage)
        let hasScreenshot = false;
        if (screenshot && typeof screenshot === 'string') {
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
                ownerGaii: ownerGhii,   // match app row's ownerGaii so reads find it
                visibility: 'public',
                mimeType: screenshotMime,
                size: screenshotData.length,
                data: screenshotData,
                createdAt: now,
            });
            hasScreenshot = true;
        }

        const downloadUrl = `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`;

        const changeAction = isUpdate ? 'app_update' as const : 'app_publish' as const;
        await storage.addSiteChangeLog({
            id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
            action: changeAction,
            summary: `${isUpdate ? 'Updated' : 'Published'} app "${filename}" v${newVersion} (${(data.length / 1024).toFixed(1)} KB)`,
            changedBy: owner,
            changedAt: now,
        });

        // Board announcement (best-effort, don't fail the publish if posting fails)
        if (config.appAnnouncementBoardId) {
            try {
                const tags = Array.isArray(manifest.tags) ? manifest.tags : [];
                await storage.createPost({
                    id: `post-${Date.now()}-${randomBytes(4).toString('hex')}`,
                    boardId: config.appAnnouncementBoardId,
                    authorGaii: callerGaii,   // who actually clicked publish (audit/byline)
                    title: `${isUpdate ? '🔄' : '🚀'} ${manifest.name || filename} v${newVersion}`,
                    body: `${manifest.description || 'A new app has been published.'}\n\nDownload: ${downloadUrl}`,
                    tags,
                    reactions: {},
                    createdAt: now,
                });
            } catch { /* non-critical */ }
        }

        res.status(201).json(success(config.nodeId, {
            filename,
            version_number: newVersion,
            manifest,
            size: data.length,
            mime_type: mimeType,
            protected: !!accessCode,
            parked: parkedState,
            forkable: forkableState,
            has_screenshot: hasScreenshot,
            download_url: downloadUrl,
            versions_url: `${downloadUrl}/versions`,
            screenshot_url: hasScreenshot ? `${downloadUrl}/screenshot` : null,
            note: isUpdate
                ? `App updated to version ${newVersion}. Previous version${existingVersion > 1 ? 's are' : ' is'} preserved.`
                : 'App published. Others can download this file and open it locally.',
        }, [
            { description: 'View all versions', method: 'GET', url: `${downloadUrl}/versions` },
        ]));
        emitChange('apps');
        // Public landing feed — apps are public artifacts, so every publish/update qualifies.
        void recordPublicActivity(storage, config, {
            category: 'apps',
            actor: callerGaii,
            summary: `App ${manifest.name || filename} ${isUpdate ? 'updated' : 'published'} (v${newVersion})`,
            detail: manifest.description || '',
            link: `${downloadUrl}?mode=inline`,
        }).catch(() => { /* feed is best-effort */ });
    });

    // ── App drafts (staging): edit + test the NEXT version without touching the
    //    live one. A draft is a single unpublished slot per app; it is owner-only,
    //    never listed/public, and testable end-to-end (real origin → mic/camera,
    //    real permissions) via a short-lived signed preview token. Publishing the
    //    draft promotes it to a new version and clears the slot. ──────────────────

    // PUT /v1/apps/:owner/:filename/draft — save (upsert) the app's draft. The live
    // published versions are untouched. Manifest fields default from the current live
    // app when omitted, so a draft that only changes the HTML keeps its name/category.
    router.put('/v1/apps/:owner/:filename/draft', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
            return;
        }
        const { owner, ownerGhii } = await canonicalOwner(req);
        const { content, mime_type, name, description, category, tags, icon, uses_cortex, protection } = req.body ?? {};

        if (!content || typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required (base64 encoded)'));
            return;
        }
        const data = decodeStrictBase64(content);
        if (!data) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content must be base64-encoded (Buffer.from(html).toString("base64") / btoa(html)).'));
            return;
        }
        const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
        if (data.length > MAX_APP_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `Draft exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)`));
            return;
        }

        // Inherit the live app's manifest as the base (so a draft that only changes
        // HTML keeps its name/description/category/icon), overriding with any fields
        // the caller sent.
        const live = await storage.getApp(ownerGhii, filename);
        const base = live?.manifest;
        const manifest: AppManifest = {
            name: typeof name === 'string' ? name : (base?.name ?? filename.replace(/\.html?$/i, '')),
            description: typeof description === 'string' ? description : (base?.description ?? ''),
            version: base?.version ?? '1.0.0',
            category: typeof category === 'string' ? category : (base?.category ?? 'utility'),
            tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : (base?.tags ?? []),
            authorDisplay: owner,
            usesCortex: Array.isArray(uses_cortex) ? uses_cortex.filter((c: unknown) => typeof c === 'string') : (base?.usesCortex ?? []),
        };
        const effectiveIcon = typeof icon === 'string' ? icon : base?.icon;
        if (effectiveIcon) manifest.icon = effectiveIcon;
        const effectiveProtection = sanitizeProtection(protection) ?? base?.protection;
        if (effectiveProtection && Object.values(effectiveProtection).some(Boolean)) manifest.protection = effectiveProtection;

        const now = new Date().toISOString();
        await storage.saveAppDraft({
            ownerGaii: ownerGhii,
            ownerName: owner,
            filename,
            manifest,
            mimeType: typeof mime_type === 'string' ? mime_type : (live?.mimeType ?? 'text/html'),
            size: data.length,
            data,
            updatedAt: now,
        });

        res.json(success(config.nodeId, {
            filename,
            saved: true,
            size: data.length,
            updated_at: now,
            has_live_version: !!live,
            live_version_number: live?.versionNumber ?? 0,
            note: 'Draft saved. The live app is unchanged. Mint a preview token to test it, then publish the draft when ready.',
        }, [
            { description: 'Get a preview URL', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/preview-token` },
            { description: 'Publish the draft', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft` },
        ]));
    });

    // POST /v1/apps/:owner/:filename/draft/preview-token — mint a short-lived preview
    // URL for the draft. On a node with the app origin ON, the URL points at the
    // isolated app origin (a real, session-less origin where getUserMedia works); with
    // it OFF, at the apex inline URL. Either way it opens TOP-LEVEL as a clean page.
    router.post('/v1/apps/:owner/:filename/draft/preview-token', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        const { owner, ownerGhii } = await canonicalOwner(req);
        const draft = await storage.getAppDraft(ownerGhii, filename);
        if (!draft) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft exists for "${filename}". Save one with PUT .../draft first.`));
            return;
        }
        const ttlSeconds = 600;
        const token = await generateDraftToken({ sub: ownerGhii, filename }, ttlSeconds);
        let previewUrl: string;
        if (config.appOriginEnabled && config.appHost) {
            const originBase = await appOriginUrl(config, storage, owner, filename);
            const sep = originBase.includes('?') ? '&' : '?';
            previewUrl = `${originBase}${sep}preview=${encodeURIComponent(token)}`;
        } else {
            previewUrl = `${config.baseUrl}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline&preview=${encodeURIComponent(token)}`;
        }
        res.json(success(config.nodeId, {
            preview_url: previewUrl,
            token,
            expires_in_seconds: ttlSeconds,
            note: 'Open this URL in a new top-level tab to test the draft on a real origin (mic/camera prompts work). The link is single-app, owner-only, and expires shortly.',
        }));
    });

    // DELETE /v1/apps/:owner/:filename/draft — discard the draft. The live app is
    // untouched. Idempotent (404 only signals there was nothing to discard).
    router.delete('/v1/apps/:owner/:filename/draft', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        const { ownerGhii } = await canonicalOwner(req);
        const deleted = await storage.deleteAppDraft(ownerGhii, filename);
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to discard for "${filename}"`));
            return;
        }
        res.json(success(config.nodeId, { filename, discarded: true }));
    });

    // POST /v1/apps/:owner/:filename/publish-draft — promote the draft to a NEW live
    // version. Carries the live app's parked/forkable/protection/operator-hidden state
    // forward (exactly like a normal re-publish), then clears the draft slot. THIS is
    // the moment the live app changes + the public feed fires — saving/testing a draft
    // never does.
    router.post('/v1/apps/:owner/:filename/publish-draft', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);

        const draft = await storage.getAppDraft(ownerGhii, filename);
        if (!draft) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish for "${filename}". Save one with PUT .../draft first.`));
            return;
        }

        const existingVersion = await storage.getLatestVersionNumber(ownerGhii, filename);
        const isUpdate = existingVersion > 0;
        // New (first-version) draft counts against the per-owner app quota.
        if (!isUpdate && config.maxAppsPerAgent > 0) {
            const { total } = await storage.listApps({ ownerGaii: ownerGhii, limit: 1 });
            if (total >= config.maxAppsPerAgent) {
                res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', `You have reached the maximum of ${config.maxAppsPerAgent} published apps`));
                return;
            }
        }
        const newVersion = existingVersion + 1;

        // Carry live state forward, mirroring the re-publish path so publishing a draft
        // never silently re-exposes a parked app, drops protection, or escapes moderation.
        let parkedState = false, forkableState = false, operatorHiddenState = false;
        let operatorHiddenBy: string | undefined, operatorHiddenAt: string | undefined, operatorHideReason: string | undefined;
        let accessCode: string | undefined;
        if (isUpdate) {
            const live = await storage.getApp(ownerGhii, filename);
            parkedState = !!live?.parked;
            forkableState = !!live?.forkable;
            operatorHiddenState = !!live?.operatorHidden;
            operatorHiddenBy = live?.operatorHiddenBy;
            operatorHiddenAt = live?.operatorHiddenAt;
            operatorHideReason = live?.operatorHideReason;
            accessCode = live?.accessCode;
        }

        const now = new Date().toISOString();
        const manifest: AppManifest = { ...draft.manifest, version: draft.manifest.version || `1.0.${newVersion - 1}`, authorDisplay: owner };
        invalidateProtectionCache(owner, filename);

        await storage.createApp({
            ownerGaii: ownerGhii,
            ownerName: owner,
            filename,
            versionNumber: newVersion,
            manifest,
            mimeType: draft.mimeType,
            size: draft.size,
            data: draft.data,
            accessCode,
            parked: parkedState,
            forkable: forkableState,
            operatorHidden: operatorHiddenState,
            operatorHiddenBy,
            operatorHiddenAt,
            operatorHideReason,
            createdAt: now,
        });
        await storage.deleteAppDraft(ownerGhii, filename);

        const downloadUrl = `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`;
        await storage.addSiteChangeLog({
            id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
            action: isUpdate ? 'app_update' : 'app_publish',
            summary: `${isUpdate ? 'Updated' : 'Published'} app "${filename}" v${newVersion} from draft (${(draft.size / 1024).toFixed(1)} KB)`,
            changedBy: owner,
            changedAt: now,
        });
        emitChange('apps');
        void recordPublicActivity(storage, config, {
            category: 'apps',
            actor: callerGaii,
            summary: `App ${manifest.name || filename} ${isUpdate ? 'updated' : 'published'} (v${newVersion})`,
            detail: manifest.description || '',
            link: `${downloadUrl}?mode=inline`,
        }).catch(() => { /* feed is best-effort */ });

        res.status(201).json(success(config.nodeId, {
            filename,
            version_number: newVersion,
            manifest,
            size: draft.size,
            parked: parkedState,
            forkable: forkableState,
            download_url: downloadUrl,
            note: isUpdate
                ? `Draft published as version ${newVersion}. It is now the live app; the draft slot is cleared.`
                : 'Draft published as version 1. It is now live; the draft slot is cleared.',
        }, [
            { description: 'View all versions', method: 'GET', url: `${downloadUrl}/versions` },
        ]));
    });

    // POST /v1/apps/:owner/:filename/fork — Fork an app into YOUR OWN catalogue.
    // Authorization has two independent gates, both must pass:
    //   1. Derivative permission — the source owner and the owner's own agents (same
    //      owner component) and operators may always fork; outsiders only when the
    //      source app is flagged `forkable`.
    //   2. Byte-access — a PAID source still requires the caller to be the seller or
    //      hold a license, so a server-side copy never bypasses the read paywall
    //      (mirrors the GET /v1/apps/:owner/:filename gate).
    // On success the source bytes + manifest are copied under the caller's canonical
    // owner as a NEW app (version 1), stamped with `manifest.forkedFrom` provenance,
    // its own `forkable` defaulting to false, and a fork event is recorded for lineage.
    router.post('/v1/apps/:owner/:filename/fork', requireAuth(), async (req, res) => {
        const sourceOwnerParam = req.params.owner as string;
        const sourceFilename = req.params.filename as string;
        const sourceOwner = sourceOwnerParam.includes('@') ? sourceOwnerParam.split('@')[0] : sourceOwnerParam;

        const body = req.body ?? {};
        const newFilename = typeof body.new_filename === 'string' ? body.new_filename.trim() : '';
        if (!newFilename || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(newFilename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'new_filename is required (alphanumeric, dots, hyphens, underscores; max 100 chars)'));
            return;
        }
        const version = body.version !== undefined ? parseInt(String(body.version), 10) : undefined;

        // Load the source app (specific version if given, else latest).
        const source = await storage.getAppByOwnerName(sourceOwner, sourceFilename, version);
        if (!source) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"${version ? ` (version ${version})` : ''}`));
            return;
        }

        const isOperator = req.auth!.roles?.includes('operator') ?? false;
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner: callerOwner, ownerGhii: callerGhii } = await canonicalOwner(req);
        const sameOwner = callerOwner === source.ownerName;

        // Operator-hidden apps are unreachable to everyone but their owner/operator —
        // mirror the read gate's 404 so moderation status is not leaked via fork.
        if (source.operatorHidden && !isOperator && !sameOwner) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"`));
            return;
        }

        // Gate 1 — derivative permission.
        if (!isOperator && !sameOwner && !source.forkable) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'This app is not open for forking by others. Ask the owner to enable forking.'));
            return;
        }

        // Gate 2 — a paid source's bytes must not bypass the paywall.
        if (config.marketplaceEnabled && source.manifest.priceMorsels && source.manifest.priceMorsels > 0 && !sameOwner && !isOperator) {
            const hasLicense = await storage.hasValidLicense(req.auth!.sub, source.ownerGaii, sourceFilename);
            if (!hasLicense) {
                res.status(402).json(error(config.nodeId, 'PURCHASE_REQUIRED', `This app costs ${source.manifest.priceMorsels} morsels. Purchase it first via POST /v1/app-store/purchase before forking.`));
                return;
            }
        }

        // A fork is a NEW app in the caller's catalogue — refuse to shadow an app the
        // caller already owns by that filename (to update, publish; don't fork).
        const existingVersion = await storage.getLatestVersionNumber(callerGhii, newFilename);
        if (existingVersion > 0) {
            res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS', `You already have an app named "${newFilename}". Choose a different new_filename.`));
            return;
        }

        // Per-owner app quota (same rule as publish).
        if (config.maxAppsPerAgent > 0) {
            const { total } = await storage.listApps({ ownerGaii: callerGhii, limit: 1 });
            if (total >= config.maxAppsPerAgent) {
                res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', `You have reached the maximum of ${config.maxAppsPerAgent} published apps`));
                return;
            }
        }

        const now = new Date().toISOString();
        const forkedManifest: AppManifest = {
            ...source.manifest,
            name: `${source.manifest.name || sourceFilename.replace(/\.html?$/i, '')} (fork)`,
            authorDisplay: callerOwner,
            // A fork starts as its own independent, free app — drop the source's paid
            // terms; the forker can price their own copy later. Record its origin.
            forkedFrom: { owner: source.ownerName, filename: sourceFilename, version: source.versionNumber, node: config.nodeId },
        };
        delete forkedManifest.priceMorsels;
        delete forkedManifest.licenseType;

        await storage.createApp({
            ownerGaii: callerGhii,
            ownerName: callerOwner,
            filename: newFilename,
            versionNumber: 1,
            manifest: forkedManifest,
            mimeType: source.mimeType,
            size: source.size,
            data: source.data,
            parked: false,
            forkable: false,   // the forker decides their own copy's forkability later
            createdAt: now,
        });

        // Copy the source screenshot into the fork's bucket (best-effort) so the fork
        // renders with the same catalogue thumbnail.
        try {
            const srcShot = await storage.getStorageFile(source.ownerGaii, `apps/screenshots/${sourceFilename}`);
            if (srcShot) {
                await storage.createStorageFile({
                    key: `apps/screenshots/${newFilename}`,
                    ownerGaii: callerGhii,
                    visibility: 'public',
                    mimeType: srcShot.mimeType,
                    size: srcShot.size,
                    data: srcShot.data,
                    createdAt: now,
                });
            }
        } catch { /* screenshot copy is non-critical */ }

        // Record the fork event — the source of truth for fork stats + lineage.
        await storage.recordAppFork({
            id: `fork-${Date.now()}-${randomBytes(4).toString('hex')}`,
            sourceOwnerGaii: source.ownerGaii,
            sourceOwnerName: source.ownerName,
            sourceFilename,
            sourceVersion: source.versionNumber,
            childOwnerGaii: callerGhii,
            childOwnerName: callerOwner,
            childFilename: newFilename,
            forkedByGaii: callerGaii,
            forkedAt: now,
        });

        const downloadUrl = `/v1/apps/${encodeURIComponent(callerOwner)}/${encodeURIComponent(newFilename)}`;

        await storage.addSiteChangeLog({
            id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
            action: 'app_publish',
            summary: `Forked "${sourceFilename}" (by ${source.ownerName}) into "${newFilename}"`,
            changedBy: callerOwner,
            changedAt: now,
        });

        res.status(201).json(success(config.nodeId, {
            filename: newFilename,
            version_number: 1,
            manifest: forkedManifest,
            forkable: false,
            forked_from: { owner: source.ownerName, filename: sourceFilename, version: source.versionNumber },
            download_url: downloadUrl,
            versions_url: `${downloadUrl}/versions`,
            note: `Forked "${sourceFilename}" into your catalogue as "${newFilename}".`,
        }, [
            { description: 'Open the fork', method: 'GET', url: `${downloadUrl}?mode=inline` },
        ]));
        emitChange('apps');
        void recordPublicActivity(storage, config, {
            category: 'apps',
            actor: callerGaii,
            summary: `App ${forkedManifest.name} forked from ${source.ownerName}/${sourceFilename}`,
            detail: forkedManifest.description || '',
            link: `${downloadUrl}?mode=inline`,
        }).catch(() => { /* feed is best-effort */ });
    });

    // PATCH /v1/apps/:filename — Update an app you own (requires auth). Accepts
    // `name` / `description` (rename / re-describe in place, no re-publish),
    // `access_code` (set/remove protection), `parked` (hide from / restore to the
    // public catalogue) and/or `forkable` (allow others to fork). Fields are
    // independent: each is applied only when present.
    router.patch('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const filename = req.params.filename as string;

        // Same lookup order as DELETE: canonical owner-GHII bucket first,
        // then agent-GAII shadow bucket (pre-fix rows), then bare owner,
        // then a last-resort lookup by ownerName across all buckets.
        let app = await storage.getApp(ownerGhii, filename);
        let effectiveGaii = ownerGhii;
        if (!app) {
            app = await storage.getApp(callerGaii, filename);
            if (app) effectiveGaii = callerGaii;
        }
        if (!app) {
            app = await storage.getApp(owner, filename);
            if (app) effectiveGaii = owner;
        }
        if (!app) {
            const found = await storage.getAppByOwnerName(owner, filename);
            if (found && found.ownerName === owner) { app = found; effectiveGaii = found.ownerGaii; }
        }
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
            return;
        }

        const body = req.body ?? {};

        // Each field is independent and only touched when present in the body, so a
        // parked-only PATCH never clears the access code (and vice-versa).
        const notes: string[] = [];

        // Rename / re-describe in place: the display name is metadata, the URL is
        // keyed off owner/filename, so this never changes the link. Only the latest
        // version's manifest is updated (the version the catalogue surfaces).
        const metaUpdate: { name?: string; description?: string } = {};
        if ('name' in body) {
            if (typeof body.name !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name must be a string'));
                return;
            }
            const trimmedName = body.name.trim();
            if (trimmedName.length < 1 || trimmedName.length > 120) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name must be 1-120 characters'));
                return;
            }
            metaUpdate.name = trimmedName;
        }
        if ('description' in body) {
            if (typeof body.description !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description must be a string'));
                return;
            }
            const trimmedDesc = body.description.trim();
            if (trimmedDesc.length > 2000) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description must be at most 2000 characters'));
                return;
            }
            if (trimmedDesc.length === 0) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description cannot be empty — apps require a description'));
                return;
            }
            metaUpdate.description = trimmedDesc;
        }
        if (metaUpdate.name !== undefined || metaUpdate.description !== undefined) {
            await storage.updateAppMeta(effectiveGaii, filename, metaUpdate);
            if (metaUpdate.name !== undefined && metaUpdate.description !== undefined) {
                notes.push('Name and description updated. The app link is unchanged.');
            } else if (metaUpdate.name !== undefined) {
                notes.push('Name updated. The app link is unchanged.');
            } else {
                notes.push('Description updated.');
            }
        }

        if ('access_code' in body) {
            const access_code = body.access_code;
            const newCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
            if (newCode && (newCode.length < 4 || newCode.length > 64)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
                return;
            }
            await storage.updateAppAccessCode(effectiveGaii, filename, newCode);
            notes.push(newCode
                ? 'Access code updated. Share the new code with recipients.'
                : 'Access code removed. The app is now publicly downloadable.');
        }

        if ('parked' in body) {
            if (typeof body.parked !== 'boolean') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'parked must be a boolean'));
                return;
            }
            await storage.setAppParked(effectiveGaii, filename, body.parked);
            notes.push(body.parked
                ? 'App parked. It is now hidden from the public catalogue but stays usable by you.'
                : 'App unparked. It is published in the public catalogue again.');
        }

        if ('forkable' in body) {
            if (typeof body.forkable !== 'boolean') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'forkable must be a boolean'));
                return;
            }
            await storage.setAppForkable(effectiveGaii, filename, body.forkable);
            notes.push(body.forkable
                ? 'Forking enabled. Anyone can now fork this app into their own catalogue.'
                : 'Forking disabled. Only you and your agents can fork this app.');
        }

        if ('protection' in body) {
            const sanitized = sanitizeProtection(body.protection);
            if (sanitized === undefined) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'protection must be an object of booleans (obfuscate, domainLock, watermark, noRawDownload)'));
                return;
            }
            const toStore: AppProtection = Object.values(sanitized).some(Boolean) ? sanitized : {};
            await storage.updateAppMeta(effectiveGaii, filename, { protection: toStore });
            invalidateProtectionCache(owner, filename);
            const on = Object.entries(toStore).filter(([, v]) => v).map(([k]) => k);
            notes.push(on.length
                ? `Copy-protection updated (${on.join(', ')}). Note: these raise the cost of casual copying and make leaks traceable — they cannot stop someone who can view the app from copying its HTML. To truly protect logic/data, move it into an extension.`
                : 'Copy-protection cleared.');
        }

        if (notes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide at least one field to update (name, description, access_code, parked, forkable or protection).'));
            return;
        }

        // Re-read so the response reflects the app's current state after the update(s).
        const updated = await storage.getApp(effectiveGaii, filename);

        res.json(success(config.nodeId, {
            filename,
            name: updated?.manifest?.name,
            description: updated?.manifest?.description,
            protected: !!updated?.accessCode,
            parked: !!updated?.parked,
            forkable: !!updated?.forkable,
            protection: updated?.manifest?.protection ?? null,
            download_url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`,
            note: notes.join(' '),
        }));
        emitChange('apps');
    });

    // DELETE /v1/apps/:filename — Remove an app you own (supports ?version=N)
    // Apps are owner-scoped: an agent acting on behalf of its owner can delete
    // the owner's apps. To clean up "ghost" rows created by old buggy publish
    // paths (different ownerGaii buckets for the same owner+filename), the
    // no-version case sweeps ALL buckets that match the owner name. A
    // single-version delete still targets one bucket (you might want to keep
    // versions in one bucket while removing a stray version from another).
    router.delete('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const filename = req.params.filename as string;
        const versionParam = req.query.version as string | undefined;
        const version = versionParam ? parseInt(versionParam, 10) : undefined;

        // ── No-version case: sweep every bucket this owner has for this filename ──
        // getAppByOwnerName finds the latest version in any bucket; we delete
        // that bucket entirely (deleteApp without version removes all its
        // versions), then loop until no more rows exist. This handles ghost
        // entries from old shadow-bucket bugs in one user click.
        if (!version) {
            let sweepCount = 0;
            for (;;) {
                const app = await storage.getAppByOwnerName(owner, filename);
                if (!app) break;
                // Authorization sanity check: ownerName MUST match the caller's
                // owner. (It always will, because getAppByOwnerName takes
                // ownerName as the key — but defense in depth.)
                if (app.ownerName !== owner) break;
                await storage.deleteApp(app.ownerGaii, filename);
                await storage.deleteStorageFile(app.ownerGaii, `apps/screenshots/${filename}`).catch(() => {});
                sweepCount++;
                if (sweepCount > 10) break; // safety cap, no real owner has >10 buckets
            }
            if (sweepCount === 0) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
                return;
            }
        } else {
            // ── Single-version case: try buckets in order, delete from the one that has it ──
            let app = await storage.getApp(ownerGhii, filename, version);
            let effectiveGaii = ownerGhii;
            if (!app) { app = await storage.getApp(callerGaii, filename, version); if (app) effectiveGaii = callerGaii; }
            if (!app) { app = await storage.getApp(owner, filename, version); if (app) effectiveGaii = owner; }
            if (!app) {
                // Last-resort: find the row by ownerName across all buckets
                const found = await storage.getAppByOwnerName(owner, filename, version);
                if (found && found.ownerName === owner) { app = found; effectiveGaii = found.ownerGaii; }
            }
            if (!app) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads (version ${version})`));
                return;
            }
            await storage.deleteApp(effectiveGaii, filename, version);
        }

        await storage.addSiteChangeLog({
            id: `site-${Date.now()}-${randomBytes(4).toString('hex')}`,
            action: 'app_delete',
            summary: version ? `Deleted version ${version} of app "${filename}"` : `Deleted app "${filename}" (all versions)`,
            changedBy: owner,
            changedAt: new Date().toISOString(),
        });

        res.json(success(config.nodeId, {
            filename,
            version_deleted: version ?? 'all',
            note: version ? `Version ${version} deleted.` : 'App deleted (all versions).',
        }));
        emitChange('apps');
    });

    return router;
}
