/**
 * @file src/routes/apps/publish.ts
 * @description App-catalog publish route: POST /v1/apps (inline-upload OR presigned-upload publish/
 *   update, with description/category/cortex/icon/protection carry-forward, quota, screenshot, change
 *   log, board announcement, and public activity). Extracted from src/routes/apps.ts (max-file-lines).
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — Agent-Bundled Apps Slice 1: accept `cortex.agents` (declarative
 *     crew-defs) in the publish payload, validated fail-loud against CrewDefSchema — a
 *     malformed agents[] REJECTS the publish; carried forward on update when omitted.
 *   v1.2.0 — 2026-07-19 — provision the per-app subdomain (ensureAppSubdomain) at publish time
 *     so a new app's vanity URL works immediately (pitfall publish/new-app-subdomain-provisioning-lag).
 *   v1.3.0 — 2026-07-19 — non-blocking `mobile_hints` in the publish response (lintAppHtmlForMobile):
 *     catches the recurring phone-overflow bugs (missing viewport meta, grid 1fr blowout) at publish.
 *   v1.4.0 — 2026-07-22 — priceMorsels + licenseType carry forward on an update that omits them
 *     (an update must never silently turn a paid app free; price_morsels: 0 unprices explicitly).
 *   v1.5.0 — 2026-08-01 — TARGET-058 Phase 5: the AI transparency check. An app that requests
 *     `ai:use` and never tells the user a model made what they are reading gets `ai_hints` in the
 *     response and a recorded gap on `manifest.aiPosture` — a WARNING, never a rejection (decision
 *     D2: a publish that fails is a publish that gets worked around, and the app then ships with
 *     less transparency rather than more). A declaration carries forward across updates and forks.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppManifest, AppManifestCortex, AppProtection } from '../../storage/interface.js';
import { validateCortexAgents } from '../../models/crew-def-schemas.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { generateUploadToken } from '../../services/upload-token.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { stampAgentWrite } from '../../services/ai-provenance.js';
import { randomBytes } from 'node:crypto';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection, invalidateProtectionCache } from '../../utils/app-protect.js';
import { lintAppHtmlForMobile } from '../../utils/app-mobile-lint.js';
import { lintAppAiDisclosure } from '../../services/app-ai-posture.js';
import { ensureAppSubdomain } from '../subdomains.js';
import type { CanonicalOwner } from './helpers.js';
import { logger } from '../../utils/logger.js';

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
            name, description, descriptions, version: semver, category, tags, icon,
            uses_cortex, cortex, price_morsels, license_type, protection,
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
                // WHO is publishing, kept alongside WHERE it lands. An app always lands in the
                // owner's bucket, so `sub` alone erased the agent — and the provenance stamp on the
                // upload side has nothing to infer from once that is gone (TARGET-058 MINT-3).
                // Server-resolved, never client-supplied.
                actor: callerGaii,
                utype: 'app',
                // Only what the caller ACTUALLY sent. Defaulting the name to the filename here made
                // "the caller omitted it" indistinguishable from "the caller asked for it" by the
                // time the upload completed, so every presigned update renamed the app to its own
                // filename — NUOTTA became "nuotta.html" in the catalogue, in public.
                meta: {
                    filename, description, category, tags, icon,
                    ...(typeof req.body.name === 'string' ? { name: req.body.name } : {}),
                    ...(typeof semver === 'string' ? { version: semver } : {}),
                },
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

        // Agent-Bundled Apps (Slice 1): an app may declare its own agent(s) as DECLARATIVE
        // crew-defs under `cortex.agents`. Validation is the publish gate — a non-conforming
        // agents[] REJECTS the publish with the real errors, so a malformed crew-def never
        // reaches a fleet. The node never executes these; it stores data and routes a pointer.
        let cortexAgents: Record<string, unknown>[] | undefined;
        if (cortex !== undefined) {
            if (cortex === null || typeof cortex !== 'object' || Array.isArray(cortex)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'cortex must be an object (e.g. { "agents": [ ... ] })'));
                return;
            }
            if ((cortex as Record<string, unknown>).agents !== undefined) {
                const check = validateCortexAgents((cortex as Record<string, unknown>).agents);
                if (!check.ok) {
                    res.status(400).json(error(config.nodeId, 'INVALID_CREW_DEF', check.errors.join('; ')));
                    return;
                }
                cortexAgents = check.agents as unknown as Record<string, unknown>[];
            }
        }

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
        let carriedCortex: AppManifestCortex | undefined;
        // Per-locale descriptions survive a re-publish too (an update never silently drops them)
        // unless the caller sends a new `descriptions` map.
        let carriedDescriptions: Record<string, string> | undefined;
        // Pricing survives a re-publish too: an update that omits price_morsels must never
        // silently turn a paid app free.
        let carriedPriceMorsels: number | undefined;
        let carriedLicenseType: AppManifest['licenseType'] | undefined;
        // The two most visible fields an app has, and the two the carry-forward list forgot.
        let carriedName: string | undefined;
        let carriedVersion: string | undefined;
        let carriedTags: string[] | undefined;
        // A generative app that is updated stays a generative app: what the previous version DECLARED
        // survives a version whose author forgot the meta tag. What the node OBSERVES is re-measured
        // from the bytes being published, never carried.
        let carriedAiPosture: AppManifest['aiPosture'];
        if (isUpdate) {
            const existingApp = await storage.getApp(ownerGhii, filename);
            carriedAiPosture = existingApp?.manifest?.aiPosture;
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
            carriedName = existingApp?.manifest?.name;
            carriedVersion = existingApp?.manifest?.version;
            carriedTags = existingApp?.manifest?.tags;
            carriedCortex = existingApp?.manifest?.cortex;
            carriedDescriptions = existingApp?.manifest?.descriptions;
            carriedPriceMorsels = existingApp?.manifest?.priceMorsels;
            carriedLicenseType = existingApp?.manifest?.licenseType;
        }

        // Sanitize an optional per-locale descriptions map ({ locale: text }); drop blanks, cap 2000
        // chars each. When omitted on an update, carry the existing map forward.
        let effectiveDescriptions: Record<string, string> | undefined;
        if (descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)) {
            const cleaned: Record<string, string> = {};
            for (const [loc, val] of Object.entries(descriptions as Record<string, unknown>)) {
                if (typeof val === 'string' && val.trim().length > 0) cleaned[loc] = val.trim().slice(0, 2000);
            }
            if (Object.keys(cleaned).length > 0) effectiveDescriptions = cleaned;
        } else if (carriedDescriptions) {
            effectiveDescriptions = carriedDescriptions;
        }

        const now = new Date().toISOString();
        const manifest: AppManifest = {
            // Carried forward on an update, like description and icon below it. The display name is
            // the single most visible thing an app has, and an update that omits it means "leave it
            // alone" — never "rename it after the file it happens to live in".
            name: typeof name === 'string' ? name : (carriedName ?? filename.replace(/\.html?$/i, '')),
            description: effectiveDescription,
            version: typeof semver === 'string' ? semver : (carriedVersion ?? `1.0.${newVersion - 1}`),
            category: typeof category === 'string' ? category : (carriedCategory ?? 'utility'),
            // Carried like the rest. The presigned path already did this; the inline one dropped them,
            // so which door an update came through decided whether an app kept its tags.
            tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : (carriedTags ?? []),
            authorDisplay: owner,
            usesCortex: Array.isArray(uses_cortex) ? uses_cortex.filter((c: unknown) => typeof c === 'string') : (carriedUsesCortex ?? []),
        };
        if (effectiveDescriptions) manifest.descriptions = effectiveDescriptions;
        if (typeof icon === 'string') manifest.icon = icon;
        else if (carriedIcon) manifest.icon = carriedIcon;
        // cortex.agents: an explicit `cortex` in the payload replaces the section (send
        // `{ "agents": [] }` to clear it); omitted → carried forward like category/icon.
        if (cortexAgents !== undefined) {
            if (cortexAgents.length > 0) manifest.cortex = { agents: cortexAgents };
        } else if (cortex === undefined && carriedCortex?.agents?.length) {
            manifest.cortex = carriedCortex;
        }
        // Pricing carries forward on an update like description/icon: an update that omits
        // price_morsels must never silently turn a paid app free. Send price_morsels: 0 to unprice.
        if (typeof price_morsels === 'number') {
            if (price_morsels > 0) manifest.priceMorsels = price_morsels;
        } else if (typeof carriedPriceMorsels === 'number' && carriedPriceMorsels > 0) {
            manifest.priceMorsels = carriedPriceMorsels;
        }
        if (license_type === 'single' || license_type === 'lifetime') manifest.licenseType = license_type;
        else if (license_type === undefined && carriedLicenseType) manifest.licenseType = carriedLicenseType;
        // Opt-in copy-protection: use the body's `protection` when provided, else carry
        // the existing flags forward on an update. Only stored when at least one is on.
        const effectiveProtection = sanitizeProtection(protection) ?? protectionState;
        if (effectiveProtection && Object.values(effectiveProtection).some(Boolean)) {
            manifest.protection = effectiveProtection;
        }
        // TARGET-058: what this app says about the AI inside it, plus the publish check. HTML only —
        // there is nothing to read in a binary. It WARNS and never blocks: a publish that fails is a
        // publish that gets worked around, and the app then ships with less transparency, not more.
        const aiLint = mimeType === 'text/html'
            ? lintAppAiDisclosure(data.toString('utf8'), carriedAiPosture)
            : null;
        if (aiLint) manifest.aiPosture = aiLint.posture;
        // A re-publish changes the bytes → drop any cached obfuscated/locked base.
        invalidateProtectionCache(owner, filename);

        // MINT-3 (TARGET-058): an app published by an agent or an ecosystem app that declared
        // nothing is stamped by the node — silence from a non-human principal must not read as "a
        // human wrote it". The owner publishing through their own token is never stamped. The hash
        // is of the BYTES AS STORED, so a detection query about the author's file finds this record
        // and the serve-time marks (which are added on the way out) cannot change the answer.
        //
        // Per version, because each publish is different content. The record becomes anonymously
        // resolvable exactly while this app is actually public — parking, hiding or access-coding it
        // takes the record back to a 404 with nothing to remember to do.
        const aiProvenanceId = await stampAgentWrite(storage, {
            principal: callerGaii,
            content: data,
            pipeline: 'app.publish',
            surface: { visibility: accessCode || parkedState ? 'private' : 'public', humanAudience: true },
            labelPolicy: config.aiLabelPublic,
            nodeId: config.nodeId,
            baseUrl: config.baseUrl,
            enabled: config.aiProvenance,
        });

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
            ...(aiProvenanceId ? { aiProvenanceId } : {}),
        });

        // Provision the per-app subdomain mapping NOW (HTML apps) — previously it was only
        // auto-assigned on the first path-form open, so a brand-new app's vanity subdomain
        // 404'd until someone hit the canonical URL (pitfall publish/new-app-subdomain-
        // provisioning-lag). Best-effort: a failed ensure never fails the publish.
        if (/\.html?$/i.test(filename)) {
            try { await ensureAppSubdomain(storage, config, owner, filename); } catch (err) { logger.warn('handler: best-effort', { error: String(err) }); }
        }

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

        // Non-blocking mobile hints (HTML only) — surfaced so the builder catches the recurring
        // "overflows / tiny on a phone" bugs before users do. Never affects the publish outcome.
        const mobileHints = mimeType === 'text/html' ? lintAppHtmlForMobile(data.toString('utf8')) : [];

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
            } catch (err) { logger.warn('handler: non-critical', { error: String(err) }); }
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
            ...(mobileHints.length ? { mobile_hints: mobileHints } : {}),
            // Non-blocking, and worded for the model that built the app — that is who reads a publish
            // response. `ai_posture` is what the node now believes; `ai_hints` is what to fix.
            ...(aiLint ? { ai_posture: aiLint.posture } : {}),
            ...(aiLint?.hints.length ? { ai_hints: aiLint.hints } : {}),
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
        }).catch(err => { logger.warn('handler: feed is best-effort', { error: String(err) }); });
    });
}
