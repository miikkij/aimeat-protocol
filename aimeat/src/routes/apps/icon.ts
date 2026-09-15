/**
 * @file src/routes/apps/icon.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own icon IMAGE: the picture an iPhone puts on its home screen when the app
 *   is installed, and the one Android mints a WebAPK with.
 *
 *   WHY A PICTURE AND NOT THE EMOJI. An app's icon on this node is an emoji character. It renders on
 *   the node's own surfaces and, on the app's origin, as an SVG at `/icon.svg`. Neither reaches the
 *   one place a person actually looks: iOS reads the installed icon from `apple-touch-icon` and
 *   ignores SVG there, so every published app installed on an iPhone wore the apex heart, whoever
 *   made it. Turning the emoji into a raster server-side would need a font pipeline inside the node;
 *   an author who wants their own face uploads it, and the emoji stays the default for everybody who
 *   does not. Reported from another node on 2026-09-15.
 *
 *   THE SCREENSHOT'S TWIN, down to the ownership test, because it is the same act: the author
 *   replacing a picture of their app without republishing it. The one deliberate difference is that
 *   this refuses anything but a PNG, by reading the bytes rather than believing the caller's mime
 *   type, because an SVG stored here would silently do nothing on the one surface it exists for.
 * @structure registerAppIconRoutes() — GET and POST /v1/apps/:owner/:filename/icon
 * @usage registerAppIconRoutes(router, config, storage, appTarget); // from appsRouter
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { appIconKey } from '../../services/app-seo.js';
import { appTargetOr, type AppTargetFor } from './helpers.js';

/** Defence in depth against a traversal in the filename segment, as every app route applies it. */
function badFilename(filename: string): boolean {
    const decoded = decodeURIComponent(filename);
    return decoded.includes('..') || decoded.includes('/') || decoded.includes('\\')
        || decoded.includes('%2f') || decoded.includes('%2F')
        || decoded.includes('%5c') || decoded.includes('%5C')
        || decoded.includes('\0');
}

/** Tolerate the legacy full-GHII owner segment (owner@node) in old links. */
const bareOwner = (segment: string): string => (segment.includes('@') ? segment.split('@')[0] : segment);

export function registerAppIconRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    appTarget: AppTargetFor,
): void {
    // GET /v1/apps/:owner/:filename/icon — the app's own icon image. No auth: it is the icon of a
    // page anyone with the link can open, and the app origin serves the same bytes at
    // /apple-touch-icon.png.
    router.get('/v1/apps/:owner/:filename/icon', async (req, res) => {
        const filename = req.params.filename as string;
        const owner = bareOwner(req.params.owner as string);
        if (badFilename(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        const file = await storage.getStorageFile(app.ownerGaii, appIconKey(filename));
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No icon image for app "${filename}"`));
            return;
        }
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.size.toString());
        res.setHeader('Cache-Control', 'public, max-age=3600');
        // Owner-supplied bytes: name the type and refuse to let a browser guess a different one.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(file.data);
    });

    // POST /v1/apps/:owner/:filename/icon — put one there, without republishing the app.
    router.post('/v1/apps/:owner/:filename/icon', requireAuth(), requireScope('app:write'), async (req, res) => {
        const filename = req.params.filename as string;
        const owner = bareOwner(req.params.owner as string);
        if (badFilename(filename)) {
            res.status(400).json(error(config.nodeId, 'INVALID_FILENAME', 'Filename contains invalid characters'));
            return;
        }

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
            return;
        }

        // The app's own owner, or somebody they gave a rung that carries `presentation` — the same
        // test the screenshot uses, because this is the same kind of change to the same app.
        const isOperator = req.auth!.roles?.includes('operator') ?? false;
        if (!isOperator && !(await appTargetOr(appTarget, config, req, res, 'presentation'))) return;

        const { icon } = req.body ?? {};
        if (!icon || typeof icon !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'icon (base64 image) is required'));
            return;
        }
        const iconData = decodeStrictBase64(icon);
        if (!iconData) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'icon must be base64-encoded image data'));
            return;
        }
        // Smaller than the screenshot's cap on purpose: this is a square icon, 512 pixels at the very
        // most, so a megabyte is already generous.
        const MAX_ICON_SIZE = 1024 * 1024;
        if (iconData.length > MAX_ICON_SIZE) {
            res.status(413).json(error(config.nodeId, 'TOO_LARGE', `Icon exceeds 1MB limit (${iconData.length} bytes)`));
            return;
        }
        // PNG, CHECKED RATHER THAN BELIEVED. A caller's mime type is a claim about bytes the same
        // caller supplied, and an SVG stored here would be accepted, served, and silently ignored by
        // the one surface this exists for. The magic number is the test.
        const isPng = iconData.length > 8 && iconData[0] === 0x89 && iconData[1] === 0x50
            && iconData[2] === 0x4E && iconData[3] === 0x47;
        if (!isPng) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'The icon must be a PNG. An iPhone home screen ignores SVG, which is the one place this icon is for.'));
            return;
        }

        await storage.createStorageFile({
            key: appIconKey(filename),
            ownerGaii: app.ownerGaii,   // the app row's bucket, so the GET above and the app origin find it
            visibility: 'public',
            mimeType: 'image/png',
            size: iconData.length,
            data: iconData,
            createdAt: new Date().toISOString(),
        });

        emitChange('apps');
        res.json(success(config.nodeId, {
            filename,
            owner: app.ownerName,
            icon_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(filename)}/icon`,
        }));
    });
}
