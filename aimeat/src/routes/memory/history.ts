/**
 * @file src/routes/memory/history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/memory/history/:key — the earlier versions of one memory record, with what
 *   each write changed, or one version's whole value with ?version=. The rule of who reads it and
 *   the presentation live in services/memory-versions/history.ts, which the aimeat_memory_history MCP tool
 *   calls too. Only a key that keeps history has earlier versions: a context, an ontology module
 *   (services/context/history-keys.ts) and the other trackable keys.
 * @structure registerHistoryRoutes(router, ctx) -> GET /v1/memory/history/:key
 * @usage mounted from src/routes/memory.ts BEFORE registerKeyRoutes, whose /v1/memory/:gaii/:key
 *   capture would otherwise take the literal `history` as an identity.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { Router } from 'express';
import { requireAuth, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { readerFor } from '../../services/classification/reader.js';
import { callerOf } from '../../middleware/caller.js';
import { readMemoryHistory } from '../../services/memory-versions/history.js';
import type { MemoryRouteCtx } from './shared.js';

function intParam(v: unknown): number | undefined | null {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
}

export function registerHistoryRoutes(router: Router, ctx: MemoryRouteCtx): void {
    const { config, storage } = ctx;

    router.get('/v1/memory/history/:key', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
        const key = decodeURIComponent(req.params.key as string);
        const version = intParam(req.query.version);
        const limit = intParam(req.query.limit);
        if (version === null || limit === null) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'version and limit are whole numbers'));
            return;
        }
        const out = await readMemoryHistory(
            { storage, config },
            callerOf(req, config.nodeId, storage),
            readerFor({ storage, config }, req.auth),
            { key, ownerScope: req.query.owner_scope === 'true', ...(version !== undefined ? { version } : {}), ...(limit !== undefined ? { limit } : {}) },
        );
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, out.data, [
            { description: 'Restore a version: write its value back with expected_version set to the current version', method: 'POST', url: '/v1/memory' },
        ]));
    });
}
