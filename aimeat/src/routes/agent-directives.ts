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
 *   v1.5.0 -- 2026-06-24 -- Secretary G1: dedup the merge against the enterprise layer — drop owner/agent
 *     rules that duplicate a locked enterprise rule (dropEnterpriseDuplicates) so a company Secretary
 *     provisioned before the brain became seam-sourced can never render its stale persisted brain twice.
 *     No-op when there is no enterprise layer (Community / non-company agents unaffected).
 *   v1.4.0 -- 2026-06-24 -- Add a 4th `enterprise` source to the merge (Secretary P4-B): for a company
 *     Secretary (tag system:company-secretary) the GET merge overlays the edition's locked brain from
 *     the Enterprise seam (provider.secretaryDirectives(orgId)), ranked above owner/agent and read-only
 *     (PUT only ever writes the agent layer). Sourced live (never persisted) so brains are swappable and
 *     each company resolves its own org. Community/stub omits the seam method → no change for any other
 *     agent. Response gains `enterprise_locked`.
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
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { AgentDirectivesSchema, OwnerAgentDefaultsSchema } from '../models/agent-directives-schemas.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { createAgentDataAccessOverviewService } from '../services/db/agent-data-access-overview-db-service.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

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
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
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

    const responseData: Record<string, unknown> = {
      purpose: agentDirectives?.purpose ?? '',
      enterprise_locked: false,
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
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/directives`); } catch { /* MCP not connected */ }

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
