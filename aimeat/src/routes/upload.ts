/**
 * @file upload.ts
 * @description Presigned upload endpoint. Receives raw file bodies at PUT /v1/upload/:token,
 *   validates the token, enforces size limits, and delegates processing based on upload type
 *   (app, storage, extension, cortex).
 * @structure
 *   - uploadRouter() — Express router factory with single PUT endpoint
 *   - handleAppUpload() — process HTML app uploads
 *   - handleStorageUpload() — process generic file uploads
 *   - handleExtensionUpload() — process extension ZIP uploads
 *   - handleCortexUpload() — process cortex ZIP uploads
 * @usage
 *   import { uploadRouter } from '../routes/upload.js';
 *   app.use(uploadRouter(config, storage));
 * @version-history
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
 */

import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest, ExtensionRecord } from '../storage/interface.js';
import { verifyUploadToken, UploadTokenError } from '../services/upload-token.js';
import { parseExtensionZip, parseCortexZip } from '../services/upload-zip.js';
import { safeUnzip, ZipSecurityError } from '../services/safe-zip.js';
import { SkillValidationError, isAllowedSkillPath } from '../services/skill-md.js';
import { publishSkill, type SkillScope } from '../services/skills.js';
import { parseGAII } from '../utils/gaii.js';
import { lintAppHtmlForMobile } from '../utils/app-mobile-lint.js';
import { invalidateProtectionCache } from '../utils/app-protect.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { ensureAppSubdomain } from './subdomains.js';
import { getEncryptionKey } from '../services/encryption.js';
import { getExtSecretKeys, encryptSecretFields } from '../services/extension-secrets.js';
import { reconcileAfterExtensionWrite } from '../services/exchange-projection.js';
import { checkStorageQuota, chargeOverage } from '../services/quota.js';

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
                    await handleAppUpload(res, config, storage, verified.sub, verified.meta, data);
                    return;
                case 'storage':
                    await handleStorageUpload(res, config, storage, verified.sub, verified.meta, data);
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
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    // `sub` is the presigned token subject: a full GAII (agent#owner@node) for
    // agent uploads, or the owner's GHII (owner@node) for owner uploads. Either
    // way the canonical app bucket is the owner GHII and the display/URL name is
    // the BARE owner — never the @node-suffixed form, which would fork the app
    // into a second bucket (see canonicalOwner() in routes/apps.ts).
    const parsed = parseGAII(sub);
    const ownerName = parsed ? parsed.owner : (sub.includes('@') ? sub.split('@')[0] : sub);
    const ownerGaii = parsed ? `${parsed.owner}@${parsed.node}` : sub;
    const filename = meta.filename as string;

    const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
    const newVersion = existingVersion + 1;
    const isUpdate = existingVersion > 0;

    // On an UPDATE, a presigned publish that omits metadata must NEVER blank what the live
    // app already declares — MCP callers rarely resend every field, and the presigned meta
    // cannot express some of them at all. Mirrors POST /v1/apps: the NAME, the version,
    // description, per-locale descriptions, category, tags, icon, pricing, copy-protection,
    // forkable and the operator-hidden state all carry forward when the meta leaves them out.
    //
    // The name and the version were missing from that list while every other field was in it,
    // which is the worst possible place for an omission: they are the two a person actually reads.
    // A run of routine re-publishes renamed five live apps to their own filenames in the public
    // catalogue, and nothing in the response said so.
    const existingApp = isUpdate ? await storage.getApp(ownerGaii, filename) : null;
    const prev = existingApp?.manifest;

    const metaDescription = typeof meta.description === 'string' ? meta.description.trim() : '';
    const metaTags = Array.isArray(meta.tags)
        ? (meta.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined;

    const manifest: AppManifest = {
        name: (meta.name as string) ?? prev?.name ?? filename.replace(/\.html?$/i, ''),
        description: metaDescription || (prev?.description ?? ''),
        version: (meta.version as string) ?? prev?.version ?? `1.0.${newVersion - 1}`,
        category: (meta.category as string) ?? prev?.category ?? 'tool',
        tags: metaTags ?? prev?.tags ?? [],
        authorDisplay: ownerName,
        usesCortex: [],
    };
    if (meta.icon) manifest.icon = meta.icon as string;
    else if (prev?.icon) manifest.icon = prev.icon;
    if (prev?.descriptions) manifest.descriptions = prev.descriptions;
    if (typeof prev?.priceMorsels === 'number' && prev.priceMorsels > 0) manifest.priceMorsels = prev.priceMorsels;
    if (prev?.licenseType) manifest.licenseType = prev.licenseType;
    if (prev?.protection && Object.values(prev.protection).some(Boolean)) manifest.protection = prev.protection;

    // The presigned meta cannot carry cortex refs or crew-defs, so usesCortex + cortex.agents
    // are ALWAYS carried from the live app — a re-upload never silently strips them.
    if (prev?.usesCortex?.length) manifest.usesCortex = prev.usesCortex;
    if (prev?.cortex?.agents?.length) manifest.cortex = prev.cortex;

    // A re-publish changes the bytes → drop any cached obfuscated/locked base.
    invalidateProtectionCache(ownerName, filename);

    await storage.createApp({
        ownerGaii,
        ownerName,
        filename,
        versionNumber: newVersion,
        manifest,
        mimeType: 'text/html',
        size: data.length,
        data,
        parked: !!existingApp?.parked,
        forkable: !!existingApp?.forkable,
        operatorHidden: !!existingApp?.operatorHidden,
        operatorHiddenBy: existingApp?.operatorHiddenBy,
        operatorHiddenAt: existingApp?.operatorHiddenAt,
        operatorHideReason: existingApp?.operatorHideReason,
        createdAt: new Date().toISOString(),
    });

    // Provision the per-app subdomain mapping NOW — mirrors POST /v1/apps; previously it was
    // only auto-assigned on the first path-form open, so a brand-new app's vanity subdomain
    // 404'd until someone hit the canonical URL. Best-effort: never fails the publish.
    if (/\.html?$/i.test(filename)) {
        try {
            await ensureAppSubdomain(storage, config, ownerName, filename);
        } catch (err) {
            // Never fails the publish, but the app's vanity subdomain will 404 until someone opens
            // the canonical path form — which reads as a broken app rather than a missing mapping.
            logger.warn('Subdomain provisioning failed after publish; the vanity URL will 404 until the canonical path is opened',
                { filename, owner: ownerName, error: (err as Error).message });
        }
    }

    const downloadUrl = `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`;
    logger.info(`App ${isUpdate ? 'updated' : 'published'} via upload: ${filename} v${newVersion}`, { by: sub });
    emitResourceListChanged(sub);

    // Non-blocking mobile hints — same static lint as the inline publish path; surfaced so the
    // builder catches phone-overflow bugs (missing viewport, grid 1fr blowout) before users do.
    const mobileHints = lintAppHtmlForMobile(data.toString('utf8'));

    res.json({
        success: true,
        type: 'app',
        filename,
        version_number: newVersion,
        name: manifest.name,
        size: data.length,
        is_update: isUpdate,
        download_url: downloadUrl,
        inline_url: `${downloadUrl}?mode=inline`,
        ...(mobileHints.length ? { mobile_hints: mobileHints } : {}),
    });
}

// ── Handler: Storage ──

async function handleStorageUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    const key = meta.key as string;
    const visibility = (meta.visibility as 'private' | 'owner' | 'public') ?? 'private';
    const mimeType = (meta.mime_type as string) ?? 'application/octet-stream';

    // The token's maxBytes caps ONE file; the account-wide quota (M-2 §8.4) is a separate gate that
    // only the inline POST /v1/storage used to run. Without it here, the presigned route was an
    // unmetered way past the storage quota — and it is now the route the SPA's DM attachments take.
    const quota = await checkStorageQuota(config, storage, sub, data.length);
    if (!quota.allowed) {
        res.status(413).json({ success: false, error: 'QUOTA_EXCEEDED', message: quota.reason });
        return;
    }

    const file = await storage.createStorageFile({
        key,
        ownerGaii: sub,
        visibility,
        mimeType,
        size: data.length,
        data,
        createdAt: new Date().toISOString(),
    });

    // M-3: charge overage morsels exactly as the inline path does (§15).
    if (quota.overageMorsels > 0) {
        await chargeOverage(storage, sub, quota.overageMorsels, 'storage_overage');
    }

    emitResourceListChanged(sub);

    res.json({
        success: true,
        type: 'storage',
        key: file.key,
        owner_gaii: file.ownerGaii,
        size: file.size,
        mime_type: mimeType,
        visibility,
        // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file to
        // that workspace's members on save (never the public internet) — use it, not /v1/storage/<key>.
        embed_url: pubEmbedUrl(file.ownerGaii, file.key),
        embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
    });
}

// ── Handler: Extension ──

async function handleExtensionUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    const result = await parseExtensionZip(data, config);
    if (!result.ok) {
        res.status(400).json({ success: false, error: result.code ?? 'VALIDATION_FAILED', message: result.error });
        return;
    }

    // The token subject is a full GAII (agent#owner@node) for agent uploads and the owner's GHII
    // (owner@node) for owner / app-grant uploads. parseGAII returns null for the GHII form, so
    // `parseGAII(sub)?.owner` alone recorded the extension as installedBy 'upload' AND made the
    // ownership check below vanish by short-circuiting — any owner could then overwrite anyone's
    // extension through a presigned ZIP. Derive the bare owner the way handleAppUpload does.
    const parsedSub = parseGAII(sub);
    const ownerName = parsedSub ? parsedSub.owner : (sub.includes('@') ? sub.split('@')[0] : sub);

    const record = result.record!;
    record.installedBy = ownerName;
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

    // Encrypt `type: secret` config values before they are stored, exactly as POST/PUT
    // /v1/extensions do. Without this a ZIP install was a way to write an API key to the database
    // in plaintext.
    const encConfig = encryptSecretFields(record.config, getExtSecretKeys(record), getEncryptionKey(config));
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

// ── Handler: Skill (registry publish via presigned ZIP) ──

/** Skill-directory ZIP layout: SKILL.md (+ scripts/references/assets), optionally inside ONE wrapping dir. */
const SKILL_ZIP_LIMITS = {
    maxFiles: 200,
    maxFileBytes: 5 * 1024 * 1024,     // 5 MB per entry
    maxTotalBytes: 20 * 1024 * 1024,   // 20 MB total decompressed
    maxRatio: 50,
    allowName: (name: string) => {
        const parts = name.split('/');
        const rel = parts.length > 1 ? parts.slice(1).join('/') : name;
        return isAllowedSkillPath(name) || isAllowedSkillPath(rel);
    },
};

async function handleSkillUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    const parsedSub = parseGAII(sub);
    const ownerName = parsedSub ? parsedSub.owner : (sub.includes('@') ? sub.split('@')[0] : sub);
    const metaScope = meta.scope as SkillScope;
    const scope: SkillScope = metaScope === 'node' ? 'node' : metaScope === 'workspace' ? 'workspace' : 'user';
    const visibility = meta.visibility as 'owner' | 'members' | 'public' | undefined;

    let entries: Map<string, Buffer>;
    try {
        entries = await safeUnzip(data, SKILL_ZIP_LIMITS);
    } catch (err) {
        if (err instanceof ZipSecurityError) {
            logger.warn('Skill upload ZIP rejected', { code: err.code, entry: err.entry, by: sub });
            res.status(422).json({ success: false, error: 'ZIP_REJECTED', message: err.message, code: err.code });
            return;
        }
        throw err;
    }

    // Strip a single wrapping directory when every entry shares it (skill-name/SKILL.md ...).
    const names = [...entries.keys()];
    let wrapper: string | undefined;
    const firstSlash = names[0]?.indexOf('/') ?? -1;
    if (firstSlash > 0) {
        const candidate = names[0].slice(0, firstSlash);
        if (names.every(n => n.startsWith(`${candidate}/`))) wrapper = candidate;
    }
    const files = new Map<string, string | Buffer>();
    for (const [name, content] of entries) {
        files.set(wrapper ? name.slice(wrapper.length + 1) : name, content);
    }

    try {
        const summary = await publishSkill(storage, config, {
            scope,
            owner: ownerName,
            publisher: sub,
            files,
            visibility,
            expectedName: wrapper,
            ...(scope === 'workspace' ? {
                organismId: meta.organism as string,
                workspaceId: meta.ws as string,
                accessor: { ownerName, sub, gaii: sub },
            } : {}),
        });
        logger.info(`Skill published via upload: ${summary.ref} v${summary.version}`, { by: sub });
        emitResourceListChanged(sub);
        res.json({ success: true, type: 'skill', skill: summary });
    } catch (err) {
        if (err instanceof SkillValidationError) {
            res.status(422).json({ success: false, error: 'SKILL_INVALID', message: err.message, code: err.code });
            return;
        }
        throw err;
    }
}

// ── Handler: Cortex ──

async function handleCortexUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, data: Buffer,
): Promise<void> {
    const parsed = parseGAII(sub);
    const ownerName = parsed?.owner ?? sub;

    const result = await parseCortexZip(data, config, ownerName);
    if (!result.ok) {
        res.status(400).json({ success: false, error: 'VALIDATION_FAILED', message: result.error });
        return;
    }

    if (result.libs) {
        for (const [filename, content] of Object.entries(result.libs)) {
            await storage.setCortexLibFile(result.extension!.name, filename, content);
        }
    }

    const record = await storage.createCortexExtension(result.extension!);
    logger.info(`Cortex installed via upload: ${record.name}`, { version: record.version, by: sub });
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
