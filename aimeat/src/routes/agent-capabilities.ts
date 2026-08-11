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
 *   v1.3.0 -- 2026-08-11 -- The write moved to services/agent-profile-write.ts, which
 *                            aimeat_agent_capabilities_report now calls too. That tool had kept
 *                            the pre-v1.2.0 behaviour of folding languages into the domain list.
 *   v1.2.0 -- 2026-05-28 -- Stop merging languages into domain_capabilities; persist
 *                            and return them as a dedicated languages array.
 *   v1.1.0 -- 2026-05-22 -- Add modules_loaded and limitations to PUT/GET
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { setAgentCapabilities } from '../services/agent-profile-write.js';

export function agentCapabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

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

    // Validation, the record shape and the verified flag are services/agent-profile-write.ts,
    // shared with aimeat_agent_capabilities_report. An agent session implies a live MCP
    // connection, which is what makes an mcp-type capability verified.
    const outcome = await setAgentCapabilities({ storage, config }, agentGaii, req.body,
      { liveMcpSession: req.auth!.roles.includes('agent') });

    if (!outcome.ok) {
      if (outcome.code === 'AGENT_NOT_FOUND') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
        return;
      }
      if (outcome.code === 'INVALID_INPUT') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', outcome.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update capabilities'));
      return;
    }
    const updated = outcome.agent;

    res.json(success(config.nodeId, {
      technical_capabilities: updated.technicalCapabilities ?? [],
      domain_capabilities: updated.domainCapabilities ?? [],
      languages: updated.languages ?? [],
      modules_loaded: updated.modulesLoaded ?? [],
      limitations: updated.agentLimitations ?? [],
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
      languages: agent.languages ?? [],
      modules_loaded: agent.modulesLoaded ?? [],
      limitations: agent.agentLimitations ?? [],
      activity_stats: agent.activityStats ?? null,
    }));
  });

  return router;
}
