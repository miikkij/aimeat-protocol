/**
 * @file src/routes/memory/context-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/memory/context-check/:slug — a machine check of one of the person's contexts:
 *   references that no longer open, source quotes no longer found in their records, ontology ids that
 *   name nothing, replacement chains that loop, and the lifecycle marks. The check is
 *   services/context/check.ts, which the aimeat_context_check MCP tool calls too.
 * @structure registerContextCheckRoutes(router, ctx) -> GET /v1/memory/context-check/:slug
 * @usage mounted from src/routes/memory.ts BEFORE registerKeyRoutes, whose /v1/memory/:gaii/:key
 *   capture would otherwise take the literal `context-check` as an identity.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { Router } from 'express';
import { requireAuth, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { readerFor } from '../../services/classification/reader.js';
import { callerOf } from '../../middleware/caller.js';
import { checkContext } from '../../services/context/check.js';
import type { MemoryRouteCtx } from './shared.js';

export function registerContextCheckRoutes(router: Router, ctx: MemoryRouteCtx): void {
    const { config, storage } = ctx;

    router.get('/v1/memory/context-check/:slug', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'), async (req, res) => {
        const slug = decodeURIComponent(req.params.slug as string);
        const out = await checkContext({ storage, config }, callerOf(req, config.nodeId, storage), readerFor({ storage, config }, req.auth), slug);
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, out.data, [
            { description: 'Read the context', method: 'GET', url: `/v1/memory/${encodeURIComponent(String(out.data.context))}?owner_scope=true` },
            { description: 'Its earlier versions', method: 'GET', url: `/v1/memory/history/${encodeURIComponent(String(out.data.context))}?owner_scope=true` },
        ]));
    });
}
