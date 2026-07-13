/**
 * @file src/routes/apps/publish.ts
 * @description App-catalog publish route: POST /v1/apps (inline-upload OR presigned-upload publish/
 *   update, with description/category/cortex/icon/protection carry-forward, quota, screenshot, change
 *   log, board announcement, and public activity). Extracted from src/routes/apps.ts (max-file-lines).
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppManifest, AppProtection } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { generateUploadToken } from '../../services/upload-token.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { randomBytes } from 'node:crypto';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection, invalidateProtectionCache } from '../../utils/app-protect.js';
import type { CanonicalOwner } from './helpers.js';

export function registerPublishRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    canonicalOwner: CanonicalOwner,
): void {
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
}
