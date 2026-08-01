/**
 * @file src/routes/apps/drafts.ts
 * @description App-catalog draft (staging) routes: PUT /v1/apps/:owner/:filename/draft, POST .../draft/
 *   preview-token, DELETE .../draft, POST .../publish-draft. Edit + test the next version without
 *   touching the live one. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0a: publish-draft is now services/app-publish.ts,
 *     shared with POST /v1/apps and the presigned upload. Promoting a draft consequently stops
 *     dropping `priceMorsels`, `licenseType` and the per-locale `descriptions` (a draft manifest
 *     cannot express them and this route published it verbatim, so a promoted draft turned a paid
 *     app free), and now provisions the app's subdomain and announces like the other two doors.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — Draft save carries the live app's cortex.agents (bundled crew-defs)
 *     into the draft manifest so a draft-publish never drops them (Agent-Bundled Apps).
 *   v1.2.0 — 2026-07-25 — POST .../frame-token: a frame grant naming the CALLER'S origin as the
 *     one page allowed to embed this app. Owner-only. Constant-size, unlike listing origins in
 *     frame-ancestors, which scaled with the owner's app count and 502'd production.
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 5: publish-draft now does what POST /v1/apps already did —
 *     it stamps the bytes with a provenance record (MINT-3) and runs the AI transparency check. It
 *     did neither, so an app that went through the STAGING flow (the one the catalogue's own editor
 *     uses) arrived live unstamped while the identical bytes posted directly were stamped. Two doors
 *     to the same act have to give the same answer.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppManifest } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { generateDraftToken, generateFrameToken } from '../../services/draft-token.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection } from '../../utils/app-protect.js';
import { publishApp } from '../../services/app-publish.js';
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

    // GET /v1/apps/:owner/:filename/draft — read your OWN draft back (base64). The write side has
    // always existed (PUT/publish/discard) but there was no way to READ the slot, so a client that
    // reloaded could only re-fetch the LIVE bytes — and would then show the published app while
    // calling it "your working copy", silently overwriting the real draft on the next save. Serving
    // it through the ?preview= URL is not an option for a client: on an app-origin node that path
    // 301s to the isolated origin, which is deliberately cross-origin and CORS-less.
    // Owner-only: canonicalOwner resolves the caller, so a draft is never readable by anyone else.
    router.get('/v1/apps/:owner/:filename/draft', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        const { ownerGhii } = await canonicalOwner(req);
        const draft = await storage.getAppDraft(ownerGhii, filename);
        if (!draft) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft exists for "${filename}".`));
            return;
        }
        res.json(success(config.nodeId, {
            filename,
            content: Buffer.from(draft.data).toString('base64'),
            mime_type: draft.mimeType,
            size: draft.size,
            updated_at: draft.updatedAt,
            manifest: draft.manifest,
        }));
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

    // POST /v1/apps/:owner/:filename/frame-token — mint a FRAME GRANT: permission for ONE origin
    // to embed this app. The caller's own Origin is what gets written into the grant; a body
    // field would let a page ask for permission on someone else's behalf. Owner-only, because a
    // grant to frame an app you do not own is a clickjacking primitive.
    //
    // Why a grant at all, rather than listing allowed origins in the app's frame-ancestors: that
    // list grows with how many apps the owner has, and at 76 it overran the reverse proxy's
    // header buffer and 502'd every app subdomain. A grant puts exactly one origin in the header,
    // so its size does not depend on anything the user accumulates.
    router.post('/v1/apps/:owner/:filename/frame-token', requireAuth(), async (req, res) => {
        const filename = req.params.filename as string;
        const { owner, ownerGhii } = await canonicalOwner(req);

        const app = await storage.getAppByOwnerName(owner, filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No app "${filename}" you own`));
            return;
        }
        if (!config.appOriginEnabled || !config.appHost) {
            res.status(409).json(error(config.nodeId, 'APP_ORIGIN_DISABLED', 'App origins are not enabled on this node, so there is nothing to frame.'));
            return;
        }

        const requester = String(req.get('origin') ?? '');
        if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(requester)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A frame grant is issued to the calling page\'s Origin, and this request carried none.'));
            return;
        }

        const ttlSeconds = 43200;
        const token = await generateFrameToken({ sub: ownerGhii, filename, origin: requester }, ttlSeconds);
        const originBase = await appOriginUrl(config, storage, owner, filename);
        const sep = originBase.includes('?') ? '&' : '?';
        res.json(success(config.nodeId, {
            frame_url: `${originBase}${sep}frame=${encodeURIComponent(token)}`,
            app_origin_url: originBase,
            granted_to: requester,
            expires_in_seconds: ttlSeconds,
            note: 'Use frame_url as an iframe src. The grant names this one origin and no other, and it expires.',
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

        // The draft manifest IS the caller's statement, so every field it can express is passed as
        // stated. What it CANNOT express — pricing, licence, per-locale descriptions — is left
        // unmentioned and carried from the live app. Publishing the draft manifest verbatim, which
        // is what this route used to do, therefore turned a paid app free and dropped its
        // translations every time somebody promoted a draft.
        const out = await publishApp(storage, config, {
            ownerName: owner,
            ownerGhii,
            callerGaii,
            filename,
            data: draft.data,
            mimeType: draft.mimeType,
            requested: {
                name: draft.manifest.name,
                description: draft.manifest.description,
                version: draft.manifest.version || undefined,
                category: draft.manifest.category,
                tags: draft.manifest.tags,
                icon: draft.manifest.icon,
                usesCortex: draft.manifest.usesCortex,
                cortexAgents: draft.manifest.cortex?.agents,
                protection: draft.manifest.protection,
            },
            accessCode: { mode: 'carry' },
            source: 'draft',
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
            return;
        }

        await storage.deleteAppDraft(ownerGhii, filename);

        res.status(201).json(success(config.nodeId, {
            filename,
            version_number: out.versionNumber,
            manifest: out.manifest,
            size: out.size,
            parked: out.parked,
            forkable: out.forkable,
            download_url: out.downloadUrl,
            note: out.isUpdate
                ? `Draft published as version ${out.versionNumber}. It is now the live app; the draft slot is cleared.`
                : 'Draft published as version 1. It is now live; the draft slot is cleared.',
            ...(out.mobileHints.length ? { mobile_hints: out.mobileHints } : {}),
            ...(out.aiLint ? { ai_posture: out.aiLint.posture } : {}),
            ...(out.aiLint?.hints.length ? { ai_hints: out.aiLint.hints } : {}),
        }, [
            { description: 'View all versions', method: 'GET', url: `${out.downloadUrl}/versions` },
        ]));
    });
}
