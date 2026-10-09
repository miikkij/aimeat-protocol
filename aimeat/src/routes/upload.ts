/**
 * @file upload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Presigned upload endpoint. Receives raw file bodies at PUT /v1/upload/:token,
 *   validates the token, enforces size limits, and delegates processing based on upload type
 *   (app, storage, extension, cortex, skill, font).
 *
 *   A handler here reads the signed token's meta, unpacks whatever shape the bytes arrive in, and
 *   renders the answer. The decisions belong to the service each capability already has, so the
 *   app, storage and cortex-install paths call services/app-publish.ts, storage-file-write.ts and
 *   cortex-lifecycle.ts, and a cortex replace calls routes/cortex/upsert.ts, rather than restating
 *   their gates. Presigned upload is the endpoint an author is told to use for anything over ~1 kB,
 *   which makes a gate that is missing here a gate that is missing for most real traffic.
 * @structure
 *   - uploadRouter() — Express router factory with single PUT endpoint
 *   - handleAppUpload() — process HTML app uploads
 *   - handleStorageUpload() — process generic file uploads (routes/upload-storage.ts)
 *   - handleExtensionUpload() — process extension ZIP uploads
 *   - handleSkillUpload() — process skill-directory ZIP uploads
 *   - handleCortexUpload() — process cortex ZIP uploads
 *   - respondCortexInstalled() — the cortex answer, shared by its install and replace branches
 * @usage
 *   import { uploadRouter } from '../routes/upload.js';
 *   app.use(uploadRouter(config, storage));
 * @version-history
 *   v1.25.1 — 2026-10-09 — An extension upload over an installed copy keeps its host field values and
 *     its stored secrets (prepareSecretConfigForWrite, the function the other install paths use).
 *   v1.25.0 — 2026-10-08 — The storage handler and declaredFromMeta moved to routes/upload-storage.ts
 *     (max-file-lines); the storage upload passes the token's actor and carries ai_provenance.
 *   v1.24.0 — 2026-10-08 — handleSkillUpload moved to routes/upload-skill.ts (max-file-lines), where it
 *     records the token's provenance declaration against SKILL.md (aiprov E12).
 *   v1.23.0 — 2026-10-03 — utype 'font': a theme face's woff2 for the font manager (services/themes/fonts.ts).
 *   v1.22.0 — 2026-10-02 — design_spec_hint in the app answer (services/app-design-spec.ts).
 *   v1.21.0 — 2026-09-28 — The extension ZIP refuses other code for an extension a managed package install owns.
 *   v1.20.0 — 2026-09-26 — A ZIP under the name of a cortex the uploader installed goes through
 *     upsertCortex, the redeploy PUT /v1/cortex/:name and aimeat_cortex_install update:true run. An
 *     active cortex is taken down and activated again from the new manifest, its actions published
 *     under the uploader; its visibility, install time and seed data stay, and a lib it no longer
 *     names stops being served (secaudit 2026-09, R4 4b).
 *   v1.19.1 — 2026-09-26 — The app, extension, skill and cortex uploads name their owner with
 *     localAccountName, so an upload by a visitor from another node lands under its own name, as the
 *     direct doors already do, never under the local namesake (secaudit 2026-09, F-1).
 *   v1.19.0 — 2026-09-24 — SECURITY (audit A8-1): the cortex ZIP's namespace claim asks the uploading
 *     principal through services/operator-principal.ts, with the agent's current grant from its own
 *     record (a presigned token carries no scopes), so it takes operator:admin as the inline door
 *     does. It was read off the owner record, so every agent of an operator holding cortex:write
 *     carried it.
 *   v1.18.0 — 2026-09-24 — Both ZIP replace doors refuse other code under a version already kept
 *     (409 VERSION_EXISTS) before anything is written, and keep the version they deploy, as PUT
 *     /v1/extensions/:name and PUT /v1/cortex/:name do (secaudit 2026-09, A6-7).
 *   v1.17.1 — 2026-09-13 — The extension ZIP upload refuses a flagged action whose changed text would
 *     break an ODPS length cap, 422 ODPS_FIELD_TOO_LONG, as the other install doors do.
 *   v1.17.0 — 2026-09-13 — handleAppUpload answers with `served_marks_removed` and
 *     `served_marks_note` when the PUT body was a served copy, which publishApp now stores without
 *     the node's serve marks (the developer's decision; services/app-serve-marks-strip.ts).
 *   v1.16.1 — 2026-09-13 — Replacing an existing cortex by ZIP refuses a lib the manifest names that
 *     neither arrives nor is stored (INVALID_MANIFEST), as the install doors do.
 *   v1.16.0 — 2026-09-13 — handleStorageUpload answers with versioned_url, the /v1/pub address plus
 *     ?v=<this write>, the same field POST /v1/storage and aimeat_storage_upload now carry. A
 *     re-upload to the same key was served from browsers' five-minute copies (appdev pitfall
 *     pub-file-cache-stale-assets).
 *   v1.15.0 — 2026-09-13 — handleAppUpload publishes the crew-defs the token carries
 *     (`cortex_agents`), re-validated, and refuses the upload with INVALID_CREW_DEF when they no
 *     longer pass instead of publishing the app without them.
 *   v1.14.0 — 2026-08-23 — handleExtensionUpload derives the owner BEFORE parsing the manifest and
 *     passes it to parseExtensionZip. The builder was being handed the literal string `upload` as
 *     the installer, and config.app compares the named app's owner against exactly that, so a
 *     presigned ZIP could not install any extension that gates an app. It was invisible because
 *     this handler overwrote installedBy on the record afterwards.
 *   v1.13.0 — 2026-08-11 — handleStorageUpload calls services/storage-file-write.ts and
 *     handleCortexUpload's install branch calls services/cortex-lifecycle.ts, so this door stops
 *     being a third copy of two capabilities that got one implementation each in the August 2026
 *     audit's step 8. What it gains by asking the shared code: the anonymous key fence and the
 *     workspace-binding requirement on a stored file, and the operator bypass on the cortex
 *     namespace claim, which POST /v1/cortex and aimeat_cortex_install both apply and this door
 *     did not. Replacing a cortex you already own stays here: installCortex creates and never
 *     replaces, and the in-place upsert lives inline in PUT /v1/cortex/:name rather than in a
 *     service, so there is nothing to call for it yet.
 *   v1.6.0 — 2026-08-11 — handleCortexUpload enforces cortexMaxInstalled on a new name. Omitting the
 *     manifest is the documented way to install anything over ~1 kB, and it was the one road past
 *     the node's install ceiling that both manifest-carrying doors apply.
 *   v1.5.0 — 2026-08-10 — Security audit C-4: handleCortexUpload checks namespace ownership and the
 *     existing cortex's installedBy BEFORE writing any lib file, and replaces its own cortex instead
 *     of failing on the duplicate name. The lib write is an unconditional upsert keyed on the name
 *     from the uploaded manifest, so any owner could overwrite another owner's served JavaScript.
 *   v1.0.0 — 2026-05-02 — Initial implementation
 *   v1.1.0 — 2026-06-09 — handleAppUpload derives a BARE ownerName (never the
 *     @node-suffixed GHII) so presigned publishes land in the same canonical app
 *     bucket as inline publishes (see canonicalOwner in routes/apps.ts).
 *   v1.2.0 — 2026-07-05 — handleSkillUpload: skill-directory ZIPs (utype 'skill') extracted
 *     via the hardened safeUnzip (traversal/symlink/bomb guards + skill-layout allowlist)
 *     and published into the skills registry.
 *   v1.3.0 — 2026-07-11 — handleStorageUpload response carries owner_gaii + embed_url/embed_markdown
 *     (the owner-addressed /v1/pub embed form; see services/doc-images).
 *   v1.4.0 — 2026-07-16 — handleAppUpload carries usesCortex + cortex.agents forward on update
 *     (presigned meta cannot express them; a re-upload never strips cortex deps / bundled agents).
 *   v1.5.0 — 2026-07-19 — handleAppUpload provisions the per-app subdomain at publish time
 *     (mirrors POST /v1/apps; pitfall publish/new-app-subdomain-provisioning-lag).
 *   v1.8.0 — 2026-08-11 — handleAppUpload carries the token's `spec_token` / `spec_ack` into the
 *     shared publish and echoes `spec_check`, `app_hints` and `next_steps`. A blocking artifact
 *     finding (unparseable inline script, 404 asset URL) refuses the upload with its findings.
 *   v1.6.0 — 2026-07-19 — handleAppUpload adds non-blocking `mobile_hints` (lintAppHtmlForMobile),
 *     mirroring the inline publish path, so presigned publishes get the same phone-overflow hints.
 *   v1.7.0 — 2026-07-22 — handleAppUpload full metadata carry-forward on update: description,
 *     per-locale descriptions, category, tags, icon, priceMorsels/licenseType, copy-protection,
 *     forkable and the operator-hidden state survive a presigned re-publish that omits them
 *     (previously an MCP update without a description BLANKED the catalog description, reset the
 *     category to 'tool', dropped the icon/tags and cleared forkable+protection). Also invalidates
 *     the protection cache on re-publish, mirroring POST /v1/apps.
 *   v1.9.0 - 2026-07-26 - handleExtensionUpload stops reporting failures as success. `?? existing`
 *     turned a storage write that did not apply into `200 {success:true, updated:true}` carrying the
 *     OLD record, so an upsert could leave the extension running the previous code while telling the
 *     caller it had shipped. Also: the bare owner is derived the way handleAppUpload does (a GHII
 *     subject recorded installedBy 'upload' and made the ownership check short-circuit away), secret
 *     config is encrypted as on the REST path, EXCHANGE re-projection + capability aggregation run,
 *     and the router's catch-all names the failure instead of answering a blank 500.
 *   v1.10.0 - 2026-07-27 - handleStorageUpload enforces the account-wide storage quota + overage
 *     charge, which only the inline POST /v1/storage ran. The token's maxBytes caps a single file, so
 *     the presigned route was an unmetered way past the quota — and the SPA's DM attachments now take
 *     exactly that route (see public/js/services/messages.js v1.3.0).
 *   v1.8.0 - 2026-07-26 - handleExtensionUpload honours the token meta's `update` and `activate`.
 *     It previously took no meta at all and answered a flat 409 on an existing name, so a caller
 *     that had explicitly requested an upsert was forced into delete + reinstall - which also
 *     throws away the extension's ext:{name} memory. Upsert swaps the same code+metadata field
 *     set as PUT /v1/extensions/:name and preserves lifecycle fields; owner mismatch is 403.
 *   v1.12.0 - 2026-08-01 - TARGET-058: handleAppUpload reads the caller's OWN `ai_provenance` /
 *     `ai_provenance_id` out of the token meta, so a declared statement survives the presigned route.
 *     v1.11.0 below gave this door the node's MINT-3 stamp — what an agent SAID about its own work
 *     still could not get here, because the token never carried it. The publish tool advertised the
 *     parameter and discarded it at mint, which is why no app on the node had a declared record.
 *   v1.11.0 - 2026-08-01 - TARGET-058 Phase 5: handleAppUpload stamps the published bytes with a
 *     provenance record (MINT-3) and runs the AI transparency check, both of which POST /v1/apps has
 *     run and this path had not. Presigned upload is the DEFAULT door for anything over ~1 KB, so it
 *     is the door most agent-published apps come through: publishing the recommended way produced an
 *     app with no record at all, while the identical bytes posted inline were stamped.
 */

import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord, CortexExtensionRecord } from '../storage/interface.js';
import { verifyUploadToken, UploadTokenError } from '../services/upload-token.js';
import { parseExtensionZip, parseCortexZip } from '../services/upload-zip.js';
import { installCortex } from '../services/cortex-lifecycle.js';
import { upsertCortex } from './cortex/upsert.js';
import { keptVersionRefusal, extensionCodeOf, snapshotExtensionVersion } from '../services/component-versions.js';
import { handleStorageUpload, declaredFromMeta } from './upload-storage.js';
import { handleSkillUpload } from './upload-skill.js';
import { parseGAII, localAccountName } from '../utils/gaii.js';
import { operatorName } from '../services/operator-principal.js';
import { publishApp } from '../services/app-publish.js';
import { servedMarksResponse } from '../services/app-serve-marks-strip.js';
import { validateCortexAgents } from '../models/crew-def-schemas.js';
import { effectiveDevLevel, mayAct } from '../services/app-dev-grant.js';
import { accountOf } from '../services/app-members.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';
import { getEncryptionKey } from '../services/encryption.js';
import { prepareSecretConfigForWrite } from '../services/extension-secrets.js';
import { carryHostFieldValues } from '../services/extension-network-hosts.js';
import { reconcileAfterExtensionWrite } from '../services/exchange-projection.js';
import { odpsWriteRefusal, extensionOdpsKey } from '../services/exchange-odps-write.js';
import { managedChangeRefusal } from '../services/packages/install/package-managed.js';
import { receiveFontUpload } from '../services/themes/fonts.js';

export function uploadRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.put('/v1/upload/:token', async (req: Request, res: Response) => {
        const token = req.params.token as string;

        // Verify token
        let verified;
        try {
            verified = await verifyUploadToken(token);
        } catch (err) {
            if (err instanceof UploadTokenError) {
                const status = err.code === 'TOKEN_EXPIRED' ? 410
                    : err.code === 'TOKEN_USED' ? 409
                    : 401;
                res.status(status).json({ success: false, error: err.code, message: err.message });
                return;
            }
            res.status(401).json({ success: false, error: 'TOKEN_INVALID', message: 'Invalid upload token' });
            return;
        }

        // Collect raw body (streaming with size enforcement)
        const chunks: Buffer[] = [];
        let totalSize = 0;

        try {
            for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
                totalSize += chunk.length;
                if (totalSize > verified.maxBytes) {
                    res.status(413).json({
                        success: false,
                        error: 'FILE_TOO_LARGE',
                        message: `Upload exceeds limit of ${verified.maxBytes} bytes`,
                    });
                    return;
                }
                chunks.push(chunk);
            }
        } catch {
            res.status(400).json({ success: false, error: 'STREAM_ERROR', message: 'Failed to read request body' });
            return;
        }

        const data = Buffer.concat(chunks);

        if (data.length === 0) {
            res.status(400).json({ success: false, error: 'EMPTY_BODY', message: 'No file data received' });
            return;
        }

        try {
            switch (verified.utype) {
                case 'app':
                    await handleAppUpload(res, config, storage, verified.sub, verified.actor, verified.meta, data);
                    return;
                case 'storage':
                    await handleStorageUpload(res, config, storage, verified.sub, verified.actor, verified.meta, data);
                    return;
                case 'extension':
                    await handleExtensionUpload(res, config, storage, verified.sub, verified.meta, data);
                    return;
                case 'cortex':
                    await handleCortexUpload(res, config, storage, verified.sub, data);
                    return;
                case 'skill':
                    await handleSkillUpload(res, config, storage, verified.sub, verified.meta, data);
                    return;
                case 'font': {
                    const r = await receiveFontUpload(config, storage, verified.actor, verified.meta, data);
                    res.status(r.status).json(r.body);
                    return;
                }
                default:
                    res.status(400).json({ success: false, error: 'INVALID_TYPE', message: `Unknown upload type` });
            }
        } catch (err) {
            logger.error('Upload processing failed', { error: (err as Error).message, stack: (err as Error).stack, type: verified.utype });
            // The caller holds a presigned token they minted for this exact upload, so naming the
            // failure tells them nothing about anyone else's data — and a bare "Upload processing
            // failed" is unactionable. A ZIP whose manifest had one mis-typed field surfaced as
            // exactly that 500, and the author had no way to learn which field.
            res.status(500).json({
                success: false,
                error: 'PROCESSING_FAILED',
                message: 'Upload processing failed',
                reason: (err as Error).message.slice(0, 300),
            });
        }
    });

    return router;
}

// ── Handler: App ──

async function handleAppUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, actor: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    // `sub` is the presigned token subject: a full GAII (agent#owner@node) for
    // agent uploads, or the owner's GHII (owner@node) for owner uploads. Either
    // way the canonical app bucket is the owner GHII and the display/URL name is
    // the BARE owner — never the @node-suffixed form, which would fork the app
    // into a second bucket (see canonicalOwner() in routes/apps.ts). localAccountName keeps a
    // visitor's own name whole, as the direct publish door does, never the local namesake's.
    const parsed = parseGAII(sub);
    const ownerName = localAccountName(sub);
    const ownerGaii = parsed ? `${parsed.owner}@${parsed.node}` : sub;
    const filename = meta.filename as string;

    // ASKED AGAIN HERE, not just where the token was minted. This is the second door of the publish,
    // and a permission word is enforced on every door or it does not exist: the token names another
    // owner's bucket only because a rung said it could, and the token outlives a revocation by up to
    // its hour. Nothing to check when the caller IS the owner, which is every publish but the shared
    // ones.
    if (accountOf(actor) !== accountOf(ownerName)) {
        const held = await effectiveDevLevel(storage, { owner: ownerName, filename, principal: actor });
        if (!held || !mayAct(held.level, 'publish')) {
            res.status(403).json({
                success: false, error: 'FORBIDDEN',
                message: `You no longer hold a right to publish ${ownerName}'s app.`,
            });
            return;
        }
    }

    // The crew-defs the mint validated, checked once more and REFUSED rather than dropped if they no
    // longer pass: a malformed crew-def must never reach a fleet, and publishing the app without the
    // agents its author declared is the silent drop this token used to make on every upload.
    let cortexAgents: Record<string, unknown>[] | undefined;
    if (meta.cortex_agents !== undefined) {
        const check = validateCortexAgents(meta.cortex_agents);
        if (!check.ok) {
            res.status(400).json({ success: false, error: 'INVALID_CREW_DEF', message: check.errors.join('; ') });
            return;
        }
        cortexAgents = check.agents as unknown as Record<string, unknown>[];
    }

    // Everything from here to the response is services/app-publish.ts, shared with POST /v1/apps and
    // publish-draft. This door's own business is only the token meta → requested-manifest mapping:
    // a presigned publish that omits a field must NEVER blank what the live app declares, and
    // `undefined` is exactly how the shared path is told "not mentioned".
    const out = await publishApp(storage, config, {
        ownerName,
        ownerGhii: ownerGaii,
        // `actor`, not `sub`: an app always lands in the OWNER's bucket, so `sub` is the owner even
        // when an agent is the one publishing. Attributing off `sub` here meant a MINT-3 stamp could
        // never fire on this path at all.
        callerGaii: actor,
        filename,
        data,
        mimeType: 'text/html',
        requested: {
            name: typeof meta.name === 'string' ? meta.name : undefined,
            description: typeof meta.description === 'string' ? meta.description : undefined,
            version: typeof meta.version === 'string' ? meta.version : undefined,
            category: typeof meta.category === 'string' ? meta.category : undefined,
            tags: Array.isArray(meta.tags)
                ? (meta.tags as unknown[]).filter((t): t is string => typeof t === 'string')
                : undefined,
            icon: typeof meta.icon === 'string' ? meta.icon : undefined,
            // Crew-defs were validated at the mint; the re-check above is for a schema that moved
            // inside the token's hour. Cortex refs, pricing, per-locale descriptions and protection
            // are still not in the presigned meta, so each is left unmentioned and carried.
            cortexAgents,
        },
        accessCode: { mode: 'carry' },
        source: 'presigned',
        roadmap: typeof meta.roadmap === 'string' ? meta.roadmap : undefined,
        // The declaration the caller made when they asked for this URL, carried in the signed token.
        // Re-validated rather than trusted: the token is ours and cannot be forged, but a block that
        // no longer parses (an enum retired between mint and PUT, an hour apart at most, but still)
        // must not reach the mint path as a half-shape. An invalid block is dropped, not fatal —
        // refusing the upload would lose the BYTES over a metadata problem, and this door's failure
        // mode has already been "the app is published, the record is missing" once.
        declaredProvenance: declaredFromMeta(meta),
        declaredProvenanceId: typeof meta.ai_provenance_id === 'string' ? meta.ai_provenance_id : undefined,
        // Stated when the URL was minted, carried in the signed token, checked here.
        specToken: typeof meta.spec_token === 'string' ? meta.spec_token : undefined,
        specAck: typeof meta.spec_ack === 'string' ? meta.spec_ack : undefined,
    });
    if ('refusal' in out) {
        res.status(out.refusal.status).json({
            success: false, error: out.refusal.code, message: out.refusal.message,
            ...(out.refusal.details ? { details: out.refusal.details } : {}),
        });
        return;
    }

    logger.info(`App ${out.isUpdate ? 'updated' : 'published'} via upload: ${filename} v${out.versionNumber}`, { by: sub });
    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'app',
        filename,
        ...(out.roadmapHint ? { roadmap_hint: out.roadmapHint } : {}),
        ...(out.designSpecHint ? { design_spec_hint: out.designSpecHint } : {}),
        version_number: out.versionNumber,
        name: out.manifest.name,
        size: out.size,
        is_update: out.isUpdate,
        download_url: out.downloadUrl,
        inline_url: `${out.downloadUrl}?mode=inline`,
        ...(out.mobileHints.length ? { mobile_hints: out.mobileHints } : {}),
        ...(out.aiLint ? { ai_posture: out.aiLint.posture } : {}),
        ...(out.aiLint?.hints.length ? { ai_hints: out.aiLint.hints } : {}),
        spec_check: out.specCheck,
        ...(out.artifactWarnings.length ? { app_hints: out.artifactWarnings } : {}),
        // The same two fields POST /v1/apps renders, from the same function.
        ...servedMarksResponse(out),
        ...(out.nextSteps ? { next_steps: out.nextSteps } : {}),
    });
}

// ── Handler: Storage ── routes/upload-storage.ts (handleStorageUpload, declaredFromMeta)

// ── Handler: Extension ──

async function handleExtensionUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    // Derived BEFORE the manifest is parsed, because the manifest check for config.app compares
    // the named app's owner against the installer. The token subject is a full GAII
    // (agent#owner@node) for agent uploads and the owner's GHII (owner@node) for owner / app-grant
    // uploads. localAccountName gives the owner of either, and keeps a visitor's own name whole, as
    // the inline install door does, so it never installs under the local namesake.
    const ownerName = localAccountName(sub);

    const result = await parseExtensionZip(data, config, ownerName);
    if (!result.ok) {
        res.status(400).json({ success: false, error: result.code ?? 'VALIDATION_FAILED', message: result.error });
        return;
    }

    // The builder has already stamped installedBy from the same derived owner; the ownership check
    // below and the record therefore read one value, not two.
    const record = result.record!;
    record.installedAt = new Date().toISOString();

    // `update`/`activate` ride in the token meta (PRESIGNED_META_KEYS). This handler used to ignore
    // them entirely and answer a flat 409 on an existing name, so a caller that had explicitly asked
    // for an upsert was told the extension already exists and had to delete + reinstall — which also
    // discards the extension's ext: memory.
    const wantUpdate = meta.update === true;
    const wantActivate = meta.activate === true;

    const existing = await storage.getExtension(record.name);
    if (existing && !wantUpdate) {
        res.status(409).json({
            success: false, error: 'ALREADY_EXISTS',
            message: `Extension "${record.name}" is already installed. Re-request the upload URL with update:true to upsert it in place.`,
        });
        return;
    }
    // Ownership is checked unconditionally: an upload whose subject we cannot attribute is refused
    // rather than quietly allowed.
    if (existing && existing.installedBy && existing.installedBy !== ownerName) {
        res.status(403).json({
            success: false, error: 'FORBIDDEN',
            message: `Extension "${record.name}" belongs to another owner`,
        });
        return;
    }

    // A flagged action whose changed text would break an ODPS length cap is refused before the write,
    // as writeExtensionRecord refuses it on the other install doors (2026-09-13).
    const odps = odpsWriteRefusal(extensionOdpsKey(record.name), record, existing);
    if (odps) { res.status(odps.status).json({ success: false, error: odps.code, message: odps.message, details: odps.details }); return; }

    // A kept version is immutable on this door as on PUT /v1/extensions/:name (A6-7).
    const kept = existing ? await keptVersionRefusal(storage, 'extension', record.name, record.version, extensionCodeOf(record)) : null;
    if (kept) { res.status(kept.status).json({ success: false, error: kept.code, message: kept.message }); return; }

    // Other code for an extension a managed package install owns is refused here as on PUT
    // (services/packages/install/package-managed.ts). Config alone is a setting and goes through.
    if (existing && extensionCodeOf(record) !== extensionCodeOf(existing)) {
        const managed = await managedChangeRefusal(storage, existing.installedBy, 'extension', record.name, 'code');
        if (managed) { res.status(managed.status).json({ success: false, error: managed.code, message: managed.message, details: managed.details }); return; }
    }

    // A host field (manifest network.host_fields) keeps the host the installed copy holds, as on
    // PUT /v1/extensions/:name (services/extension-lifecycle.ts).
    if (existing) record.config = carryHostFieldValues(record.config, existing.config);

    // Encrypt `type: secret` config values before they are stored, exactly as POST/PUT
    // /v1/extensions do. Without this a ZIP install was a way to write an API key to the database
    // in plaintext.
    // prepareSecretConfigForWrite, as writeExtensionRecord uses: a secret the new manifest declares
    // without a value keeps the installed copy's stored one. encryptSecretFields alone dropped it, so
    // an upload over an installed copy erased the owner's API key (found 2026-10-09).
    const encConfig = prepareSecretConfigForWrite(record.config, existing?.config, getEncryptionKey(config));
    if (encConfig === null) {
        res.status(503).json({
            success: false, error: 'ENCRYPTION_NOT_CONFIGURED',
            message: 'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to install extensions with secret config.',
        });
        return;
    }
    record.config = encConfig;

    let saved: ExtensionRecord;
    if (existing) {
        // Same field set the REST upsert (PUT /v1/extensions/:name) swaps: code + metadata only.
        // Lifecycle (status, installedBy, installedAt, activatedAt), the ext:{name} memory and any
        // instances are preserved — that preservation is the whole reason to upsert instead of
        // delete + reinstall.
        const updated = await storage.updateExtension(record.name, {
            version: record.version,
            description: record.description,
            author: record.author,
            requiredApis: record.requiredApis,
            actions: record.actions,
            config: record.config,
            limits: record.limits,
            federation: record.federation,
            instances: record.instances,
            ...(wantActivate && existing.status !== 'active'
                ? { status: 'active' as const, activatedAt: new Date().toISOString() }
                : {}),
        });
        // A write that did not happen must never be answered with success. This line used to read
        // `?? existing`, so a storage failure was reported as `200 {success:true, updated:true}`
        // carrying the OLD record: the caller was told the upsert worked while the extension kept
        // running the previous code. That is the worst possible answer — worse than an error,
        // because it ends the investigation.
        if (!updated) {
            logger.error(`Extension upsert wrote nothing via upload: ${record.name}`, { by: sub });
            res.status(500).json({
                success: false, error: 'UPDATE_FAILED',
                message: `Extension "${record.name}" was NOT updated — the storage write did not apply. The installed version is unchanged.`,
            });
            return;
        }
        saved = updated;
    } else {
        if (wantActivate) {
            record.status = 'active';
            record.activatedAt = new Date().toISOString();
        }
        saved = await storage.createExtension(record);
    }
    // Kept like every other install and update, so `name@version` answers for what this door deployed.
    await snapshotExtensionVersion(storage, saved, sub)
        .catch(err => logger.warn('Extension upload: version not kept', { name: saved.name, version: saved.version, error: String(err) }));

    // Parity with the REST and MCP install paths: re-project any EXCHANGE listings the actions
    // declare, and refresh aggregated capabilities when the extension is live.
    await reconcileAfterExtensionWrite(storage, ownerName, config.nodeId, saved.name);
    if (saved.status === 'active') {
        import('../services/capability-aggregator.js')
            .then(m => m.runCapabilityAggregation(config, storage))
            .catch(err => logger.error('Capability aggregation after extension upload failed', { error: String(err) }));
    }

    logger.info(`Extension ${existing ? 'updated' : 'installed'} via upload: ${saved.name}`, { version: saved.version, by: sub, activated: wantActivate });
    emitResourceListChanged(sub);

    // An ACTIVE extension whose manifest declares schedules needs a re-registration this endpoint
    // has no scheduler for — say so instead of letting the author assume the new cron is live.
    const hasSchedules = Array.isArray(saved.config.__schedules) && (saved.config.__schedules as unknown[]).length > 0;
    const scheduleNote = existing && saved.status === 'active' && hasSchedules
        ? 'schedules in the manifest are NOT re-registered by this endpoint — use PUT /v1/extensions/{name} (REST upsert) or deactivate + activate to refresh them'
        : undefined;

    res.json({
        success: true,
        type: 'extension',
        name: saved.name,
        version: saved.version,
        status: saved.status,
        updated: !!existing,
        ...(scheduleNote ? { note: scheduleNote } : {}),
        actions: saved.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
        // Non-blocking sandbox-capability notes (no crypto.subtle in QuickJS, non-deterministic
        // Date.now/Math.random). Surfaced here so a ZIP upload is not a way to miss them.
        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    });
}

// ── Handler: Skill (registry publish via presigned ZIP): routes/upload-skill.ts ──

// ── Handler: Cortex ──

async function handleCortexUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, data: Buffer,
): Promise<void> {
    const ownerName = localAccountName(sub);

    // The ZIP is this door's own business: magic bytes, entry extraction, the manifest.yaml + libs/
    // layout. What comes out of it is the manifest text and the lib sources, which is what the
    // shared install takes.
    const result = await parseCortexZip(data, config, ownerName);
    if (!result.ok) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
        return;
    }
    const incoming = result.extension!;

    // The operator answer buys one thing: a namespace this owner does not own. POST /v1/cortex and
    // the MCP tool both grant it, and this door must answer as they do, or the same bundle installs as
    // an inline manifest and is refused as a ZIP. A presigned token carries neither roles nor scopes,
    // so the question is asked of the principal it names with the grant its own record holds now:
    // an agent passes only while it holds operator:admin (services/operator-principal.ts).
    const agent = sub.includes('#') ? await storage.getAgent(sub) : null;
    const isOperator = (await operatorName(storage, {
        sub,
        ...(agent ? { roles: ['agent'], scopes: agent.defaultScopes ?? [] } : {}),
    })) !== null;

    const existing = await storage.getCortexExtension(incoming.name);

    // ── NEW NAME — services/cortex-lifecycle.ts, the same install POST /v1/cortex and the inline
    //    branch of aimeat_cortex_install run. It re-reads the manifest and applies the manifest and
    //    lib ceilings, the node's cortex ceiling, the namespace claim and the prior-owner check,
    //    every one of them before the first lib byte is written.
    if (!existing) {
        const out = await installCortex({ storage, config }, { ownerName, gaii: sub, isOperator }, {
            manifest: incoming.manifest,
            libs: result.libs,
        });
        if (!out.ok) {
            res.status(out.refusal.status).json({
                success: false, error: out.refusal.code, message: out.refusal.message,
                ...(out.refusal.details ? { details: out.refusal.details } : {}),
            });
            return;
        }
        respondCortexInstalled(res, out.value.record, false, sub);
        return;
    }

    // ── EXISTING NAME — the redeploy PUT /v1/cortex/:name and aimeat_cortex_install update:true run
    //    (routes/cortex/upsert.ts upsertCortex). Re-uploading is how a cortex bundle over ~1 kB is
    //    iterated on, so this endpoint replaces the cortex in place the same way: a lib the manifest names
    //    arrives or is already stored, a kept version never takes other bytes, and an ACTIVE cortex is
    //    taken down and activated again from the new manifest, so no action, board, schema lock or
    //    prompt of the replaced activation stays with nothing pointing at it.
    //
    //    SECURITY (C-4): the cortex NAME comes out of the uploaded manifest, and setCortexLibFile is
    //    an unconditional upsert keyed on (extName, libName) with no owner column. The upsert asks the
    //    namespace claim and whose cortex it is before it writes the first lib byte. Replacing a cortex
    //    another owner installed is refused to an operator too (mayReplaceOthers false), as on the
    //    tool that minted this upload's token.
    //
    //    The token's subject is the uploading principal as its session resolved it (the tool mints it
    //    from an agent's GAII), and a re-activation publishes the cortex's actions under it. A bare
    //    account name is completed to the account's GHII, as resolveIdentity completes an owner's.
    const identity = sub.includes('#') || sub.includes('@') ? sub : `${ownerName}@${config.nodeId}`;
    const out = await upsertCortex({ storage, config }, { ownerName, gaii: sub, identity, isOperator }, {
        name: incoming.name, manifest: incoming.manifest, libs: result.libs,
    }, false);
    if (!out.ok) {
        res.status(out.refusal.status).json({
            success: false, error: out.refusal.code, message: out.refusal.message,
            ...(out.refusal.details ? { details: out.refusal.details } : {}),
        });
        return;
    }
    respondCortexInstalled(res, out.value.record, true, sub);
}

/** The upload's answer, shared by the install branch and the replace branch above. */
function respondCortexInstalled(
    res: Response, record: Pick<CortexExtensionRecord, 'name' | 'namespace' | 'version' | 'status' | 'components'>,
    replaced: boolean, sub: string,
): void {
    logger.info(`Cortex installed via upload: ${record.name}`, { version: record.version, by: sub, replaced });
    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'cortex',
        name: record.name,
        namespace: record.namespace,
        version: record.version,
        status: record.status,
        component_count: record.components.length,
    });
}
