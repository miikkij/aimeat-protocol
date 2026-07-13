/**
 * @file src/routes/ghii/profile.ts
 * @description GHII directory + profile management routes: GET /v1/ghii/list, /directory, CORS
 *   get/put, GET /v1/ghii/me, GET /v1/ghii/:ghii, PUT /v1/ghii, DELETE /v1/ghii. Extracted from
 *   src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/ghii.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';

export function registerProfileRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    onDirectoryChange: (() => void) | undefined,
): void {
    // GET /v1/ghii/list — Search/list human identities (Tier 0, no auth)
    // Note: renamed from /v1/ghii/directory to avoid confusion with /v1/catalogue/directory
    // Must be registered BEFORE the /:ghii param route
    // The member directory ("phone book"). Two privacy guarantees:
    //  1. requireAuth() — you must be a SIGNED-IN user to browse it (the anonymous internet, incl.
    //     the shared anonymous identity, is rejected 401). Was previously world-readable.
    //  2. Opt-in — only members who explicitly listed themselves (PUT /v1/ghii { directory_listed:
    //     true } → the profile.{username}.directory_listed memory key) appear. Default = unlisted.
    router.get('/v1/ghii/list', requireAuth(), async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q : undefined;
        const level = typeof req.query.level === 'string' ? parseInt(req.query.level, 10) : undefined;

        const all = await storage.listGHIIs({
            q,
            level: level !== undefined && !isNaN(level) ? level : undefined,
        });

        // Keep only members who opted in. Best-effort per-profile read of the opt-in key; a caller
        // always sees THEIR OWN entry regardless (so they can confirm their listing took effect).
        const callerOwner = req.auth!.owner;
        const listed = [];
        for (const r of all) {
            if (r.ownerName === callerOwner) { listed.push(r); continue; }
            const optIn = await storage.getMemory(r.ghii, `profile.${r.username}.directory_listed`);
            if (optIn?.value === true) listed.push(r);
        }

        res.json(success(config.nodeId, {
            humans: listed.map(r => ({
                ghii: r.ghii,
                display_name: r.displayName,
                bio: r.bio,
                avatar: r.avatar,
                locale: r.locale,
                verification_level: r.verificationLevel,
                created_at: r.createdAt,
            })),
            total: listed.length,
        }));
    });

    // Backward-compatible redirect: /v1/ghii/directory → /v1/ghii/list
    router.get('/v1/ghii/directory', (req, res) => {
        const qs = Object.keys(req.query).length > 0
            ? '?' + new URLSearchParams(req.query as Record<string, string>).toString()
            : '';
        res.redirect(301, `/v1/ghii/list${qs}`);
    });

    // ── CORS per-GHII management ──

    // GET /v1/ghii/cors — Get your CORS allowed origins
    router.get('/v1/ghii/cors', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        res.json(success(config.nodeId, {
            ghii: ghiiRecord.ghii,
            allowed_origins: ghiiRecord.allowedOrigins ?? null,
            effective: ghiiRecord.allowedOrigins ?? config.corsAllowedOrigins,
            inherited: !ghiiRecord.allowedOrigins,
        }));
    });

    // PUT /v1/ghii/cors — Set your CORS allowed origins
    router.put('/v1/ghii/cors', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        const { allowed_origins } = req.body ?? {};

        // null = inherit from node default, array = explicit origins
        if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to inherit'));
            return;
        }

        if (Array.isArray(allowed_origins)) {
            for (const origin of allowed_origins) {
                if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid origin: ${origin}. Must be an http(s) URL or '*'`));
                    return;
                }
            }
        }

        const updates: Record<string, unknown> = {
            allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
        };

        const updated = await storage.updateGHII(ghiiRecord.ghii, updates);
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update CORS settings'));
            return;
        }

        res.json(success(config.nodeId, {
            ghii: updated.ghii,
            allowed_origins: updated.allowedOrigins ?? null,
            effective: updated.allowedOrigins ?? config.corsAllowedOrigins,
            inherited: !updated.allowedOrigins,
        }));
        emitChange('ghii');
    });

    // GET /v1/ghii/me — Own profile with private fields (auth required)
    // Must be registered before GET /v1/ghii/:ghii to avoid :ghii matching "me"
    router.get('/v1/ghii/me', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        // Directory opt-in state (the member "phone book") — owner-controlled memory key.
        const dirKey = await storage.getMemory(ghiiRecord.ghii, `profile.${ghiiRecord.username}.directory_listed`);
        res.json(success(config.nodeId, {
            ghii: ghiiRecord.ghii,
            display_name: ghiiRecord.displayName,
            bio: ghiiRecord.bio,
            avatar: ghiiRecord.avatar,
            locale: ghiiRecord.locale,
            notification_email: ghiiRecord.notificationEmail ?? null,
            directory_listed: dirKey?.value === true,
            verification_level: ghiiRecord.verificationLevel,
            email_verified_at: ghiiRecord.emailVerifiedAt ?? null,
            // Whether a password has been set. Accounts created via OAuth (e.g. Google
            // sign-in) start without one; the portal uses this to offer "set a password"
            // (no current password required) instead of "change password".
            has_password: !!ghiiRecord.passwordHash,
            // The Ed25519 PUBLIC key generated at registration (stored on the owner
            // record) — the Access tab shows it. The private key is never retrievable;
            // it was returned once at creation.
            public_key: (await storage.getOwner(ownerName))?.publicKey ?? null,
        }));
    });

    // GET /v1/ghii/:ghii — Public profile (Tier 0, no auth)
    router.get('/v1/ghii/:ghii', async (req, res) => {
        const ghii = req.params.ghii as string;
        const record = await storage.getGHII(ghii);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII "${ghii}" not found`));
            return;
        }

        // The AGENT ROSTER (each agent's GAII) is not public data — same principle as the organism
        // roster. Only the profile's OWNER (a real signed-in principal) or an operator gets it; the
        // shared anonymous identity and other users get the profile without the agent list.
        const isOwner = !!req.auth && !req.auth.anonymous && req.auth.owner === record.ownerName;
        const isOperator = !!req.auth && !req.auth.anonymous && req.auth.roles?.includes('operator');
        const includeAgents = isOwner || isOperator;
        const agents = includeAgents ? await storage.getAgentsByOwner(record.ownerName) : [];

        res.json(success(config.nodeId, {
            ghii: record.ghii,
            display_name: record.displayName,
            bio: record.bio,
            avatar: record.avatar,
            locale: record.locale,
            verification_level: record.verificationLevel,
            semantic: record.semantic,
            created_at: record.createdAt,
            ...(includeAgents ? {
                agents: agents.map(a => ({ gaii: a.gaii, display_name: a.displayName, trust_score: a.trustScore })),
            } : {}),
        }));
    });

    // PUT /v1/ghii — Update own profile (requires JWT auth as owner)
    router.put('/v1/ghii', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
            return;
        }

        const { display_name, bio, avatar, locale, notification_email, directory_listed } = req.body ?? {};
        const updates: Record<string, unknown> = {};
        if (typeof display_name === 'string') updates.displayName = display_name;
        if (typeof bio === 'string') updates.bio = bio;
        if (typeof avatar === 'string') updates.avatar = avatar;
        if (typeof locale === 'string') updates.locale = locale;
        if (typeof notification_email === 'string') updates.notificationEmail = notification_email;

        // Directory opt-in (the member "phone book"). Stored as an owner-controlled memory key
        // rather than a profile column: default OFF (unlisted), and only GET /v1/ghii/list entries
        // whose key is true appear — and that list itself requires a signed-in caller. Toggling it
        // is a valid standalone update (no other field required).
        const togglingDirectory = typeof directory_listed === 'boolean';
        if (!togglingDirectory && Object.keys(updates).length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid fields to update'));
            return;
        }

        let updated = ghiiRecord;
        if (Object.keys(updates).length > 0) {
            const u = await storage.updateGHII(ghiiRecord.ghii, updates);
            if (!u) {
                res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update profile'));
                return;
            }
            updated = u;
        }

        if (togglingDirectory) {
            const now = new Date().toISOString();
            await storage.setMemory({
                key: `profile.${ghiiRecord.username}.directory_listed`,
                ownerGaii: ghiiRecord.ghii,
                value: directory_listed,
                visibility: 'public',
                tags: ['profile', 'directory'],
                ttlHours: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
            });
        }

        res.json(success(config.nodeId, {
            ghii: updated.ghii,
            display_name: updated.displayName,
            bio: updated.bio,
            avatar: updated.avatar,
            locale: updated.locale,
            verification_level: updated.verificationLevel,
            ...(togglingDirectory ? { directory_listed } : {}),
            updated_at: updated.updatedAt,
        }));
        emitChange('ghii');

        // Notify directory of profile changes (Phase 1.4 — event-driven refresh)
        if (onDirectoryChange) onDirectoryChange();
    });

    // DELETE /v1/ghii — Delete own GHII profile (requires JWT auth as owner)
    router.delete('/v1/ghii', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        await storage.deleteGHII(ghiiRecord.ghii);

        res.json(success(config.nodeId, {
            deleted: true,
            ghii: ghiiRecord.ghii,
            note: 'GHII profile deleted. Your owner account and agents are not affected.',
        }));
        emitChange('ghii');
    });
}
