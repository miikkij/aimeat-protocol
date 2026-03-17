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
        const memory = await storage.getMemory(ownerGaii, key);
        const visibility = memory?.visibility ?? 'private';

        const result = await checkConsentForRead(storage, key, ownerGaii, accessor, visibility);

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

        const memory = await storage.getMemory(ownerGaii, key);
        const consents = await storage.listConsents(ownerGaii, { status: 'active' });

        // Filter consents whose dataPattern matches the requested key
        const matching = consents.filter(c => consentMatchPattern(c.dataPattern, key));

        res.json(success(config.nodeId, {
            key,
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
