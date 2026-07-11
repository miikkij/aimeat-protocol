/**
 * @file agent-telemetry.ts
 * @description REST endpoints for agent telemetry -- append and list telemetry events.
 *   Owners can access telemetry for any of their agents; agents can access their own.
 * @structure
 *   - POST /v1/agents/:name/telemetry  -- Append a telemetry event
 *   - GET  /v1/agents/:name/telemetry  -- List telemetry events (with filtering)
 * @version-history
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

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { pushTelemetry, recordTelemetryActivity, listTelemetryBuffered } from '../services/telemetry-buffer.js';
import { recordUsageEvent, extractUsageFields } from '../services/usage-metering.js';
import { logger } from '../utils/logger.js';

/* ── Zod validation schema ── */
const TelemetryAppendSchema = z.object({
  type: z.enum(['llm_call', 'tool_call', 'agent_report']),
  data: z.record(z.string(), z.unknown()).default({}),
  session_id: z.string().optional(),
  task_id: z.string().optional(),
});

export function agentTelemetryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if current session can access an agent's telemetry */
  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const roles = req.auth!.roles as string[];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent');
    if (isOwnerSession) return true;
    if (roles.includes('agent')) {
      return req.auth!.sub === resolveAgentGaii(req, agentName);
    }
    return false;
  }

  /* ── POST /v1/agents/:name/telemetry -- Append telemetry event ── */
  router.post('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Validate body
    const parsed = TelemetryAppendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const { type, data, session_id, task_id } = parsed.data;

    const event: TelemetryEvent = {
      id: randomUUID(),
      agentGaii,
      type,
      data,
      sessionId: session_id,
      taskId: task_id,
      createdAt: new Date().toISOString(),
    };

    // Buffered in-memory: the raw event lands in a bounded per-agent ring and the
    // derived activity counters accumulate; both are flushed to storage on an interval
    // (see telemetry-buffer.ts). No per-request DB write — 48 agents streaming telemetry
    // no longer translate to a write per event.
    pushTelemetry(event);
    recordTelemetryActivity(agentGaii, { type, data });

    // LEDGER (TARGET-016): an llm_call carrying a model is also recorded as a priced,
    // append-only usage event. Backward compatible — a bare llm_call without model only
    // bumps the activity counters above. A ledger write failure never fails the telemetry
    // post (the client's own buffer/retry is the durability guarantee).
    if (type === 'llm_call') {
      const fields = extractUsageFields(data);
      if (fields) {
        try {
          await recordUsageEvent(storage, {
            ...fields,
            agentGaii,
            ownerGhii: `${agent.owner}@${config.nodeId}`,
            runId: fields.runId ?? task_id,
            source: 'telemetry',
          });
        } catch (err) {
          logger.warn('ledger: usage event write failed (telemetry accepted)', {
            agentGaii, error: String(err),
          });
        }
      }
    }

    res.status(201).json(success(config.nodeId, { id: event.id }));
  });

  /* ── GET /v1/agents/:name/telemetry -- List telemetry events ── */
  router.get('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const since = req.query.since as string | undefined;
    const type = req.query.type as string | undefined;
    const perPage = Math.min(Math.max(parseInt(req.query.per_page as string) || 50, 1), 200);

    const events = listTelemetryBuffered(agentGaii, { since, type, limit: perPage });

    res.json(success(config.nodeId, { events, count: events.length, per_page: perPage }));
  });

  return router;
}
