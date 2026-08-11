/**
 * @file src/routes/apps/fork-manage.ts
 * @description App-catalog fork + owner-management routes: POST /v1/apps/:owner/:filename/fork,
 *   PATCH /v1/apps/:filename (rename/access-code/parked/forkable/protection/cortex), DELETE /v1/apps/:filename.
 *   Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v1.3.0 — 2026-08-11 — August 2026 audit step 8: the fork's copy and the delete's bucket sweep go
 *     through services/app-lifecycle.ts, shared with aimeat_app_fork and aimeat_app_delete. The two
 *     gates stay here, because only an HTTP session carries the operator role they consult. The
 *     per-owner fork quota now reads services/install-quotas.ts (via the shared fork) instead of
 *     spelling the same ceiling out a second time.
 *   Fork description limits 2 000 → 10 000 — 2026-07-30.
 *   v1.1.0 — 2026-07-17 — Agent-Bundled Apps: PATCH accepts `cortex` — edit/clear the bundled
 *     crew-defs in place (validated fail-loud like publish) without re-uploading the HTML.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 5: a fork keeps the source's AI transparency posture
 *     and its provenance record. A fork of a generative app is still a generative app, and the
 *     statement used to reset to silence exactly when somebody else took the code over.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppProtection } from '../../storage/interface.js';
import { validateCortexAgents } from '../../models/crew-def-schemas.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { forkApp, deleteOwnedApp } from '../../services/app-lifecycle.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { sanitizeProtection, invalidateProtectionCache } from '../../utils/app-protect.js';
import type { CanonicalOwner } from './helpers.js';

export function registerForkManageRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    canonicalOwner: CanonicalOwner,
): void {
    // POST /v1/apps/:owner/:filename/fork — Fork an app into YOUR OWN catalogue.
    // Authorization has two independent gates, both must pass:
    //   1. Derivative permission — the source owner and the owner's own agents (same
    //      owner component) and operators may always fork; outsiders only when the
    //      source app is flagged `forkable`.
    //   2. Byte-access — a PAID source still requires the caller to be the seller or
    //      hold a license, so a server-side copy never bypasses the read paywall
    //      (mirrors the GET /v1/apps/:owner/:filename gate).
    // On success the source bytes + manifest are copied under the caller's canonical
    // owner as a NEW app (version 1), stamped with `manifest.forkedFrom` provenance,
    // its own `forkable` defaulting to false, and a fork event is recorded for lineage.
    router.post('/v1/apps/:owner/:filename/fork', requireAuth(), async (req, res) => {
        const sourceOwnerParam = req.params.owner as string;
        const sourceFilename = req.params.filename as string;
        const sourceOwner = sourceOwnerParam.includes('@') ? sourceOwnerParam.split('@')[0] : sourceOwnerParam;

        const body = req.body ?? {};
        const newFilename = typeof body.new_filename === 'string' ? body.new_filename.trim() : '';
        const version = body.version !== undefined ? parseInt(String(body.version), 10) : undefined;

        // Load the source app (specific version if given, else latest).
        const source = await storage.getAppByOwnerName(sourceOwner, sourceFilename, version);
        if (!source) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"${version ? ` (version ${version})` : ''}`));
            return;
        }

        const isOperator = req.auth!.roles?.includes('operator') ?? false;
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner: callerOwner, ownerGhii: callerGhii } = await canonicalOwner(req);
        const sameOwner = callerOwner === source.ownerName;

        // Operator-hidden apps are unreachable to everyone but their owner/operator —
        // mirror the read gate's 404 so moderation status is not leaked via fork.
        if (source.operatorHidden && !isOperator && !sameOwner) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"`));
            return;
        }

        // Gate 1 — derivative permission.
        if (!isOperator && !sameOwner && !source.forkable) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'This app is not open for forking by others. Ask the owner to enable forking.'));
            return;
        }

        // Gate 2 — a paid source's bytes must not bypass the paywall.
        if (config.marketplaceEnabled && source.manifest.priceMorsels && source.manifest.priceMorsels > 0 && !sameOwner && !isOperator) {
            const hasLicense = await storage.hasValidLicense(req.auth!.sub, source.ownerGaii, sourceFilename);
            if (!hasLicense) {
                res.status(402).json(error(config.nodeId, 'PURCHASE_REQUIRED', `This app costs ${source.manifest.priceMorsels} morsels. Purchase it first via POST /v1/app-store/purchase before forking.`));
                return;
            }
        }

        // Past the gates it is services/app-lifecycle.ts — the same copy aimeat_app_fork performs:
        // the target-name check, the shadowing check, the per-owner quota, the manifest with the
        // source's paid terms and private notes removed, the bytes, the screenshot, the lineage
        // event, the change log and the public feed.
        const out = await forkApp(storage, config, {
            source,
            callerOwner,
            callerGhii,
            callerGaii,
            newFilename,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }

        res.status(201).json(success(config.nodeId, {
            filename: out.filename,
            version_number: out.versionNumber,
            manifest: out.manifest,
            forkable: false,
            forked_from: out.forkedFrom,
            download_url: out.downloadUrl,
            versions_url: `${out.downloadUrl}/versions`,
            note: `Forked "${sourceFilename}" into your catalogue as "${out.filename}".`,
        }, [
            { description: 'Open the fork', method: 'GET', url: `${out.downloadUrl}?mode=inline` },
        ]));
    });

    // PATCH /v1/apps/:filename — Update an app you own (requires auth). Accepts
    // `name` / `description` (rename / re-describe in place, no re-publish),
    // `access_code` (set/remove protection), `parked` (hide from / restore to the
    // public catalogue) and/or `forkable` (allow others to fork). Fields are
    // independent: each is applied only when present.
    router.patch('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const filename = req.params.filename as string;

        // Same lookup order as DELETE: canonical owner-GHII bucket first,
        // then agent-GAII shadow bucket (pre-fix rows), then bare owner,
        // then a last-resort lookup by ownerName across all buckets.
        let app = await storage.getApp(ownerGhii, filename);
        let effectiveGaii = ownerGhii;
        if (!app) {
            app = await storage.getApp(callerGaii, filename);
            if (app) effectiveGaii = callerGaii;
        }
        if (!app) {
            app = await storage.getApp(owner, filename);
            if (app) effectiveGaii = owner;
        }
        if (!app) {
            const found = await storage.getAppByOwnerName(owner, filename);
            if (found && found.ownerName === owner) { app = found; effectiveGaii = found.ownerGaii; }
        }
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
            return;
        }

        const body = req.body ?? {};

        // Each field is independent and only touched when present in the body, so a
        // parked-only PATCH never clears the access code (and vice-versa).
        const notes: string[] = [];

        // Rename / re-describe in place: the display name is metadata, the URL is
        // keyed off owner/filename, so this never changes the link. Only the latest
        // version's manifest is updated (the version the catalogue surfaces).
        const metaUpdate: { name?: string; description?: string; descriptions?: Record<string, string> } = {};
        if ('name' in body) {
            if (typeof body.name !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name must be a string'));
                return;
            }
            const trimmedName = body.name.trim();
            if (trimmedName.length < 1 || trimmedName.length > 120) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name must be 1-120 characters'));
                return;
            }
            metaUpdate.name = trimmedName;
        }
        if ('description' in body) {
            if (typeof body.description !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description must be a string'));
                return;
            }
            const trimmedDesc = body.description.trim();
            if (trimmedDesc.length > 10_000) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description must be at most 10000 characters'));
                return;
            }
            if (trimmedDesc.length === 0) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'description cannot be empty — apps require a description'));
                return;
            }
            metaUpdate.description = trimmedDesc;
        }
        // Per-locale descriptions (EN/FI, extensible): a `{ locale: text }` map. Each value is a
        // string ≤2000 chars; blank values are dropped. Additive — the canonical `description` stays.
        if ('descriptions' in body) {
            if (typeof body.descriptions !== 'object' || body.descriptions === null || Array.isArray(body.descriptions)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'descriptions must be an object mapping locale → text'));
                return;
            }
            const cleaned: Record<string, string> = {};
            for (const [loc, val] of Object.entries(body.descriptions as Record<string, unknown>)) {
                if (typeof val !== 'string') {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `descriptions.${loc} must be a string`));
                    return;
                }
                const trimmed = val.trim();
                if (trimmed.length > 10_000) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `descriptions.${loc} must be at most 10000 characters`));
                    return;
                }
                if (trimmed.length > 0) cleaned[loc] = trimmed;
            }
            metaUpdate.descriptions = cleaned;
        }
        if (metaUpdate.name !== undefined || metaUpdate.description !== undefined || metaUpdate.descriptions !== undefined) {
            await storage.updateAppMeta(effectiveGaii, filename, metaUpdate);
            if (metaUpdate.name !== undefined && metaUpdate.description !== undefined) {
                notes.push('Name and description updated. The app link is unchanged.');
            } else if (metaUpdate.name !== undefined) {
                notes.push('Name updated. The app link is unchanged.');
            } else {
                notes.push('Description updated.');
            }
        }

        // Agent-Bundled Apps: edit the bundled crew-defs in place, without re-publishing the
        // HTML. Same fail-loud gate as publish (a malformed agents[] never lands in a manifest);
        // `cortex: null` or `{ "agents": [] }` removes the section entirely.
        if ('cortex' in body) {
            if (body.cortex === null || (typeof body.cortex === 'object' && !Array.isArray(body.cortex)
                && Array.isArray(body.cortex.agents) && body.cortex.agents.length === 0)) {
                await storage.updateAppMeta(effectiveGaii, filename, { cortex: null });
                notes.push('Bundled agents removed from the manifest.');
            } else {
                if (typeof body.cortex !== 'object' || Array.isArray(body.cortex)) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'cortex must be an object (e.g. { "agents": [ ... ] }) or null to clear'));
                    return;
                }
                const check = validateCortexAgents((body.cortex as Record<string, unknown>).agents);
                if (!check.ok) {
                    res.status(400).json(error(config.nodeId, 'INVALID_CREW_DEF', check.errors.join('; ')));
                    return;
                }
                await storage.updateAppMeta(effectiveGaii, filename, {
                    cortex: { agents: check.agents as unknown as Record<string, unknown>[] },
                });
                notes.push(`Bundled agents updated (${check.agents.length} crew-def${check.agents.length === 1 ? '' : 's'}).`);
            }
        }

        if ('access_code' in body) {
            const access_code = body.access_code;
            const newCode = typeof access_code === 'string' && access_code.length > 0 ? access_code : undefined;
            if (newCode && (newCode.length < 4 || newCode.length > 64)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'access_code must be 4-64 characters'));
                return;
            }
            await storage.updateAppAccessCode(effectiveGaii, filename, newCode);
            notes.push(newCode
                ? 'Access code updated. Share the new code with recipients.'
                : 'Access code removed. The app is now publicly downloadable.');
        }

        if ('parked' in body) {
            if (typeof body.parked !== 'boolean') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'parked must be a boolean'));
                return;
            }
            await storage.setAppParked(effectiveGaii, filename, body.parked);
            notes.push(body.parked
                ? 'App parked. It is now hidden from the public catalogue but stays usable by you.'
                : 'App unparked. It is published in the public catalogue again.');
        }

        if ('forkable' in body) {
            if (typeof body.forkable !== 'boolean') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'forkable must be a boolean'));
                return;
            }
            await storage.setAppForkable(effectiveGaii, filename, body.forkable);
            notes.push(body.forkable
                ? 'Forking enabled. Anyone can now fork this app into their own catalogue.'
                : 'Forking disabled. Only you and your agents can fork this app.');
        }

        if ('protection' in body) {
            const sanitized = sanitizeProtection(body.protection);
            if (sanitized === undefined) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'protection must be an object of booleans (obfuscate, domainLock, watermark, noRawDownload)'));
                return;
            }
            const toStore: AppProtection = Object.values(sanitized).some(Boolean) ? sanitized : {};
            await storage.updateAppMeta(effectiveGaii, filename, { protection: toStore });
            invalidateProtectionCache(owner, filename);
            const on = Object.entries(toStore).filter(([, v]) => v).map(([k]) => k);
            notes.push(on.length
                ? `Copy-protection updated (${on.join(', ')}). Note: these raise the cost of casual copying and make leaks traceable — they cannot stop someone who can view the app from copying its HTML. To truly protect logic/data, move it into an extension.`
                : 'Copy-protection cleared.');
        }

        if (notes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide at least one field to update (name, description, access_code, parked, forkable or protection).'));
            return;
        }

        // Re-read so the response reflects the app's current state after the update(s).
        const updated = await storage.getApp(effectiveGaii, filename);

        res.json(success(config.nodeId, {
            filename,
            name: updated?.manifest?.name,
            description: updated?.manifest?.description,
            protected: !!updated?.accessCode,
            parked: !!updated?.parked,
            forkable: !!updated?.forkable,
            protection: updated?.manifest?.protection ?? null,
            download_url: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`,
            note: notes.join(' '),
        }));
        emitChange('apps');
    });

    // DELETE /v1/apps/:filename — Remove an app you own (supports ?version=N)
    // Apps are owner-scoped: an agent acting on behalf of its owner can delete
    // the owner's apps. To clean up "ghost" rows created by old buggy publish
    // paths (different ownerGaii buckets for the same owner+filename), the
    // no-version case sweeps ALL buckets that match the owner name. A
    // single-version delete still targets one bucket (you might want to keep
    // versions in one bucket while removing a stray version from another).
    router.delete('/v1/apps/:filename', requireAuth(), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const filename = req.params.filename as string;
        const versionParam = req.query.version as string | undefined;
        const version = versionParam ? parseInt(versionParam, 10) : undefined;

        // The bucket sweep, the screenshot removal and the change-log line are
        // services/app-lifecycle.ts — the same function aimeat_app_delete calls. That tool used to
        // delete a single bucket and nothing else, so a ghost row from an old publish path survived
        // an agent's delete and its screenshot stayed in storage.
        const out = await deleteOwnedApp(storage, {
            ownerName: owner,
            ownerGhii,
            callerGaii,
            filename,
            version,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }

        res.json(success(config.nodeId, {
            filename,
            version_deleted: out.versionDeleted,
            note: version ? `Version ${version} deleted.` : 'App deleted (all versions).',
        }));
    });
}
