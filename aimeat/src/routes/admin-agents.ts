/**
 * @file src/routes/admin-agents.ts
 * @description Operator-only admin routes for agents — list all agents with full detail and
 *   set/clear an agent's CORS allowed-origins (validated http(s) URLs or '*').
 *
 * @structure
 *   - adminAgentsRouter(config, storage): Router factory
 *   - GET /v1/admin/agents: list agents (gaii, owner, trust, balance, origins, federate, timestamps)
 *   - PUT /v1/admin/agents/:gaii/cors: validate + persist allowedOrigins, then emitChange('config')
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

export function adminAgentsRouter(
    config: AimeatConfig,
    storage: Storage,
): Router {
    const router = Router();

    // GET /v1/admin/agents — list all agents with full details (operator only)
    router.get('/v1/admin/agents', requireAuth(), requireRole('operator'), async (_req, res) => {
        const agents = await storage.listAgents();

        res.json(success(config.nodeId, {
            agents: agents.map(a => ({
                gaii: a.gaii,
                owner: a.owner,
                display_name: a.displayName,
                trust_score: a.trustScore,
                morsel_balance: a.morselBalance,
                allowed_origins: a.allowedOrigins ?? null,
                federate: a.federate ?? false,
                created_at: a.createdAt,
                last_seen: a.lastSeen,
            })),
            total: agents.length,
        }));
    });

    // PUT /v1/admin/agents/:gaii/cors — Operator sets/clears CORS for any agent
    router.put('/v1/admin/agents/:gaii/cors', requireAuth(), requireRole('operator'), async (req, res) => {
        const gaii = req.params.gaii as string;
        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${gaii}`));
            return;
        }

        const { allowed_origins } = req.body ?? {};
        if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to clear'));
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

        const updated = await storage.updateAgent(gaii, {
            allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
        });
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'This one is on us — the change could not be saved. It is already reported; try again in a moment.'));
            return;
        }
        res.json(success(config.nodeId, {
            gaii: updated.gaii,
            allowed_origins: updated.allowedOrigins ?? null,
        }));
        emitChange('config');
    });

    return router;
}
