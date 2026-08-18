/**
 * @file src/routes/apps/drafts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App-catalog draft (staging) routes: PUT /v1/apps/:owner/:filename/draft, POST .../draft/
 *   preview-token, DELETE .../draft, POST .../publish-draft. Edit + test the next version without
 *   touching the live one. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v2.4.0 — 2026-08-16 — Four routes for incremental editing: .../draft/write appends a piece,
 *     .../draft/replace does an exact old to new, .../draft/lines returns a bounded range, and
 *     .../draft/seed copies a published version back into the slot. PUT .../draft takes the WHOLE
 *     app base64-encoded in one request, which suits a client holding the file and is impossible
 *     for a caller composing one, since no model emits 400 kB in a single response. These take
 *     plain text, and each asks for `app:write` rather than requireAuth alone.
 *   v2.3.0 — 2026-08-11 — August 2026 audit step 8: the draft save, the discard and the promotion go
 *     through services/app-lifecycle.ts, shared with aimeat_app_draft_save / _discard / _publish.
 *     The two manifest builders disagreed on the default category for a NEW app ('utility' here and
 *     in publishApp, 'tool' over MCP), and the nine-field draft→publish mapping was written out
 *     twice. What stays here: the body decode, and this door's own "no draft" wording.
 *   v2.2.0 — 2026-08-11 — publish-draft accepts `spec_token` / `spec_ack` and echoes `spec_check`,
 *     `app_hints` and `next_steps`. A blocking artifact finding refuses the promotion AND leaves the
 *     draft in place, so the fix has something to be applied to.
 *   v2.1.0 — 2026-08-01 — TARGET-058: publish-draft accepts `ai_provenance` / `ai_provenance_id`.
 *     aimeat_app_draft_publish has advertised both since Phase 4 and this route never read them, so
 *     the declaration died at the last hop before the mint.
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
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { generateDraftToken, generateFrameToken } from '../../services/draft-token.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection } from '../../utils/app-protect.js';
import { stageAppDraft, discardAppDraft, publishAppDraft } from '../../services/app-lifecycle.js';
import {
    writeAppDraft, replaceInAppDraft, readAppDraft, seedAppDraft,
} from '../../services/app-draft-edit.js';
import { parseDeclaredProvenanceInput } from '../../mcp/ai-provenance-input.js';
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

        // The filename rule, the size cap and the manifest that inherits from the live app are
        // services/app-lifecycle.ts — the same function aimeat_app_draft_save calls. This route maps
        // its JSON body onto that one shape and nothing more.
        const staged = await stageAppDraft(storage, config, {
            ownerName: owner,
            ownerGhii,
            filename,
            data,
            requested: {
                name: typeof name === 'string' ? name : undefined,
                description: typeof description === 'string' ? description : undefined,
                category: typeof category === 'string' ? category : undefined,
                tags: Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === 'string') : undefined,
                icon: typeof icon === 'string' ? icon : undefined,
                usesCortex: Array.isArray(uses_cortex)
                    ? uses_cortex.filter((c: unknown): c is string => typeof c === 'string') : undefined,
                protection: sanitizeProtection(protection),
                mimeType: typeof mime_type === 'string' ? mime_type : undefined,
            },
        });
        if ('refusal' in staged) {
            res.status(staged.refusal.status).json(error(
                config.nodeId, staged.refusal.code, staged.refusal.message, staged.refusal.status, staged.refusal.details));
            return;
        }

        res.json(success(config.nodeId, {
            filename,
            saved: true,
            size: staged.size,
            updated_at: staged.updatedAt,
            has_live_version: staged.hasLiveVersion,
            live_version_number: staged.liveVersionNumber,
            note: 'Draft saved. The live app is unchanged. Mint a preview token to test it, then publish the draft when ready.',
        }, [
            { description: 'Get a preview URL', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/preview-token` },
            { description: 'Publish the draft', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft` },
        ]));
    });

    // ── Incremental draft editing ─────────────────────────────────────────────────
    // The four routes below exist because PUT .../draft is all-or-nothing: it takes the WHOLE app,
    // base64-encoded, in one request. That is fine for a client with the file on disk and impossible
    // for an agent authoring one, since no model emits 400 kB in a single response. These take PLAIN
    // TEXT rather than base64 — the caller is composing HTML, not moving a file, and base64 would
    // inflate the body by a third for nothing. Their MCP twins call the same service functions.

    // POST /v1/apps/:owner/:filename/draft/write — append a piece, or replace the whole draft.
    router.post('/v1/apps/:owner/:filename/draft/write', requireAuth(), requireScope('app:write'), async (req, res) => {
        const filename = req.params.filename as string;
        const { owner, ownerGhii } = await canonicalOwner(req);
        const { content, mode, expected_size_bytes, name, description } = req.body ?? {};

        if (typeof content !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required (plain UTF-8 text, not base64)'));
            return;
        }
        if (mode !== undefined && mode !== 'append' && mode !== 'replace') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'mode must be "append" or "replace"'));
            return;
        }
        if (expected_size_bytes !== undefined && typeof expected_size_bytes !== 'number') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'expected_size_bytes must be a number'));
            return;
        }

        const out = await writeAppDraft(storage, config, {
            ownerName: owner, ownerGhii, filename, content, mode,
            expectedSizeBytes: expected_size_bytes,
            requested: {
                name: typeof name === 'string' ? name : undefined,
                description: typeof description === 'string' ? description : undefined,
            },
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }
        res.json(success(config.nodeId, {
            filename,
            mode: mode ?? 'append',
            size: out.size,
            updated_at: out.updatedAt,
            has_live_version: out.hasLiveVersion,
            live_version_number: out.liveVersionNumber,
        }, [
            { description: 'Publish the draft', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft` },
        ]));
    });

    // POST /v1/apps/:owner/:filename/draft/replace — exact old → new inside the draft.
    router.post('/v1/apps/:owner/:filename/draft/replace', requireAuth(), requireScope('app:write'), async (req, res) => {
        const filename = req.params.filename as string;
        const { owner, ownerGhii } = await canonicalOwner(req);
        const { old_string, new_string, replace_all } = req.body ?? {};

        if (typeof old_string !== 'string' || typeof new_string !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'old_string and new_string are both required strings'));
            return;
        }

        const out = await replaceInAppDraft(storage, config, {
            ownerName: owner, ownerGhii, filename,
            oldString: old_string, newString: new_string,
            replaceAll: replace_all === true,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }
        res.json(success(config.nodeId, {
            filename,
            replacements: out.replacements,
            size: out.size,
            updated_at: out.updatedAt,
        }, [
            { description: 'Publish the draft', method: 'POST', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft` },
        ]));
    });

    // GET /v1/apps/:owner/:filename/draft/lines — a line range of the draft, as text.
    // Distinct from GET .../draft, which returns the WHOLE slot base64-encoded: that is the right
    // answer for a client restoring its working copy and the wrong one for a caller that wants the
    // twenty lines it is about to change.
    router.get('/v1/apps/:owner/:filename/draft/lines', requireAuth(), requireScope('app:write'), async (req, res) => {
        const filename = req.params.filename as string;
        const { ownerGhii, owner } = await canonicalOwner(req);
        const rawOffset = req.query.offset;
        const rawLimit = req.query.limit;

        const out = await readAppDraft(storage, {
            ownerName: owner, ownerGhii, filename,
            offset: typeof rawOffset === 'string' ? Number(rawOffset) : undefined,
            limit: typeof rawLimit === 'string' ? Number(rawLimit) : undefined,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }
        res.json(success(config.nodeId, {
            filename: out.filename,
            size: out.sizeBytes,
            total_lines: out.totalLines,
            from_line: out.fromLine,
            to_line: out.toLine,
            has_more: out.hasMore,
            mime_type: out.mimeType,
            updated_at: out.updatedAt,
            content: out.content,
        }));
    });

    // POST /v1/apps/:owner/:filename/draft/seed — copy a published version into the slot.
    router.post('/v1/apps/:owner/:filename/draft/seed', requireAuth(), requireScope('app:write'), async (req, res) => {
        const filename = req.params.filename as string;
        const { owner, ownerGhii } = await canonicalOwner(req);
        const { from_filename, version } = req.body ?? {};

        if (version !== undefined && typeof version !== 'number') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'version must be a number'));
            return;
        }

        const out = await seedAppDraft(storage, config, {
            ownerName: owner, ownerGhii, filename,
            fromFilename: typeof from_filename === 'string' ? from_filename : undefined,
            version,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }
        res.json(success(config.nodeId, {
            filename,
            seeded_from: out.seededFrom,
            seeded_version: out.seededVersion,
            size: out.size,
            updated_at: out.updatedAt,
        }, [
            { description: 'Read a range to edit', method: 'GET', url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/lines` },
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
        const deleted = await discardAppDraft(storage, ownerGhii, filename);
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

        // The declaration belongs to the PUBLISH, not to the draft save: promoting a draft is the act
        // that puts bytes in front of readers, and it is the moment the publisher is answering for how
        // they were made. Accepted here so aimeat_app_draft_publish's advertised `ai_provenance` has
        // somewhere to land — it reached this route and was dropped, like the other two doors.
        const { ai_provenance, ai_provenance_id, spec_token, spec_ack } = req.body ?? {};
        const declared = parseDeclaredProvenanceInput(ai_provenance);
        if (!declared.ok) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Invalid ai_provenance declaration.', 400, { violations: declared.violations }));
            return;
        }

        // The promotion — the draft manifest mapped onto the publish input, publishApp, and the slot
        // cleared afterwards — is services/app-lifecycle.ts, shared with aimeat_app_draft_publish.
        // The draft manifest IS the caller's statement, so every field it can express is passed as
        // stated; what it CANNOT express (pricing, licence, per-locale descriptions) is left
        // unmentioned and carried from the live app.
        const out = await publishAppDraft(storage, config, {
            ownerName: owner,
            ownerGhii,
            callerGaii,
            filename,
            draft,
            declaredProvenanceId: typeof ai_provenance_id === 'string' ? ai_provenance_id : undefined,
            declaredProvenance: declared.declared,
            specToken: typeof spec_token === 'string' ? spec_token : undefined,
            specAck: typeof spec_ack === 'string' ? spec_ack : undefined,
        });
        if ('refusal' in out) {
            // The draft SURVIVES a refusal. A broken artifact is something to fix and publish again,
            // and clearing the staging slot would delete the only copy of the work.
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }

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
            spec_check: out.specCheck,
            ...(out.artifactWarnings.length ? { app_hints: out.artifactWarnings } : {}),
            ...(out.nextSteps ? { next_steps: out.nextSteps } : {}),
        }, [
            { description: 'View all versions', method: 'GET', url: `${out.downloadUrl}/versions` },
        ]));
    });
}
