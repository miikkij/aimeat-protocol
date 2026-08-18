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
 *   v1.1.0 — 2026-08-18 — The operator can see what a principal MAY DO, not only that it exists.
 *     /v1/admin/agents carries each agent's approved scopes, and the new /v1/admin/app-grants lists
 *     every live app grant on the node beside the app's CURRENT declaration, naming the words the
 *     grant carries that the app no longer asks for. Both questions were unanswerable from any route:
 *     grants were owner-scoped and scopes were absent from every operator surface, so a decision about
 *     tightening a gate was a decision taken on one owner's data.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { parseAppScopes } from '../services/protected-resource.js';
import { logger } from '../utils/logger.js';

/**
 * What the app behind a grant target declares TODAY, or null when it declares nothing.
 *
 * Same reading as the grant path itself (routes/app-grants.ts): the meta tag is the app's own
 * statement and lives only in its bytes, so this is one row and no HTTP. Null rather than the empty
 * list, because "made no statement" and "asks for nothing" are different answers and only the second
 * makes a wide grant suspicious.
 */
async function declaredScopesOfApp(storage: Storage, target: string): Promise<string[] | null> {
    const slash = target.indexOf('/');
    if (slash <= 0 || slash === target.length - 1) return null;   // portfolio: or malformed
    const owner = target.slice(0, slash);
    const filename = target.slice(slash + 1);
    const bare = owner.includes('@') ? owner.split('@')[0] : owner;
    const app = await storage.getAppByOwnerName(bare, filename).catch(err => {
        logger.warn('admin-agents: could not read the app behind a grant', { target, error: String(err) });
        return null;
    });
    if (!app) return null;
    const data = app.data as Buffer | Uint8Array | string;
    const html = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
    const declared = parseAppScopes(html);
    return declared.length ? declared : null;
}

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
                // What the owner approved. Absent from every operator surface until now, which made
                // "how many agents would a new scope gate refuse" a question with no answer.
                default_scopes: a.defaultScopes ?? null,
            })),
            total: agents.length,
        }));
    });

    /**
     * GET /v1/admin/app-grants — every live app grant on the node, next to what the app asks for TODAY.
     *
     * An app grant is a snapshot of the app's `<meta name="aimeat-scopes">` at the moment of the
     * handshake. Narrowing now follows automatically (routes/app-grants.ts), but a grant made before
     * that, or written by the scope-vocabulary migration, still carries words its app never asks for —
     * and until this route there was no way to see it: /v1/app-grants answers for ONE owner, and the
     * admin dashboard counts nothing of the sort. A decision about tightening a gate was therefore a
     * decision taken on whichever owner happened to be logged in.
     *
     * `extra` is the answer: the scopes this grant carries that the app no longer declares.
     */
    router.get('/v1/admin/app-grants', requireAuth(), requireRole('operator'), async (_req, res) => {
        const grants = await storage.listAppGrants();

        // One read per distinct app, not per grant: an app with sixty grants is one lookup.
        const declaredByApp = new Map<string, string[] | null>();
        for (const app of new Set(grants.map(g => g.app))) {
            declaredByApp.set(app, await declaredScopesOfApp(storage, app));
        }

        const rows = grants.map(g => {
            const declared = declaredByApp.get(g.app) ?? null;
            return {
                grant_id: g.grantId,
                app: g.app,
                app_name: g.appName,
                owner: g.owner,
                scopes: g.scopes,
                // null when the app declares nothing at all — which is a different state from "asks for
                // nothing", and the one case where a difference means nothing is wrong.
                declared_scopes: declared,
                extra_scopes: declared ? g.scopes.filter(sc => !declared.includes(sc)) : [],
                missing_scopes: declared ? declared.filter(sc => !g.scopes.includes(sc)) : [],
                created_at: g.createdAt,
                last_used_at: g.lastUsedAt ?? null,
            };
        });
        const drifted = rows.filter(r => r.extra_scopes.length > 0);

        res.json(success(config.nodeId, {
            grants: rows,
            total: rows.length,
            // The two numbers an operator actually acts on.
            drifted: drifted.length,
            undeclared: rows.filter(r => r.declared_scopes === null).length,
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
