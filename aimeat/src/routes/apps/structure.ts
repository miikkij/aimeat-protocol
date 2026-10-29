/**
 * @file src/routes/apps/structure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's structure and status, and the plan behind it: the eight steps the
 *   structure page in appcat draws, from the first moment of building, before any code or publish.
 *
 *   Registered on the app router like the design spec. Each handler is one call of
 *   services/app-structure.ts, which aimeat_app_manage (structure, structure_set, plans) calls too.
 *
 *   WHO MAY: everybody inside the build reads and writes it, the same test the draft and the design
 *   spec make. GET /v1/app-plans lists the caller's own plans, which is how a person finds an app
 *   that is not published yet.
 * @structure registerStructureRoutes(router, config, storage) —
 *   GET /v1/apps/:owner/:filename/structure · PUT /v1/apps/:owner/:filename/structure · GET /v1/app-plans
 * @usage registerStructureRoutes(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-10-29 — A choice's note takes 600 characters: a custom layout is described in it.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import type { Router, Request } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { validateBody } from '../../models/schemas.js';
import { safeText } from '../../models/input-limits.js';
import { readStructureFor, writePlanFor, listPlansFor } from '../../services/app-structure.js';
import { sendAppOp } from '../app-op-answer.js';

/** The app this request names: `:owner` (`me` for the caller's own) and `:filename`. */
const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

/**
 * The shape and the bounds of a plan write. Which values a choice may take is the service's
 * (services/app-plan.ts readPlanPatch), because they come from the node's registries and its refusal
 * names them; this holds the lengths and the types, so a write the service would cut is refused first.
 */
const PlanWriteSchema = z.object({
    name: safeText(120).nullable().optional(),
    purpose: safeText(800).nullable().optional(),
    data: z.object({ summary: safeText(800), personalData: z.enum(['yes', 'no', 'unstated']).optional() }).nullable().optional(),
    choices: z.record(z.string().max(40), z.union([
        z.null(),
        safeText(80),
        z.object({ value: safeText(80), state: z.enum(['waiting', 'done']).optional(), note: safeText(600).optional() }),
    ])).optional(),
    now: safeText(200).nullable().optional(),
    expected_revision: z.number().int().min(0).nullable().optional(),
});

export function registerStructureRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // app:write, as the design spec asks: the plan is a builder's record, and the app domain has no
    // read word of its own.
    router.get('/v1/apps/:owner/:filename/structure', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await readStructureFor(storage, config, req.auth!, refOf(req))));

    router.put('/v1/apps/:owner/:filename/structure', requireAuth(), requireScope('app:write'), validateBody(PlanWriteSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await writePlanFor(storage, config, req.auth!, refOf(req), req.body)));

    router.get('/v1/app-plans', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await listPlansFor(storage, config, req.auth!)));
}
