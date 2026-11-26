/**
 * @file src/routes/apps/design-spec.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's design spec: the one document that says what the app is for, how it is
 *   put together and what was decided, kept beside the app for everybody who builds it.
 *
 *   Registered on the app router like the roadmap, so nothing had to be added to the boot path.
 *
 *   WHO MAY DO WHAT. Everybody inside the build reads and writes it: the owner, the owner's own
 *   agents, and anybody holding a development right at any rung, which is the same test the draft
 *   endpoints make (resolveAppTarget with the `draft` act). Removing it is the owner's alone, because
 *   a builder's answer to a wrong document is a corrected document, and a delete by a drafter would
 *   take away what the other builders read. Nobody outside the build sees it: it names data keys,
 *   decisions and open questions, which are the builders' conversation rather than a shop window.
 *
 *   A WRITE MAY NAME THE REVISION IT EXPECTS. Two builders' AIs can be working on one app, and a
 *   write that does not say what it read would overwrite the other one's edit unseen. With
 *   `expected_revision` the node answers 409 and the document that is there, so the caller reads
 *   again and writes from that. Without it the write replaces whatever is there, for the person
 *   editing in the page who just looked at it.
 *
 *   The handlers are the route's gate and one call of services/app/design-spec-ops.ts, which the
 *   aimeat_app_manage MCP tool (spec, spec_set, spec_clear) calls too.
 * @structure registerDesignSpecRoutes(router, config, storage) —
 *   GET /design-spec · PUT /design-spec · DELETE /design-spec
 * @usage registerDesignSpecRoutes(router, config, storage);
 * @version-history
 *   v1.3.0 — 2026-11-26 — PUT .../design-spec/scenarios: the playtest scenarios (services/app/scenarios.ts).
 *   v1.2.0 — 2026-11-26 — PUT .../design-spec/criteria: the acceptance criteria inside the spec
 *     (services/app/acceptance-criteria.ts), checked by schema here and per status in the service.
 *   v1.1.0 — 2026-10-05 — The handlers' logic (the build test, the refusals, the manifest stamp, the
 *     audit row) moved to services/app-design-spec-ops.ts, and the appTarget parameter went with it;
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { z } from 'zod';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { readDesignSpecFor, writeDesignSpecFor, writeCriteriaFor, writeScenariosFor, clearDesignSpecFor } from '../../services/app/design-spec-ops.js';
import { CRITERIA_MAX, CRITERION_CHECKS, CRITERION_STATUSES } from '../../services/app/acceptance-criteria.js';
import { SCENARIOS_MAX, SCENARIO_STEPS_MAX, SCENARIO_STEP_KINDS } from '../../services/app/scenarios.js';
import { validateBody } from '../../models/schemas.js';
import { safeText } from '../../models/input-limits.js';
import { sendAppOp } from '../app-op-answer.js';

/** The shape and bounds of a criteria write; evidence and reasons per status are the service's. */
const CriteriaWriteSchema = z.object({
    criteria: z.array(z.object({
        id: safeText(40),
        text: safeText(400),
        check: z.enum(CRITERION_CHECKS),
        status: z.enum(CRITERION_STATUSES).optional(),
        evidence: safeText(400).optional(),
        waived_reason: safeText(400).optional(),
    })).max(CRITERIA_MAX),
    expected_revision: z.number().int().min(0).nullable().optional(),
});

/** The shape and bounds of a scenario write; which criteria exist and each step's own fields are the service's. */
const ScenariosWriteSchema = z.object({
    scenarios: z.array(z.object({
        id: safeText(40),
        name: safeText(400),
        criteria: z.array(safeText(40)).max(50).optional(),
        signed_in: z.boolean().optional(),
        steps: z.array(z.object({
            do: z.enum(SCENARIO_STEP_KINDS),
            target: safeText(400).optional(),
            value: z.string().max(400).optional(),
            ms: z.number().int().min(0).max(60_000).optional(),
        })).max(SCENARIO_STEPS_MAX),
    })).max(SCENARIOS_MAX),
    expected_revision: z.number().int().min(0).nullable().optional(),
});

/** The app this request names: `:owner` (`me` for the caller's own) and `:filename`. */
const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

export function registerDesignSpecRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // ── GET .../design-spec — the document, and whether the app has moved past it ──
    // app:write, as the dev-grants list asks: the app domain has no read word, and an agent that
    // may build an app may read the document its builders keep. Without a word, any app-grant
    // token could read a builder's document whatever single scope its owner ticked.
    router.get('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await readDesignSpecFor(storage, config, req.auth!, refOf(req))));

    // ── PUT .../design-spec — write the whole document ──
    router.put('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await writeDesignSpecFor(storage, config, req.auth!, refOf(req), req.body)));

    // ── PUT .../design-spec/criteria — the whole list of acceptance criteria inside the spec ──
    router.put('/v1/apps/:owner/:filename/design-spec/criteria', requireAuth(), requireScope('app:write'), validateBody(CriteriaWriteSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await writeCriteriaFor(storage, config, req.auth!, refOf(req), req.body)));

    // ── PUT .../design-spec/scenarios — the whole list of playtest scenarios inside the spec ──
    router.put('/v1/apps/:owner/:filename/design-spec/scenarios', requireAuth(), requireScope('app:write'), validateBody(ScenariosWriteSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await writeScenariosFor(storage, config, req.auth!, refOf(req), req.body)));

    // ── DELETE .../design-spec — the owner takes the document away ──
    router.delete('/v1/apps/:owner/:filename/design-spec', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await clearDesignSpecFor(storage, config, req.auth!, refOf(req))));
}
