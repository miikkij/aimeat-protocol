/**
 * @file permissions.ts
 * @description Consent/permission inspection routes: rules summary, access-check
 *   simulation, and per-key effective rules (the UI's sharing-rules popover).
 * @structure permissionsRouter() — GET /v1/permissions/summary, /check, /memory/:key
 * @version-history
 *   v1.1.0 — 2026-06-10 — Owner-session cross-agent fallback (getOwnedMemory): per-key
 *     visibility is read from the record's REAL owner (GHII or one of the owner's agents),
 *     fixing the popover reporting 'private'/'owner' for an agent-owned public key.
 *     Response now includes found + owner_gaii.
 *   v1.0.0 — (pre-2026-06) — Initial permissions routes.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { checkConsentForRead } from '../services/consent.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';
import { resolveIdentity } from '../utils/gaii.js';

export function permissionsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // Owner sessions see an AGGREGATED memory list (GHII + all agents), so a key they ask
    // about may live under one of their agents' GAIIs. Without this fallback the routes
    // below reported the GHII record's visibility (or the 'private' default) for an
    // agent-owned key — the list badge said "public" while the rules popover said
    // "private"/"owner". Mirrors the cross-agent lookup in PUT/DELETE /v1/memory/:key.
    async function getOwnedMemory(req: Express.Request, ownerGaii: string, key: string) {
        let record = await storage.getMemory(ownerGaii, key);
        const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
        if (!record && isOwnerSession) {
            const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
            for (const agent of agents) {
                record = await storage.getMemory(agent.gaii, key);
                if (record) break;
            }
        }
        return record;
    }

    // GET /v1/permissions/summary — overview of all rules for authenticated agent's data
    router.get('/v1/permissions/summary', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const ownerGaii = resolve(req);
        const consents = await storage.listConsents(ownerGaii, { status: 'active' });

        const byType = { wildcard: 0, gaii: 0, ghii: 0, organism: 0, domain: 0, node: 0 };
        for (const c of consents) {
            if (c.recipient === '*') byType.wildcard++;
            else if (c.recipient.startsWith('ghii:')) byType.ghii++;
            else if (c.recipient.startsWith('organism.')) byType.organism++;
            else if (c.recipient.startsWith('domain:')) byType.domain++;
            else if (c.recipient.startsWith('node:')) byType.node++;
            else byType.gaii++;
        }

        const memoryKeys = await storage.listMemory(ownerGaii);
        const storageFiles = await storage.listStorageFiles(ownerGaii);

        res.json(success(config.nodeId, {
            total_memory_keys: memoryKeys.length,
            total_storage_files: storageFiles.length,
            active_consents: consents.length,
            rules_by_recipient_type: byType,
            data_patterns: [...new Set(consents.map(c => c.dataPattern))],
        }));
    });

    // GET /v1/permissions/check — simulate an access check
    router.get('/v1/permissions/check', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const key = req.query.key as string;
        const accessor = req.query.accessor as string;

        if (!key || !accessor) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'key and accessor query parameters are required'));
            return;
        }

        const ownerGaii = resolve(req);
        const memory = await getOwnedMemory(req, ownerGaii, key);
        const visibility = memory?.visibility ?? 'private';

        const result = await checkConsentForRead(storage, key, memory?.ownerGaii ?? ownerGaii, accessor, visibility, memory?.groupId);

        res.json(success(config.nodeId, {
            key,
            accessor,
            visibility,
            allowed: result.allowed,
            reason: result.reason,
            consent_id: result.consentId ?? null,
        }));
    });

    // GET /v1/permissions/memory/:key — list all rules affecting a specific key
    router.get('/v1/permissions/memory/:key', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const key = req.params.key as string;
        const ownerGaii = resolve(req);

        const memory = await getOwnedMemory(req, ownerGaii, key);
        const consents = await storage.listConsents(ownerGaii, { status: 'active' });

        // Filter consents whose dataPattern matches the requested key
        const matching = consents.filter(c => consentMatchPattern(c.dataPattern, key));

        res.json(success(config.nodeId, {
            key,
            found: !!memory,
            owner_gaii: memory?.ownerGaii ?? null,
            visibility: memory?.visibility ?? 'private',
            effective_rules: matching.map(c => ({
                consent_id: c.id,
                recipient: c.recipient,
                data_pattern: c.dataPattern,
                purpose: c.purpose,
                scope: c.scope,
                expires: c.expires,
                status: c.status,
                granted_at: c.grantedAt,
            })),
        }));
    });

    return router;
}
