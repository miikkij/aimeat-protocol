/**
 * @file permissions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Consent/permission inspection routes: rules summary, access-check
 *   simulation, and per-key effective rules (the UI's sharing-rules popover).
 * @structure permissionsRouter() — GET /v1/permissions/summary, /check, /memory/:key
 * @version-history
 *   2026-10-15 — GET /v1/permissions/check takes `key` and `accessor` only as single strings; a
 *     repeated parameter (an array) is refused as missing (CodeQL js/type-confusion-through-parameter-tampering).
 *   2026-10-15 — GET /v1/permissions/check asks authorizeRead, the reads' own guard, as a simulation
 *     (noAudit), instead of checkConsentForRead (feature-list audit 43).
 *   v1.1.1 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 *   v1.1.0 — 2026-06-10 — Owner-session cross-agent fallback (getOwnedMemory): per-key
 *     visibility is read from the record's REAL owner (GHII or one of the owner's agents),
 *     fixing the popover reporting 'private'/'owner' for an agent-owned public key.
 *     Response now includes found + owner_gaii.
 *   v1.0.0 — (pre-2026-06) — Initial permissions routes.
 */
import { countConsentRecipients } from '../storage/consent-recipient.js';
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { authorizeRead } from '../services/access-guard.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';
import { resolveIdentity, isOwnerInPerson, localAccountName } from '../utils/gaii.js';

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
        if (!record && isOwnerInPerson(req.auth)) {
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

        const byType = countConsentRecipients(consents);

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
        // `?accessor=a&accessor=b` arrives as an array; only a single string is a question.
        const key = typeof req.query.key === 'string' ? req.query.key : '';
        const accessor = typeof req.query.accessor === 'string' ? req.query.accessor : '';

        if (!key || !accessor) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'key and accessor query parameters are required'));
            return;
        }

        const ownerGaii = resolve(req);
        const memory = await getOwnedMemory(req, ownerGaii, key);
        const visibility = memory?.visibility ?? 'private';

        // The reads' own guard, as a simulation: a key-space share, a members record, a workspace
        // member and the owner's own agents answer here as they do on the read. This asked
        // checkConsentForRead, which knows none of them, and said "not allowed" where the read
        // succeeded (feature-list audit 43).
        const result = await authorizeRead(storage, config, {
            ownerGaii: memory?.ownerGaii ?? ownerGaii, accessorGaii: accessor, resourceKey: key,
            visibility, groupId: memory?.groupId, workspaceRef: memory?.workspaceRef,
            accessorSub: accessor, accessorOwner: localAccountName(accessor), action: 'read', noAudit: true,
        });

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
