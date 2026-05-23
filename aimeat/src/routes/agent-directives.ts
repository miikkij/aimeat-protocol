/**
 * @file agent-directives.ts
 * @description REST endpoints for agent directives (three-layer: system + owner + agent)
 * @structure
 *   - GET    /v1/agents/:name/directives      -- Get merged directives
 *   - PUT    /v1/agents/:name/directives      -- Upsert agent-level directives
 *   - DELETE /v1/agents/:name/directives      -- Reset agent directives to defaults
 *   - GET    /v1/owner/agent-defaults         -- Get owner-level defaults
 *   - PUT    /v1/owner/agent-defaults         -- Upsert owner defaults
 * @version-history
 *   v1.1.0 -- 2026-05-23 -- Add webhook dispatch for directive.updated events
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { AgentDirectivesSchema, OwnerAgentDefaultsSchema } from '../models/agent-directives-schemas.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

export function agentDirectivesRouter(config: AimeatConfig, storage: Storage, webhookDispatcher?: WebhookDispatcher): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /* ── GET /v1/agents/:name/directives -- Get merged directives ── */
  router.get('/v1/agents/:name/directives', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Layer 1: System rules from config
    const systemRules = (config.agentSystemPrinciples ?? []).map((text, idx) => ({
      id: `system-${idx + 1}`,
      description: text,
      source: 'system' as const,
    }));

    // Layer 2: Owner rules
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const ownerDefaults = await storage.getOwnerAgentDefaults(ownerGhii);
    const ownerRules = (ownerDefaults?.rules ?? []).map(r => ({
      ...r,
      source: 'owner' as const,
    }));

    // Layer 3: Agent rules
    const agentDirectives = await storage.getAgentDirectives(agentGaii);
    const agentRules = (agentDirectives?.rules ?? []).map(r => ({
      ...r,
      source: 'agent' as const,
    }));

    // Merge: system + owner + agent
    const mergedRules = [...systemRules, ...ownerRules, ...agentRules];

    res.json(success(config.nodeId, {
      purpose: agentDirectives?.purpose ?? '',
      rules: mergedRules,
      memory_areas: (agentDirectives?.memoryAreas ?? []).map(ma => ({
        key_prefix: ma.keyPrefix,
        description: ma.description,
        schema: ma.schema,
        csm_id: ma.csmId,
      })),
      resources: agentDirectives?.resources ?? [],
    }));
  });

  /* ── PUT /v1/agents/:name/directives -- Upsert agent-level directives ── */
  router.put('/v1/agents/:name/directives', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Validate body
    const parsed = AgentDirectivesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();

    // Convert snake_case to camelCase for storage
    const record = await storage.upsertAgentDirectives({
      agentGaii,
      purpose: body.purpose,
      rules: body.rules,
      memoryAreas: body.memory_areas.map(ma => ({
        keyPrefix: ma.key_prefix,
        description: ma.description,
        schema: ma.schema,
        csmId: ma.csm_id,
      })),
      resources: body.resources,
      updatedAt: now,
    });

    // Dispatch webhook for directive updates (fire-and-forget)
    if (webhookDispatcher) {
      const changedSections: string[] = [];
      if (body.purpose !== undefined) changedSections.push('purpose');
      if (body.rules) changedSections.push('rules');
      if (body.memory_areas) changedSections.push('memory_areas');
      if (body.resources) changedSections.push('resources');
      if (changedSections.length > 0) {
        webhookDispatcher.dispatchWebhookEvent(agentGaii, 'directive.updated', {
          changed_sections: changedSections,
          rule_count: record.rules?.length ?? 0,
          memory_area_count: record.memoryAreas?.length ?? 0,
          resource_count: record.resources?.length ?? 0,
          updated_at: now,
        });
      }
    }

    emitChange('agent-directives');

    res.json(success(config.nodeId, {
      directives: {
        agent_gaii: record.agentGaii,
        purpose: record.purpose,
        rules: record.rules,
        memory_areas: record.memoryAreas.map(ma => ({
          key_prefix: ma.keyPrefix,
          description: ma.description,
          schema: ma.schema,
          csm_id: ma.csmId,
        })),
        resources: record.resources,
        updated_at: record.updatedAt,
      },
    }));
  });

  /* ── DELETE /v1/agents/:name/directives -- Reset to defaults ── */
  router.delete('/v1/agents/:name/directives', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const deleted = await storage.deleteAgentDirectives(agentGaii);
    emitChange('agent-directives');

    res.json(success(config.nodeId, { deleted }));
  });

  /* ── GET /v1/owner/agent-defaults -- Get owner-level defaults ── */
  router.get('/v1/owner/agent-defaults', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const defaults = await storage.getOwnerAgentDefaults(ownerGhii);

    if (!defaults) {
      res.json(success(config.nodeId, {
        defaults: {
          owner_gaii: ownerGhii,
          rules: [],
          default_token_budget: undefined,
          default_memory_areas: [],
        },
      }));
      return;
    }

    res.json(success(config.nodeId, {
      defaults: {
        owner_gaii: defaults.ownerGaii,
        rules: defaults.rules,
        default_token_budget: defaults.defaultTokenBudget,
        default_memory_areas: (defaults.defaultMemoryAreas ?? []).map(ma => ({
          key_prefix: ma.keyPrefix,
          description: ma.description,
          schema: ma.schema,
          csm_id: ma.csmId,
        })),
        updated_at: defaults.updatedAt,
      },
    }));
  });

  /* ── PUT /v1/owner/agent-defaults -- Upsert owner defaults ── */
  router.put('/v1/owner/agent-defaults', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;

    // Validate body
    const parsed = OwnerAgentDefaultsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();

    // Convert snake_case to camelCase for storage
    const record = await storage.upsertOwnerAgentDefaults({
      ownerGaii: ownerGhii,
      rules: body.rules,
      defaultTokenBudget: body.default_token_budget,
      defaultMemoryAreas: body.default_memory_areas.map(ma => ({
        keyPrefix: ma.key_prefix,
        description: ma.description,
        schema: ma.schema,
        csmId: ma.csm_id,
      })),
      updatedAt: now,
    });

    emitChange('agent-directives');

    res.json(success(config.nodeId, {
      defaults: {
        owner_gaii: record.ownerGaii,
        rules: record.rules,
        default_token_budget: record.defaultTokenBudget,
        default_memory_areas: (record.defaultMemoryAreas ?? []).map(ma => ({
          key_prefix: ma.keyPrefix,
          description: ma.description,
          schema: ma.schema,
          csm_id: ma.csmId,
        })),
        updated_at: record.updatedAt,
      },
    }));
  });

  return router;
}
