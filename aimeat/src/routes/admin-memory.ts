/**
 * @file admin-memory.ts
 * @description Admin sub-router for memory management. Provides operator-only
 *   endpoints to list all memory keys across all owners and delete individual keys.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial implementation: list + delete endpoints
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

export function adminMemoryRouter(
    config: AimeatConfig,
    storage: Storage,
): Router {
    const router = Router();

    // GET /v1/admin/memory — list all memory with pagination + filtering (operator only)
    router.get('/v1/admin/memory', requireAuth(), requireRole('operator'), async (req, res) => {
        const prefix = req.query.prefix as string | undefined;
        const owner = req.query.owner as string | undefined;
        const visibility = req.query.visibility as string | undefined;
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const result = await storage.listAllMemory({
            prefix: prefix || undefined,
            ownerPrefix: owner || undefined,
            visibility: visibility || undefined,
            limit,
            offset,
        });

        res.json(success(config.nodeId, {
            items: result.items.map(m => ({
                key: m.key,
                owner_gaii: m.ownerGaii,
                value: m.value,
                visibility: m.visibility,
                tags: m.tags,
                version: m.version,
                created_at: m.createdAt,
                updated_at: m.updatedAt,
                flag_count: m.flagCount ?? 0,
            })),
            total: result.total,
            limit,
            offset,
        }));
    });

    // DELETE /v1/admin/memory/:owner/:key — delete any memory key (operator only)
    router.delete('/v1/admin/memory/:owner/:key', requireAuth(), requireRole('operator'), async (req, res) => {
        const ownerGaii = req.params.owner as string;
        const key = req.params.key as string;

        const existing = await storage.getMemory(ownerGaii, key);
        if (!existing) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${ownerGaii}/${key}`));
            return;
        }

        const deleted = await storage.deleteMemory(ownerGaii, key);
        if (!deleted) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to delete memory key'));
            return;
        }

        res.json(success(config.nodeId, { deleted: true, owner_gaii: ownerGaii, key }));
        emitChange('memory');
    });

    return router;
}
