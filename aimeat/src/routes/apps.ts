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
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { recordPublicActivity } from '../services/public-activity.js';
import { generateUploadToken } from '../services/upload-token.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { randomBytes } from 'node:crypto';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { decodeStrictBase64 } from '../utils/base64.js';

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
        const sites = await storage.listSubdomainSites();
        const match = sites.find(s => s.enabled && s.kind === 'app'
            && (s.target === `${owner}/${filename}` || s.target === `${bareOwner}/${filename}`));
        if (match) return `${scheme}://${match.subdomain}.${config.appHost}${portSuffix}/`;
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
    router.get('/v1/apps', async (req, res) => {
        const opts = {
            category: req.query.category as string | undefined,
            q: req.query.q as string | undefined,
            tag: req.query.tag as string | undefined,
            sort: (req.query.sort as 'newest' | 'popular' | undefined) || 'newest',
            limit: Math.min(parseInt(req.query.limit as string) || 50, 200),
            offset: parseInt(req.query.offset as string) || 0,
            freeOnly: req.query.free_only === 'true',
        };

        const { apps, total } = await storage.listApps(opts);

        const result = await Promise.all(apps.map(async (app) => {
            const downloads = await storage.getAppDownloads(app.ownerGaii, app.filename);
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
                has_screenshot: hasScreenshot,
                downloads,
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

        res.setHeader('Content-Type', app.mimeType);
        res.setHeader('Content-Length', app.size.toString());

        if (mode === 'inline') {
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' blob: https: http://localhost:*; style-src 'unsafe-inline' https: http://localhost:*; img-src * data: blob:; font-src data: https:; connect-src 'self' https: http://localhost:* wss: ws: data:; worker-src blob:; object-src 'none'; frame-src 'self' blob: data: https: http://localhost:*; frame-ancestors 'self'");
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

        res.send(app.data);
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
            uses_cortex, price_morsels, license_type,
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

        const now = new Date().toISOString();
        const manifest: AppManifest = {
            name: typeof name === 'string' ? name : filename.replace(/\.html?$/i, ''),
            description: typeof description === 'string' ? description : '',
            version: typeof semver === 'string' ? semver : `1.0.${newVersion - 1}`,
            category: typeof category === 'string' ? category : 'utility',
            tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : [],
            authorDisplay: owner,
            usesCortex: Array.isArray(uses_cortex) ? uses_cortex.filter((c: unknown) => typeof c === 'string') : [],
        };
        if (typeof icon === 'string') manifest.icon = icon;
        if (typeof price_morsels === 'number' && price_morsels > 0) manifest.priceMorsels = price_morsels;
        if (license_type === 'single' || license_type === 'lifetime') manifest.licenseType = license_type;

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

    // PATCH /v1/apps/:filename — Update access code on an app you own (requires auth)
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

        const { access_code } = req.body ?? {};
        const newCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
        if (newCode && (newCode.length < 4 || newCode.length > 64)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
            return;
        }

        await storage.updateAppAccessCode(effectiveGaii, filename, newCode);

        res.json(success(config.nodeId, {
            filename,
            protected: !!newCode,
            download_url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`,
            note: newCode
                ? 'Access code updated. Share the new code with recipients.'
                : 'Access code removed. The app is now publicly downloadable.',
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
