/**
 * @file agent-telemetry.ts
 * @description REST endpoints for agent telemetry -- append and list telemetry events.
 *   Owners can access telemetry for any of their agents; agents can access their own.
 * @structure
 *   - POST /v1/agents/:name/telemetry  -- Append a telemetry event
 *   - GET  /v1/agents/:name/telemetry  -- List telemetry events (with filtering)
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Dashboard telemetry
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';

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

    await storage.appendTelemetry(event);

    emitChange('agents');

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
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

    const events = await storage.listTelemetry(agentGaii, { since, type, limit });

    res.json(success(config.nodeId, { events, count: events.length }));
  });

  return router;
}
