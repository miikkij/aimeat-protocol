import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { calculateTrustScore } from '../services/trust.js';
import { ActionPublishSchema, ActionUpdateSchema, validateBody } from '../models/schemas.js';

const ALLOWED_CATEGORIES = [
  'language', 'translation', 'analysis', 'generation', 'coding',
  'data', 'image', 'audio', 'video', 'search', 'utility', 'other',
] as const;

const MAX_ACTIONS_PER_AGENT = 20;
const MIN_TRUST_FOR_PAID_ACTIONS = 10;

export function actionsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/actions — publish an action (agent auth)
  router.post('/v1/actions', requireAuth(), requireRole('agent'), validateBody(ActionPublishSchema, config.nodeId), async (req, res) => {
    const { id, display_name, description, category, input_schema, output_schema, pricing, estimated_time_seconds, max_input_size_bytes, tags, webhook_url, semantic } = req.body ?? {};

    // Category validation
    if (category && !ALLOWED_CATEGORIES.includes(category)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`));
      return;
    }

    const gaii = req.auth!.sub;

    // Min trust enforcement for paid actions
    if (pricing.base_morsels > 0) {
      const trust = await calculateTrustScore(gaii, storage);
      if (trust.score < MIN_TRUST_FOR_PAID_ACTIONS) {
        res.status(403).json(error(config.nodeId, 'TRUST_TOO_LOW',
          `Trust score ${trust.score} is below minimum ${MIN_TRUST_FOR_PAID_ACTIONS} for paid actions`));
        return;
      }
    }

    // Action limit per agent
    const existingActions = await storage.listActionsByProvider(gaii);
    if (existingActions.length >= MAX_ACTIONS_PER_AGENT) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${MAX_ACTIONS_PER_AGENT} actions per agent. Delete unused actions first.`));
      return;
    }

    const now = new Date().toISOString();

    try {
      const action = await storage.createAction({
        id,
        providerGaii: gaii,
        displayName: display_name,
        description,
        category,
        inputSchema: input_schema,
        outputSchema: output_schema,
        pricing: {
          baseMorsels: pricing.base_morsels,
          perUnit: pricing.per_unit ? {
            unit: pricing.per_unit.unit,
            morselsPer1000: pricing.per_unit.morsels_per_1000,
          } : undefined,
        },
        estimatedTimeSeconds: estimated_time_seconds,
        maxInputSizeBytes: max_input_size_bytes,
        tags: tags ?? [],
        webhookUrl: webhook_url,
        semantic: semantic && typeof semantic === 'object' ? semantic : undefined,
        createdAt: now,
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, {
        id: action.id,
        provider_gaii: action.providerGaii,
        display_name: action.displayName,
        description: action.description,
        semantic: action.semantic ?? undefined,
        created_at: action.createdAt,
      }, [
        { description: 'View in catalogue', method: 'GET', url: `/v1/catalogue/${action.id}` },
        { description: 'Update this action', method: 'PUT', url: `/v1/actions/${action.id}` },
      ]));
    } catch (e: any) {
      if (e.message === 'ACTION_EXISTS') {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Action "${id}" already exists for this agent`));
        return;
      }
      throw e;
    }
  });

  // DELETE /v1/actions/:id — remove an action (agent auth)
  router.delete('/v1/actions/:id', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const deleted = await storage.deleteAction(req.params.id as string, gaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${req.params.id}`));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, id: req.params.id }, [
      { description: 'View catalogue', method: 'GET', url: '/v1/catalogue' },
    ]));
  });

  // GET /v1/actions — discover actions (Tier 0, no auth)
  router.get('/v1/actions', async (req, res) => {
    const q = req.query.q as string | undefined;
    const category = req.query.category as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string ?? '50', 10)));

    const actions = await storage.listActions({ search: q, category });
    const start = (page - 1) * perPage;
    const paged = actions.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      actions: paged.map(a => ({
        id: a.id,
        display_name: a.displayName,
        description: a.description,
        provider_gaii: a.providerGaii,
        category: a.category,
        pricing: {
          base_morsels: a.pricing.baseMorsels,
          per_unit: a.pricing.perUnit ? {
            unit: a.pricing.perUnit.unit,
            morsels_per_1000: a.pricing.perUnit.morselsPer1000,
          } : undefined,
        },
        tags: a.tags,
        semantic: a.semantic,
      })),
      total: actions.length,
    }, [
      { description: 'View full catalogue', method: 'GET', url: '/v1/catalogue' },
    ], { page, per_page: perPage, total: actions.length }));
  });

  // PUT /v1/actions/:id — update an action (agent auth)
  router.put('/v1/actions/:id', requireAuth(), requireRole('agent'), validateBody(ActionUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = req.auth!.sub;
    const id = req.params.id as string;
    const { display_name, description, category, input_schema, output_schema, pricing, estimated_time_seconds, max_input_size_bytes, tags, semantic } = req.body ?? {};

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (display_name !== undefined) updates.displayName = display_name;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (input_schema !== undefined) updates.inputSchema = input_schema;
    if (output_schema !== undefined) updates.outputSchema = output_schema;
    if (pricing !== undefined) {
      updates.pricing = {
        baseMorsels: pricing.base_morsels,
        perUnit: pricing.per_unit ? { unit: pricing.per_unit.unit, morselsPer1000: pricing.per_unit.morsels_per_1000 } : undefined,
      };
    }
    if (estimated_time_seconds !== undefined) updates.estimatedTimeSeconds = estimated_time_seconds;
    if (max_input_size_bytes !== undefined) updates.maxInputSizeBytes = max_input_size_bytes;
    if (tags !== undefined) updates.tags = tags;
    if (semantic !== undefined) updates.semantic = semantic;

    const updated = await storage.updateAction(id, gaii, updates as any);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${id}`));
      return;
    }

    res.json(success(config.nodeId, {
      id: updated.id,
      display_name: updated.displayName,
      description: updated.description,
      updated_at: updated.updatedAt,
    }));
  });

  // GET /v1/actions/:gaii/:id — action detail by provider GAII (Tier 0, no auth)
  router.get('/v1/actions/:gaii/:id', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const id = req.params.id as string;

    const action = await storage.getAction(id, gaii);
    if (!action) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${id}`));
      return;
    }

    res.json(success(config.nodeId, {
      id: action.id,
      display_name: action.displayName,
      description: action.description,
      provider_gaii: action.providerGaii,
      category: action.category,
      input_schema: action.inputSchema,
      output_schema: action.outputSchema,
      pricing: {
        base_morsels: action.pricing.baseMorsels,
        per_unit: action.pricing.perUnit,
      },
      estimated_time_seconds: action.estimatedTimeSeconds,
      tags: action.tags,
      semantic: action.semantic,
      created_at: action.createdAt,
      updated_at: action.updatedAt,
    }));
  });

  return router;
}
