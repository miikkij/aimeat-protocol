/**
 * @file src/routes/apps/scope-allowance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permissions an app kept when the node moved to 4.0 (services/app-scope-allowance.ts):
 *   read them, and the owner takes one away.
 *
 *   Registered on the app router like the design spec, so nothing had to be added to the boot path.
 *   The handlers are the route's gate and one call of the service, which the aimeat_app_manage MCP
 *   tool (scope_allowance, scope_allowance_remove) calls too.
 * @structure registerScopeAllowanceRoutes(router, config, storage) —
 *   GET /scope-allowance · DELETE /scope-allowance?words=
 * @usage registerScopeAllowanceRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (ruling decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { readScopeAllowanceFor, removeScopeAllowanceFor } from '../../services/app-scope-allowance.js';
import { sendAppOp } from '../app-op-answer.js';

/** The app this request names: `:owner` (`me` for the caller's own) and `:filename`. */
const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

export function registerScopeAllowanceRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // ── GET .../scope-allowance — the words the app keeps, the ones taken away, and why ──
    // app:write, as the design spec asks: the app domain has no read word.
    router.get('/v1/apps/:owner/:filename/scope-allowance', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await readScopeAllowanceFor(storage, config, req.auth!, refOf(req))));

    // ── DELETE .../scope-allowance?words=a,b — the owner takes words away ──
    // app:manage, the word the development right's removal asks.
    router.delete('/v1/apps/:owner/:filename/scope-allowance', requireAuth(), requireScope('app:manage'), async (req, res) =>
        sendAppOp(res, config.nodeId, await removeScopeAllowanceFor(storage, config, req.auth!, refOf(req), req.query.words ?? req.body?.words)));
}
