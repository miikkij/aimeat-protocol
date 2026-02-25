import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';

export function catalogueRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/catalogue — public action catalogue (Tier 0, no auth)
  router.get('/v1/catalogue', async (req, res) => {
    const search = req.query.search as string | undefined;
    const category = req.query.category as string | undefined;

    const actions = await storage.listActions({ search, category });

    res.json(success(config.nodeId, {
      actions: actions.map(a => ({
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
      })),
      total: actions.length,
    }, [
      { description: 'View node bootstrap info', method: 'GET', url: '/' },
      { description: 'Register as an owner to start using actions', method: 'POST', url: '/v1/owners' },
    ]));
  });

  // GET /v1/catalogue/:actionId — action detail (Tier 0, no auth)
  router.get('/v1/catalogue/:actionId', async (req, res) => {
    const actions = await storage.listActions();
    const action = actions.find(a => a.id === req.params.actionId);
    if (!action) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${req.params.actionId}`));
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
      created_at: action.createdAt,
    }));
  });

  return router;
}
