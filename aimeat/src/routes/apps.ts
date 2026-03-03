import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

/**
 * App file download routes.
 *
 * Apps are HTML+CSS+JS files stored via the existing storage system.
 * They're uploaded by agents with key prefix "apps/" and public visibility.
 * Downloaded via GET /v1/apps/:owner/:filename — no auth required.
 *
 * These are served as file downloads, NOT as rendered pages.
 * Users download the file and open it locally in their browser.
 */
export function appsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // GET /v1/apps — List all publicly available apps
    router.get('/v1/apps', async (_req, res) => {
        const agents = await storage.listAgents();
        const apps: Array<{
            owner: string;
            filename: string;
            size: number;
            mime_type: string;
            protected: boolean;
            has_screenshot: boolean;
            download_url: string;
            screenshot_url: string | null;
            created_at: string;
        }> = [];

        for (const agent of agents) {
            const files = await storage.listStorageFiles(agent.gaii);
            for (const file of files) {
                if (file.key.startsWith('apps/') && !file.key.startsWith('apps/screenshots/') && file.visibility === 'public') {
                    const filename = file.key.slice(5); // strip "apps/" prefix
                    // Check if a screenshot exists for this app
                    const screenshotFile = await storage.getStorageFile(agent.gaii, `apps/screenshots/${filename}`);
                    const hasScreenshot = !!screenshotFile;
                    apps.push({
                        owner: agent.owner,
                        filename,
                        size: file.size,
                        mime_type: file.mimeType,
                        protected: !!file.accessCode,
                        has_screenshot: hasScreenshot,
                        download_url: `/v1/apps/${encodeURIComponent(agent.owner)}/${encodeURIComponent(filename)}`,
                        screenshot_url: hasScreenshot ? `/v1/apps/${encodeURIComponent(agent.owner)}/${encodeURIComponent(filename)}/screenshot` : null,
                        created_at: file.createdAt,
                    });
                }
            }
        }

        res.json(success(config.nodeId, {
            apps,
            total: apps.length,
            note: 'Download apps and open them locally in your browser. These are self-contained HTML files.',
        }));
    });

    // GET /v1/apps/:owner/:filename/screenshot — Serve app screenshot (no auth)
    router.get('/v1/apps/:owner/:filename/screenshot', async (req, res) => {
        const owner = req.params.owner as string;
        const filename = req.params.filename as string;

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

    // GET /v1/apps/:owner/:filename — Download an app file (no auth — public, but may require access_code)
    router.get('/v1/apps/:owner/:filename', async (req, res) => {
        const owner = req.params.owner as string;
        const filename = req.params.filename as string;
        const code = (req.query.code as string) || req.headers['x-access-code'] as string | undefined;

        // Find the agent that owns this file
        const agents = await storage.getAgentsByOwner(owner);
        if (agents.length === 0) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
            return;
        }

        // Search through the owner's agents for the app file
        const storageKey = `apps/${filename}`;
        for (const agent of agents) {
            const file = await storage.getStorageFile(agent.gaii, storageKey);
            if (file && file.visibility === 'public') {
                // Check access code if the file is protected
                if (file.accessCode && file.accessCode !== code) {
                    res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
                        'This app is protected. Provide the access code via ?code= query parameter or X-Access-Code header.'));
                    return;
                }
                // Serve the file
                res.setHeader('Content-Type', file.mimeType);
                res.setHeader('Content-Length', file.size.toString());

                const mode = req.query.mode as string | undefined;
                if (mode === 'inline') {
                    // Inline mode: serve without attachment disposition for iframe/tab viewing
                    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-ancestors 'self'");
                } else {
                    // Default: serve as attachment download — never render as page
                    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.send(file.data);
                return;
            }
        }

        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App file "${filename}" not found for owner "${owner}"`));
    });

    // POST /v1/apps — Upload an app file (requires auth)
    // Wraps existing storage with the apps/ key prefix and forces public visibility
    router.post('/v1/apps', requireAuth(), async (req, res) => {
        const gaii = req.auth!.sub;
        const { filename, content, mime_type, access_code, screenshot, screenshot_mime_type } = req.body ?? {};

        if (!filename || typeof filename !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'filename is required'));
            return;
        }

        // Validate filename: only safe characters
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.'));
            return;
        }

        if (!content || typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required (base64 encoded)'));
            return;
        }

        const data = Buffer.from(content, 'base64');
        const MAX_APP_SIZE = 5 * 1024 * 1024; // 5MB limit for app files
        if (data.length > MAX_APP_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `App file exceeds 5MB limit (${data.length} bytes)`));
            return;
        }

        const storageKey = `apps/${filename}`;
        const mimeType = typeof mime_type === 'string' ? mime_type : 'text/html';

        // Validate access_code if provided
        const accessCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
        if (accessCode && (accessCode.length < 4 || accessCode.length > 64)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
            return;
        }

        await storage.createStorageFile({
            key: storageKey,
            ownerGaii: gaii,
            visibility: 'public',
            mimeType,
            size: data.length,
            data,
            accessCode,
            createdAt: new Date().toISOString(),
        });

        // Handle optional screenshot upload
        let hasScreenshot = false;
        if (screenshot && typeof screenshot === 'string') {
            const screenshotData = Buffer.from(screenshot, 'base64');
            const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024; // 2MB limit for screenshots
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
                createdAt: new Date().toISOString(),
            });
            hasScreenshot = true;
        }

        const owner = req.auth!.owner;
        const downloadUrl = `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`;
        res.status(201).json(success(config.nodeId, {
            filename,
            size: data.length,
            mime_type: mimeType,
            protected: !!accessCode,
            has_screenshot: hasScreenshot,
            download_url: downloadUrl,
            screenshot_url: hasScreenshot ? `${downloadUrl}/screenshot` : null,
            note: accessCode
                ? 'App published with access code protection. Share the code separately with recipients.'
                : 'App published. Others can download this file and open it locally.',
        }));
    });

    // PATCH /v1/apps/:filename — Update access code on an app you own (requires auth)
    router.patch('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const gaii = req.auth!.sub;
        const filename = req.params.filename as string;
        const storageKey = `apps/${filename}`;

        const file = await storage.getStorageFile(gaii, storageKey);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
            return;
        }

        const { access_code } = req.body ?? {};

        // null or empty string → remove protection
        const newCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
        if (newCode && (newCode.length < 4 || newCode.length > 64)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
            return;
        }

        file.accessCode = newCode;
        await storage.createStorageFile(file);

        const owner = req.auth!.owner;
        res.json(success(config.nodeId, {
            filename,
            protected: !!newCode,
            download_url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`,
            note: newCode
                ? 'Access code updated. Share the new code with recipients.'
                : 'Access code removed. The app is now publicly downloadable.',
        }));
    });

    return router;
}
