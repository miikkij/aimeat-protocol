/**
 * @file src/routes/agents/clearance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PATCH /v1/agents/:name/clearance: the highest classification label one agent may read
 *   (plan doc-mvdipuyqraas, L2). Body `{ clearance: "<label id>" | null }`; null removes the limit.
 *   The rules are services/agent-clearance.ts, which the MCP tool aimeat_operator_agent_configure
 *   calls as well: the owner, or the owner's agent holding `agent:permissions`; never the agent
 *   itself; raising or removing it needs the owner in person (403 PERSON_REQUIRED).
 * @structure registerClearanceRoutes(router, config, storage)
 * @usage registerClearanceRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2.3).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { clearanceView, setAgentClearance } from '../../services/agent-clearance.js';
import { policyFor } from '../../services/classification/policy.js';

export function registerClearanceRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  router.patch('/v1/agents/:name/clearance', requireAuth(), requireScope('agent:permissions'), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!('clearance' in body)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send clearance: the id of a classification, or null for no limit.'));
      return;
    }
    const caller = callerOf(req, config.nodeId, storage);
    const out = await setAgentClearance({ storage, config }, caller, req.params.name as string, body.clearance);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    const policy = await policyFor(storage, config, caller.ownerGhii);
    res.json(success(config.nodeId, {
      gaii: out.agent.gaii,
      name: out.agent.name,
      ...clearanceView(policy, out.agent),
      from: out.from,
      changed: out.changed,
      // What the limit does while classification is off: nothing, and the answer says so.
      classification: config.classificationMode,
    }));
  });
}
