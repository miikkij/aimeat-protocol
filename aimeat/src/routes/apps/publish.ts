/**
 * @file src/routes/apps/publish.ts
 * @description App-catalog publish route: POST /v1/apps — the INLINE door (base64 body), plus the
 *   presigned-mode handshake that mints an upload URL for the other one. Everything the three
 *   publish doors share now lives in services/app-publish.ts; what stays here is the inline door's
 *   own business: validating the payload, decoding the base64, the optional screenshot, and this
 *   route's response document.
 * @version-history
 *   v2.1.0 — 2026-08-01 — TARGET-058: BOTH modes of this route carry a provenance declaration —
 *     the inline body reads `ai_provenance` / `ai_provenance_id`, and the presigned handshake puts
 *     them in the token via buildUploadMeta so the PUT can mint from them. Phase 4 wired the
 *     declaration into the MCP inline branch only; the other three doors accepted the parameter and
 *     discarded it, which is why no app on this node carried a declared record.
 *   v2.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0a: the body of the publish is now
 *     services/app-publish.ts, shared with the presigned-upload and publish-draft doors. Provenance
 *     went missing at a forgotten door in Phase 4 AND in Phase 5, and Phase 5 found the doors had
 *     drifted on far more than provenance — so the fix is one function rather than a fourth copy.
 *   v1.5.0 — 2026-08-01 — TARGET-058 Phase 5: the AI transparency check. An app that requests
 *     `ai:use` and never tells the user a model made what they are reading gets `ai_hints` in the
 *     response and a recorded gap on `manifest.aiPosture` — a WARNING, never a rejection (decision
 *     D2: a publish that fails is a publish that gets worked around, and the app then ships with
 *     less transparency rather than more). A declaration carries forward across updates and forks.
 *   v1.4.0 — 2026-07-22 — priceMorsels + licenseType carry forward on an update that omits them
 *     (an update must never silently turn a paid app free; price_morsels: 0 unprices explicitly).
 *   v1.3.0 — 2026-07-19 — non-blocking `mobile_hints` in the publish response (lintAppHtmlForMobile):
 *     catches the recurring phone-overflow bugs (missing viewport meta, grid 1fr blowout) at publish.
 *   v1.2.0 — 2026-07-19 — provision the per-app subdomain (ensureAppSubdomain) at publish time
 *     so a new app's vanity URL works immediately (pitfall publish/new-app-subdomain-provisioning-lag).
 *   v1.1.0 — 2026-07-16 — Agent-Bundled Apps Slice 1: accept `cortex.agents` (declarative
 *     crew-defs) in the publish payload, validated fail-loud against CrewDefSchema — a
 *     malformed agents[] REJECTS the publish; carried forward on update when omitted.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppManifest } from '../../storage/interface.js';
import { validateCortexAgents } from '../../models/crew-def-schemas.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { generateUploadToken, buildUploadMeta } from '../../services/upload-token.js';
import { parseDeclaredProvenanceInput } from '../../mcp/ai-provenance-input.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { publishApp } from '../../services/app-publish.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { sanitizeProtection } from '../../utils/app-protect.js';
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
            name, description, descriptions, version: semver, category, tags, icon,
            uses_cortex, cortex, price_morsels, license_type, protection,
            ai_provenance, ai_provenance_id,
        } = req.body ?? {};

        // Validated at the door, against the SAME block every other surface uses. A malformed
        // declaration is a 400 rather than a silently dropped field: dropping it is what this route
        // used to do by never reading the key at all, and the result was an app that published
        // successfully with no record while its author believed they had declared one.
        const declared = parseDeclaredProvenanceInput(ai_provenance);
        if (!declared.ok) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Invalid ai_provenance declaration.', 400, { violations: declared.violations }));
            return;
        }

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
                // filename — NUOTTA became "nuotta.html" in the catalogue, in public. buildUploadMeta
                // keeps that property (it drops undefined) and adds the carry-over list's guarantee
                // that a newly accepted option cannot be forgotten here — which is how the
                // provenance declaration went missing on this door.
                meta: buildUploadMeta('app', {
                    filename, description, category, tags, icon,
                    ...(typeof req.body.name === 'string' ? { name: req.body.name } : {}),
                    ...(typeof semver === 'string' ? { version: semver } : {}),
                    ai_provenance, ai_provenance_id,
                }),
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

        const out = await publishApp(storage, config, {
            ownerName: owner,
            ownerGhii,
            callerGaii,
            filename,
            data,
            mimeType: typeof mime_type === 'string' ? mime_type : 'text/html',
            requested: {
                name: typeof name === 'string' ? name : undefined,
                description: typeof description === 'string' ? description : undefined,
                descriptions: descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)
                    ? descriptions as Record<string, string> : undefined,
                version: typeof semver === 'string' ? semver : undefined,
                category: typeof category === 'string' ? category : undefined,
                tags: Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === 'string') : undefined,
                icon: typeof icon === 'string' ? icon : undefined,
                usesCortex: Array.isArray(uses_cortex)
                    ? uses_cortex.filter((c: unknown): c is string => typeof c === 'string') : undefined,
                cortexAgents,
                priceMorsels: typeof price_morsels === 'number' ? price_morsels : undefined,
                licenseType: license_type === 'single' || license_type === 'lifetime'
                    ? license_type as AppManifest['licenseType'] : undefined,
                protection: sanitizeProtection(protection),
            },
            // The inline door is the only one whose payload can carry an access code, so it states
            // one explicitly. The other two carry the live app's forward — they have no way to say.
            accessCode: { mode: 'explicit', value: accessCode },
            source: 'inline',
            declaredProvenanceId: typeof ai_provenance_id === 'string' ? ai_provenance_id : undefined,
            declaredProvenance: declared.declared,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
            return;
        }

        // Handle optional screenshot upload (still uses file storage). Inline-only: it rides in this
        // route's body and there is nothing equivalent on the other two doors.
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
                createdAt: new Date().toISOString(),
            });
            hasScreenshot = true;
        }

        res.status(201).json(success(config.nodeId, {
            filename,
            version_number: out.versionNumber,
            manifest: out.manifest,
            size: out.size,
            mime_type: out.mimeType,
            protected: !!out.accessCode,
            parked: out.parked,
            forkable: out.forkable,
            has_screenshot: hasScreenshot,
            download_url: out.downloadUrl,
            versions_url: `${out.downloadUrl}/versions`,
            screenshot_url: hasScreenshot ? `${out.downloadUrl}/screenshot` : null,
            note: out.isUpdate
                ? `App updated to version ${out.versionNumber}. Previous version${out.versionNumber > 2 ? 's are' : ' is'} preserved.`
                : 'App published. Others can download this file and open it locally.',
            ...(out.mobileHints.length ? { mobile_hints: out.mobileHints } : {}),
            // Non-blocking, and worded for the model that built the app — that is who reads a publish
            // response. `ai_posture` is what the node now believes; `ai_hints` is what to fix.
            ...(out.aiLint ? { ai_posture: out.aiLint.posture } : {}),
            ...(out.aiLint?.hints.length ? { ai_hints: out.aiLint.hints } : {}),
        }, [
            { description: 'View all versions', method: 'GET', url: `${out.downloadUrl}/versions` },
        ]));
    });
}
