/**
 * @file src/routes/admin-maintenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-only admin routes for extension hooks and maintenance mode:
 *   list/set/clear the action lists bound to lifecycle hooks, and read/toggle the
 *   node's maintenance state (persisted to storage and mirrored in an in-memory cache).
 *
 * @structure
 *   - adminMaintenanceRouter(config, storage, maintenanceCache?): Router
 *   - GET/PUT/DELETE /v1/admin/hooks[/:hookName]: manage extension hook actions
 *   - GET/POST /v1/admin/maintenance: read/toggle maintenance mode
 *   - POST /v1/admin/maintenance/compact-workspace-versions: one-shot version-history compaction
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — compact-workspace-versions: operator-triggered one-shot sweep applying the
 *     workspace version-retention window to existing `.version.N` bloat (P2).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { HookName } from '../config.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { listHooks } from '../services/hooks.js';
import { emitChange } from '../services/event-bus.js';

export function adminMaintenanceRouter(
    config: AimeatConfig,
    storage: Storage,
    maintenanceCache?: {
        get: () => import('../storage/interface.js').MaintenanceState;
        set: (state: import('../storage/interface.js').MaintenanceState) => void;
    },
): Router {
    const router = Router();

    // GET /v1/admin/hooks — list all extension hooks
    router.get('/v1/admin/hooks', requireAuth(), requireRole('operator'), (_req, res) => {
        res.json(success(config.nodeId, {
            extension_hooks: listHooks(config),
        }));
    });

    // PUT /v1/admin/hooks/:hookName — set actions for a hook
    router.put('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), async (req, res) => {
        const hookName = req.params.hookName as string;
        const validHooks: HookName[] = [
            'pre_owner_registration', 'post_owner_registration',
            'pre_agent_registration', 'post_agent_registration',
            'owner_recovery', 'agent_rekey',
            'pre_work_request', 'post_work_delivery', 'post_settlement',
            'pre_board_post', 'pre_federation_peer',
        ];

        if (!validHooks.includes(hookName as HookName)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid hook name. Valid hooks: ${validHooks.join(', ')}`));
            return;
        }

        const { actions } = req.body ?? {};
        if (!Array.isArray(actions) || !actions.every((a: unknown) => typeof a === 'string')) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'actions must be an array of action reference strings'));
            return;
        }

        config.extensionHooks[hookName as HookName] = actions;

        // Persist to database
        await storage.setConfigValue(`hooks.${hookName}`, JSON.stringify(actions));

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: config.extensionHooks[hookName as HookName],
            updated: true,
        }));
        emitChange('config');
    });

    // DELETE /v1/admin/hooks/:hookName — clear all actions from a hook
    router.delete('/v1/admin/hooks/:hookName', requireAuth(), requireRole('operator'), async (req, res) => {
        const hookName = req.params.hookName as string;
        if (!(hookName in config.extensionHooks)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Hook "${hookName}" not found`));
            return;
        }

        config.extensionHooks[hookName as HookName] = [];

        // Remove from database
        await storage.deleteConfigValue(`hooks.${hookName}`);

        res.json(success(config.nodeId, {
            hook: hookName,
            actions: [],
            cleared: true,
        }));
        emitChange('config');
    });

    // POST /v1/admin/maintenance/compact-workspace-versions — one-shot workspace version-history
    // compaction (operator only). Applies the retention window (AIMEAT_WS_MAX_VERSIONS / manifest
    // maxVersions; append-only spaces never pruned) to EXISTING `.version.N` bloat — the publish
    // path prunes incrementally from now on, this cleans what accumulated before. Optional body
    // { organism_id } scopes the sweep to one organism. Registered before GET/POST /maintenance
    // so Express matches the literal sub-path first.
    router.post('/v1/admin/maintenance/compact-workspace-versions', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const organismId = typeof req.body?.organism_id === 'string' && req.body.organism_id.trim() ? req.body.organism_id.trim() : undefined;
            const { compactWorkspaceVersions } = await import('../services/workspace-versions.js');
            const result = await compactWorkspaceVersions(storage, config, organismId ? { organismId } : undefined);
            res.json(success(config.nodeId, result));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'COMPACTION_FAILED', `Workspace version compaction failed: ${(err as Error).message}`));
        }
    });

    /**
     * POST /v1/admin/maintenance/backfill-home-feed — give existing accounts their history back.
     *
     * The home feed used to DERIVE its rows from the onboarding markers. It reads the recorded
     * account log now, so without this an account created before that change would open its home
     * and find nothing — every trace of having set the place up gone from the screen that shows it.
     *
     * Idempotent per owner: it skips any kind already recorded, and it stamps each row with the
     * marker's own timestamp, so a five-month-old account reads as five months old. Run it twice
     * and the second run writes nothing. `owner` does one; omitting it does every account on the
     * node, which is the deploy-day case.
     */
    router.post('/v1/admin/maintenance/backfill-home-feed', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const one = typeof req.body?.owner === 'string' && req.body.owner.trim() ? req.body.owner.trim() : null;
            const { backfillHomeFeed } = await import('../services/home-feed.js');
            const owners = one ? [one] : (await storage.listOwners()).map(o => o.name);
            let written = 0;
            const failed: string[] = [];
            for (const owner of owners) {
                try {
                    written += (await backfillHomeFeed(storage, config, owner)).written;
                } catch (err) {
                    // One account's markers being unreadable is not a reason to leave every other
                    // account without its history. Named in the response rather than logged away.
                    failed.push(owner);
                    logger.warn('backfill-home-feed: one owner failed', { owner, error: String(err) });
                }
            }
            res.json(success(config.nodeId, { owners: owners.length, written, failed }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'BACKFILL_FAILED', `Home-feed backfill failed: ${(err as Error).message}`));
        }
    });

    // GET /v1/admin/maintenance — get maintenance mode status (operator only)
    router.get('/v1/admin/maintenance', requireAuth(), requireRole('operator'), async (_req, res) => {
        const state = maintenanceCache ? maintenanceCache.get() : await storage.getMaintenanceMode();
        res.json(success(config.nodeId, state));
    });

    // POST /v1/admin/maintenance — toggle maintenance mode (operator only)
    router.post('/v1/admin/maintenance', requireAuth(), requireRole('operator'), async (req, res) => {
        const { enabled, message } = req.body ?? {};
        if (typeof enabled !== 'boolean') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', '"enabled" (boolean) is required'));
            return;
        }
        const state: import('../storage/interface.js').MaintenanceState = {
            enabled,
            message: typeof message === 'string' ? message : '',
            enabledAt: enabled ? new Date().toISOString() : null,
            enabledBy: enabled ? (req.auth?.sub ?? null) : null,
        };
        await storage.setMaintenanceMode(state);
        if (maintenanceCache) maintenanceCache.set(state);
        res.json(success(config.nodeId, state));
        emitChange('maintenance');
    });

    return router;
}
