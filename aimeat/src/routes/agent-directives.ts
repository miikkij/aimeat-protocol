/**
 * @file agent-directives.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST endpoints for agent directives (three-layer: system + owner + agent)
 * @structure
 *   - GET    /v1/agents/:name/directives      -- Get merged directives
 *   - PUT    /v1/agents/:name/directives      -- Upsert agent-level directives
 *   - DELETE /v1/agents/:name/directives      -- Reset agent directives to defaults
 *   - GET    /v1/owner/agent-defaults         -- Get owner-level defaults
 *   - PUT    /v1/owner/agent-defaults         -- Upsert owner defaults
 * @version-history
 *   v1.7.0 -- 2026-08-01 -- TARGET-058 Phase 4: the AI-transparency convention ships as a SYSTEM-layer
 *     directive, so declaring provenance is part of what an agent agrees to rather than something
 *     buried in a tool schema. Appended after the operator's configurable principles rather than
 *     added to their default: an operator who sets AIMEAT_AGENT_SYSTEM_PRINCIPLES would otherwise
 *     silently drop it, and a convention agents stop being told about is not a convention.
 *   v1.6.0 -- 2026-07-28 -- Drop the dead `enterprise` directive layer with the edition seam: the
 *     merge has been system + owner + agent for a while and `enterprise_locked` was always false,
 *     so the field is gone rather than lingering as a promise the response cannot keep.
 *   v1.1.0 -- 2026-05-23 -- Add webhook dispatch for directive.updated events
 *   v1.2.0 -- 2026-05-28 -- Include owner-managed shared memory tags in directive reads
 *   v1.3.0 -- 2026-05-31 -- PUT now MERGES instead of full-replace: fields omitted
 *     from the request body are preserved from the existing record (detected via
 *     raw body keys, since the Zod schema defaults would otherwise blank them).
 *     Fixes tabs clobbering each other's directives sections (e.g. saving
 *     behavioral rules wiping memory_areas and vice-versa).
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNotYours } from '../middleware/refusals.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { AgentDirectivesSchema, OwnerAgentDefaultsSchema } from '../models/agent-directives-schemas.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { createAgentDataAccessOverviewService } from '../services/db/agent-data-access-overview-db-service.js';
import { logger } from '../utils/logger.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/**
 * TARGET-058: the node's AI-transparency convention, as a SYSTEM-layer directive.
 *
 * It is here rather than in `AIMEAT_AGENT_SYSTEM_PRINCIPLES` for one reason: that variable is an
 * operator's list, and an operator who sets their own would silently drop this rule. A transparency
 * convention that an agent stops being told about the moment somebody customises their principles is
 * not a convention. So it is appended after the configurable rules, always, on every node.
 *
 * It says what an agent must DO and what silence costs — the second half is the part that changes
 * behaviour, because an agent that does not know silence is recorded as model-written has no reason
 * to speak up when it is relaying a person's words.
 */
const AI_TRANSPARENCY_DIRECTIVE = {
  id: 'system-ai-transparency',
  description:
    'Say how content was made. When you write content through this node — memory, a workspace '
    + 'record, an app, knowledge, a message, a board post, a completed task — declare `ai_provenance` '
    + 'if a model generated or substantially rewrote it, and declare level:"original" when you are '
    + 'relaying text a person wrote. Silence from a non-human principal is recorded as model-written '
    + 'with no human review, so relaying somebody\'s words is something you have to state. Only a '
    + 'step where a person read the SUBSTANCE and could reject it counts as human involvement; '
    + 'clicking publish does not. When you read content back, an absent record means the origin is '
    + 'UNSTATED, never that a person wrote it. The node fills in who you are, which node, when, and '
    + 'a hash of the exact bytes; you are never asked to assert those.',
  source: 'system' as const,
};

export function agentDirectivesRouter(config: AimeatConfig, storage: Storage, webhookDispatcher?: WebhookDispatcher): Router {
  const router = Router();
  const dataAccessDb = createAgentDataAccessOverviewService(storage, config);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Owner-session or the agent itself may read this agent's data-access view (owner-or-self). */
  function canAccessAgent(req: Express.Request, agentGaii: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    return isOwnerSession || req.auth!.sub === agentGaii;
  }

  /* ── GET /v1/agents/:name/data-access/overview -- Data Access subtab composite (mount fold) ──
   *
   * The whole Data Access subtab mount in ONE call: directives-derived memory areas + resources, the
   * agent's memory keys (metadata only), and the agent's skill links. Folds the three reads the subtab
   * fired in parallel (getDirectives + GET /v1/memory?agent= + GET /skills/links) and drops memory VALUES
   * (the tab renders only key/visibility/version/dates). Owner-or-self, matching the folded endpoints'
   * intent. Registered before /directives (a 2-segment path — no shadow with the literal /directives).
   */
  router.get('/v1/agents/:name/data-access/overview', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);
    if (!canAccessAgent(req, agentGaii)) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
      return;
    }
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }
    const data = await dataAccessDb.overview(agentGaii, req.auth!.owner as string, agentName);
    res.json(success(config.nodeId, data));
  });

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
    const systemRules = [
      ...(config.agentSystemPrinciples ?? []).map((text, idx) => ({
        id: `system-${idx + 1}`,
        description: text,
        source: 'system' as const,
      })),
      // Appended after the operator's own principles, never merged into them — see the constant.
      AI_TRANSPARENCY_DIRECTIVE,
    ];

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

    const responseData: Record<string, unknown> = {
      purpose: agentDirectives?.purpose ?? '',
      rules: mergedRules,
      memory_areas: (agentDirectives?.memoryAreas ?? []).map(ma => ({
        key_prefix: ma.keyPrefix,
        description: ma.description,
        schema: ma.schema,
        csm_id: ma.csmId,
      })),
      shared_tags: agent.tags ?? [],
      shared_memory_prefixes: (agent.tags ?? []).map(tag => `agents.tag.${tag}.`),
      resources: agentDirectives?.resources ?? [],
    };
    if (agentDirectives?.budgetLimits) {
      responseData.budget_limits = {
        max_tokens_per_task: agentDirectives.budgetLimits.maxTokensPerTask,
        max_tokens_per_day: agentDirectives.budgetLimits.maxTokensPerDay,
        max_tasks_per_day: agentDirectives.budgetLimits.maxTasksPerDay,
        alert_threshold: agentDirectives.budgetLimits.alertThreshold,
      };
    }
    res.json(success(config.nodeId, responseData));
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

    // PARTIAL UPDATE / MERGE: the directives record is edited from several tabs
    // (Directives sends purpose+rules, Data Access sends memory_areas, etc.).
    // The Zod schema fills omitted fields with defaults ([]/''), so a naive
    // full replace would wipe whatever the other tab set. Detect which fields
    // the caller actually sent via the RAW body keys and preserve the rest.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const existing = await storage.getAgentDirectives(agentGaii);

    // Convert snake_case to camelCase for storage
    const directivesData: Parameters<typeof storage.upsertAgentDirectives>[0] = {
      agentGaii,
      purpose: ('purpose' in raw) ? body.purpose : (existing?.purpose ?? ''),
      rules: ('rules' in raw) ? body.rules : (existing?.rules ?? []),
      memoryAreas: ('memory_areas' in raw)
        ? body.memory_areas.map(ma => ({
            keyPrefix: ma.key_prefix,
            description: ma.description,
            schema: ma.schema,
            csmId: ma.csm_id,
          }))
        : (existing?.memoryAreas ?? []),
      resources: ('resources' in raw) ? body.resources : (existing?.resources ?? []),
      updatedAt: now,
    };
    if ('budget_limits' in raw) {
      if (body.budget_limits) {
        directivesData.budgetLimits = {
          maxTokensPerTask: body.budget_limits.max_tokens_per_task,
          maxTokensPerDay: body.budget_limits.max_tokens_per_day,
          maxTasksPerDay: body.budget_limits.max_tasks_per_day,
          alertThreshold: body.budget_limits.alert_threshold,
        };
      }
    } else if (existing?.budgetLimits) {
      directivesData.budgetLimits = existing.budgetLimits;
    }
    const record = await storage.upsertAgentDirectives(directivesData);

    // Push: webhook + MCP notification (parallel, fire-and-forget)
    if (webhookDispatcher) {
      const changedSections: string[] = [];
      if (body.purpose !== undefined) changedSections.push('purpose');
      if (body.rules) changedSections.push('rules');
      if (body.memory_areas) changedSections.push('memory_areas');
      if (body.resources) changedSections.push('resources');
      if (body.budget_limits) changedSections.push('budget_limits');
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
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/directives`); } catch (err) { logger.warn('resources: MCP not connected', { error: String(err) }); }

    emitChange('agent-directives');

    const putResponse: Record<string, unknown> = {
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
    };
    if (record.budgetLimits) {
      putResponse.budget_limits = {
        max_tokens_per_task: record.budgetLimits.maxTokensPerTask,
        max_tokens_per_day: record.budgetLimits.maxTokensPerDay,
        max_tasks_per_day: record.budgetLimits.maxTasksPerDay,
        alert_threshold: record.budgetLimits.alertThreshold,
      };
    }
    res.json(success(config.nodeId, { directives: putResponse }));
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
