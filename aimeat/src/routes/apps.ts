import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { randomBytes } from 'node:crypto';

/**
 * App Catalog routes — versioned apps with manifest and search.
 *
 * Apps are single-file HTML apps stored in the dedicated apps table.
 * Each publish auto-increments the version number.
 * Old versions are preserved. Download counter is tracked separately.
 * Screenshots use the existing storage system with key prefix "apps/screenshots/".
 */
export function appsRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

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
        let peerApps: Record<string, unknown>[] = [];
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
        const owner = req.params.owner as string;
        const filename = req.params.filename as string;

        const agents = await storage.getAgentsByOwner(owner);
        if (agents.length === 0) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
            return;
        }

        for (const agent of agents) {
            const versions = await storage.listAppVersions(agent.gaii, filename);
            if (versions.length > 0) {
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
                return;
            }
        }

        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
    });

    // GET /v1/apps/:owner/:filename/screenshot — Serve app screenshot (no auth)
    router.get('/v1/apps/:owner/:filename/screenshot', async (req, res) => {
        const owner = req.params.owner as string;
        const filename = req.params.filename as string;

        // SECURITY: Defense-in-depth path traversal protection
        const decodedFn = decodeURIComponent(filename);
        if (decodedFn.includes('..') || decodedFn.includes('/') || decodedFn.includes('\\')
            || decodedFn.includes('%2f') || decodedFn.includes('%2F')
            || decodedFn.includes('%5c') || decodedFn.includes('%5C')
            || decodedFn.includes('\0')) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        const agents = await storage.getAgentsByOwner(owner);
        if (agents.length === 0) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
            return;
        }

        const screenshotKey = `apps/screenshots/${filename}`;
        for (const agent of agents) {
            const file = await storage.getStorageFile(agent.gaii, screenshotKey);
            if (file) {
                res.setHeader('Content-Type', file.mimeType);
                res.setHeader('Content-Length', file.size.toString());
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.send(file.data);
                return;
            }
        }

        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Screenshot not found for app "${filename}"`));
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

        const app = await storage.getAppByOwnerName(owner, filename, version);
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

        res.setHeader('Content-Type', app.mimeType);
        res.setHeader('Content-Length', app.size.toString());

        const mode = req.query.mode as string | undefined;
        if (mode === 'inline') {
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' blob: https: http://localhost:*; style-src 'unsafe-inline' https: http://localhost:*; img-src * data: blob:; font-src data: https:; connect-src 'self' https: http://localhost:* data:; worker-src blob:; object-src 'none'; frame-ancestors 'self'");
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');

        storage.incrementAppDownloads(app.ownerGaii, filename).catch(() => { });

        res.send(app.data);
    });

    // POST /v1/apps — Publish/update an app (requires auth)
    router.post('/v1/apps', requireAuth(), async (req, res) => {
        const gaii = req.auth!.sub;
        const owner = req.auth!.owner;
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

        if (!content || typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required (base64 encoded)'));
            return;
        }

        const data = Buffer.from(content, 'base64');
        const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
        if (data.length > MAX_APP_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `App file exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)`));
            return;
        }

        // Per-agent app count quota (only check for new apps, not updates)
        const existingVersion = await storage.getLatestVersionNumber(gaii, filename);
        if (existingVersion === 0 && config.maxAppsPerAgent > 0) {
            const { total } = await storage.listApps({ ownerGaii: gaii, limit: 1 });
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
            ownerGaii: gaii,
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
            const screenshotData = Buffer.from(screenshot, 'base64');
            const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024;
            if (screenshotData.length > MAX_SCREENSHOT_SIZE) {
                res.status(413).json(error(config.nodeId, 'TOO_LARGE', `Screenshot exceeds 2MB limit (${screenshotData.length} bytes)`));
                return;
            }
            const screenshotMime = typeof screenshot_mime_type === 'string' ? screenshot_mime_type : 'image/png';
            await storage.createStorageFile({
                key: `apps/screenshots/${filename}`,
                ownerGaii: gaii,
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
                    authorGaii: gaii,
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
    });

    // PATCH /v1/apps/:filename — Update access code on an app you own (requires auth)
    router.patch('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const gaii = req.auth!.sub;
        const filename = req.params.filename as string;

        const app = await storage.getApp(gaii, filename);
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

        await storage.updateAppAccessCode(gaii, filename, newCode);

        const owner = req.auth!.owner;
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
    router.delete('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const gaii = req.auth!.sub;
        const filename = req.params.filename as string;
        const versionParam = req.query.version as string | undefined;
        const version = versionParam ? parseInt(versionParam, 10) : undefined;

        const app = await storage.getApp(gaii, filename, version);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads${version ? ` (version ${version})` : ''}`));
            return;
        }

        await storage.deleteApp(gaii, filename, version);

        if (!version) {
            // Full delete — also remove screenshot
            await storage.deleteStorageFile(gaii, `apps/screenshots/${filename}`);
        }

        const owner = req.auth!.owner;
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
