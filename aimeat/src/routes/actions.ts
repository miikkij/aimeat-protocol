import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function actionsRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/actions — publish an action (agent auth)
  router.post('/v1/actions', requireAuth(), requireRole('agent'), async (req, res) => {
    const { id, display_name, description, category, input_schema, output_schema, pricing, estimated_time_seconds, max_input_size_bytes, tags } = req.body ?? {};

    if (!id || !display_name || !description || !input_schema || !output_schema || !pricing) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'id, display_name, description, input_schema, output_schema, and pricing are required'));
      return;
    }

    if (!pricing.base_morsels && pricing.base_morsels !== 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'pricing.base_morsels is required'));
      return;
    }

    const gaii = req.auth!.sub;
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
        createdAt: now,
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, {
        id: action.id,
        provider_gaii: action.providerGaii,
        display_name: action.displayName,
        description: action.description,
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

  return router;
}
