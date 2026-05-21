/**
 * @file agent-capabilities.ts
 * @description REST endpoints for agent capability reporting and retrieval.
 *   Agents report their technical capabilities (MCP servers, skills, tools),
 *   domain expertise, and language support. Owners can view capabilities
 *   alongside activity stats.
 * @structure
 *   - PUT  /v1/agents/:name/capabilities -- Agent reports its capabilities
 *   - GET  /v1/agents/:name/capabilities -- Get agent capabilities + activity stats
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTechnicalCapability } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { AgentCapabilitiesUpdateSchema } from '../models/agent-capabilities-schemas.js';

export function agentCapabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if current session can access this agent */
  function canAccess(req: Express.Request, agentGaii: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) {
      return true;
    }
    return req.auth!.sub === agentGaii;
  }

  /* ── PUT /v1/agents/:name/capabilities -- Agent reports its capabilities ── */
  router.put('/v1/agents/:name/capabilities', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const parsed = AgentCapabilitiesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;

    // Agent sessions imply an active MCP connection -- MCP-type capabilities are verified
    const isAgentSession = req.auth!.roles.includes('agent');
    const technicalCapabilities: AgentTechnicalCapability[] = body.technical.map(cap => ({
      name: cap.name,
      type: cap.type,
      verified: isAgentSession && cap.type === 'mcp',
    }));

    // Build domain capabilities, merging language entries if provided
    const domainCapabilities = [...body.domain];
    if (body.languages) {
      for (const lang of body.languages) {
        domainCapabilities.push(`Language: ${lang}`);
      }
    }

    const updated = await storage.updateAgent(agentGaii, {
      technicalCapabilities,
      domainCapabilities,
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update capabilities'));
      return;
    }

    emitChange('agent-capabilities');

    res.json(success(config.nodeId, {
      technical_capabilities: updated.technicalCapabilities ?? [],
      domain_capabilities: updated.domainCapabilities ?? [],
    }, [
      { description: 'View capabilities', method: 'GET', url: `/v1/agents/${agentName}/capabilities` },
    ]));
  });

  /* ── GET /v1/agents/:name/capabilities -- Get capabilities + activity stats ── */
  router.get('/v1/agents/:name/capabilities', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    if (!canAccess(req, agentGaii)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    res.json(success(config.nodeId, {
      technical_capabilities: agent.technicalCapabilities ?? [],
      domain_capabilities: agent.domainCapabilities ?? [],
      activity_stats: agent.activityStats ?? null,
    }));
  });

  return router;
}
