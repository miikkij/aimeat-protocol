/**
 * @file src/routes/apps/drafts.ts
 * @description App-catalog draft (staging) routes: PUT /v1/apps/:owner/:filename/draft, POST .../draft/
 *   preview-token, DELETE .../draft, POST .../publish-draft. Edit + test the next version without
 *   touching the live one. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — Draft save carries the live app's cortex.agents (bundled crew-defs)
 *     into the draft manifest so a draft-publish never drops them (Agent-Bundled Apps).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppManifest } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { generateDraftToken } from '../../services/draft-token.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { randomBytes } from 'node:crypto';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection, invalidateProtectionCache } from '../../utils/app-protect.js';
import { appOriginUrl, type CanonicalOwner } from './helpers.js';

export function registerDraftRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    canonicalOwner: CanonicalOwner,
): void {
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
        // A draft that only changes HTML keeps the live app's bundled crew-defs
        // (cortex.agents); draft-publish then promotes them unchanged.
        if (base?.cortex?.agents?.length) manifest.cortex = base.cortex;

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
}
