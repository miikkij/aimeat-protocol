/**
 * @file agent-telemetry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST endpoints for agent telemetry -- append and list telemetry events.
 *   Owners can access telemetry for any of their agents; agents can access their own.
 * @structure
 *   - POST /v1/agents/:name/telemetry  -- Append a telemetry event
 *   - GET  /v1/agents/:name/telemetry  -- List telemetry events (with filtering)
 * @version-history
 *   2026-11-13 — The access check, the agent read and the append are services/agent/telemetry-append.ts,
 *     which aimeat_agent_telemetry_report calls too; the answers are unchanged (structure programme
 *     2026-11, unit 2b).
 *   2026-10-27 — Every string field has a length limit from models/input-limits.ts (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   2026-10-14 — The agent access check is mayActOnAgent (utils/gaii.ts): the agent itself or its own owner in person. An owner in person reached another account's agent named by its whole GAII (QA audit 2026-10-14, K1).
 *   v1.3.1 -- 2026-10-05 -- The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Dashboard telemetry
 *   v1.1.0 -- 2026-05-28 -- Wire POST handler into activity-recorder so telemetry
 *                            bumps the daily telemetry_events counter and llm_call
 *                            tokens flow into the agent's activityStats.
 *   v1.2.0 -- 2026-06-21 -- Route POST/GET through the in-memory telemetry buffer: raw
 *                            events go to a bounded ring + batched activity flush instead
 *                            of a DB write per request; GET lists from the ring.
 *   v1.3.0 -- 2026-07-11 -- LEDGER (TARGET-016): an llm_call carrying a model also records a
 *                            priced, append-only usage event via services/usage-metering.js.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { INPUT_LIMITS } from '../models/input-limits.js';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNotYours } from '../middleware/refusals.js';
import { requireAuth } from '../auth/middleware.js';
import { agentGaiiFromIdentifier } from '../utils/gaii.js';
import { listTelemetryBuffered } from '../services/telemetry-buffer.js';
import { telemetryTarget, appendAgentTelemetry } from '../services/agent/telemetry-append.js';

/* ── Zod validation schema ── */
const TelemetryAppendSchema = z.object({
  type: z.enum(['llm_call', 'tool_call', 'agent_report']),
  data: z.record(z.string(), z.unknown()).default({}),
  session_id: z.string().max(INPUT_LIMITS.id).optional(),
  task_id: z.string().max(INPUT_LIMITS.id).optional(),
});

export function agentTelemetryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return agentGaiiFromIdentifier(agentName, owner, config.nodeId);
  }

  /** The agent named in the path, or the refusal sent: the agent itself or its own owner in person
   *  (QA audit 2026-10-14, K1), then the agent exists. services/agent/telemetry-append.ts holds the
   *  rule, which aimeat_agent_telemetry_report asks too. */
  async function targetOrRefuse(req: Request, res: Response, agentName: string): Promise<AgentRecord | null> {
    const target = await telemetryTarget({ storage, config }, req.auth, resolveAgentGaii(req, agentName));
    if (target.ok) return target.agent;
    if (target.code === 'NOT_YOURS') res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
    else res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
    return null;
  }

  /* ── POST /v1/agents/:name/telemetry -- Append telemetry event ── */
  router.post('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agent = await targetOrRefuse(req, res, agentName);
    if (!agent) return;

    // Validate body
    const parsed = TelemetryAppendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    // The event, the buffered write, the activity counters and the usage ledger:
    // services/agent/telemetry-append.ts, which aimeat_agent_telemetry_report calls.
    const id = await appendAgentTelemetry({ storage, config }, agent, parsed.data);
    res.status(201).json(success(config.nodeId, { id }));
  });

  /* ── GET /v1/agents/:name/telemetry -- List telemetry events ── */
  router.get('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agent = await targetOrRefuse(req, res, agentName);
    if (!agent) return;
    const agentGaii = agent.gaii;

    const since = req.query.since as string | undefined;
    const type = req.query.type as string | undefined;
    const perPage = Math.min(Math.max(parseInt(req.query.per_page as string) || 50, 1), 200);

    const events = listTelemetryBuffered(agentGaii, { since, type, limit: perPage });

    res.json(success(config.nodeId, { events, count: events.length, per_page: perPage }));
  });

  return router;
}
