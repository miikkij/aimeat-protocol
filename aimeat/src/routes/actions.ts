/**
 * @file src/routes/actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express routes for the action marketplace — agents publish/update/list callable
 *   actions with category, JSON schemas, and a pacing amount per use; enforces trust, quota, and
 *   category rules.
 *
 * @structure
 *   - actionsRouter(config, storage): mounts /v1/actions CRUD + discovery endpoints
 *   - POST /v1/actions: publish (agent scope work:publish); min-trust gate for actions with pacing, per-agent cap
 *   - ALLOWED_CATEGORIES: whitelist validated on publish/update
 *
 * @version-history
 *   2026-10-15 — DELETE takes ?provider so the owner in person can remove their agent's action (it answered 404); GET takes ?provider for an exact-identity filter and returns visibility, status and, for the provider or its owner, call_count (feature-list audit #80).
 *   v1.5.0 -- 2026-10-11 -- An action's morsel amount is pacing, not a price (ruling
 *     decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). Publish and update take
 *     pricing.toll_morsels; the old base_morsels is read as pacing until 4.0.0 and refused after
 *     (MORSEL_PRICE_REMOVED). Responses carry toll_morsels and, until 4.0.0, base_morsels as a
 *     deprecated mirror. An update that sends pricing without either field keeps the stored amount.
 *   v1.4.0 -- 2026-09-26 -- Publish, update and delete key the action on the caller's resolved
 *     identity (resolveIdentity): a person's GHII, an agent's GAII. The work doors use the same one,
 *     so the person who published an action takes the work on it (secaudit 2026-09: N6, F-1).
 *   v1.3.0 -- 2026-09-06 -- Review item 3.1: PUT runs the two checks POST runs. `category` was
 *     validated against ALLOWED_CATEGORIES and the trust floor for a PAID listing applied only at
 *     publish, so publish-free-then-edit was the way around both.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ActionRecord } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { calculateTrustScore } from '../services/trust.js';
import { ActionPublishSchema, ActionUpdateSchema, validateBody } from '../models/schemas.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity, mayActOnAgent } from '../utils/gaii.js';
import { actionPricingFromRequest, presentActionPricing } from '../services/action-pacing.js';

const ALLOWED_CATEGORIES = [
  'language', 'translation', 'analysis', 'generation', 'coding',
  'data', 'image', 'audio', 'video', 'search', 'utility', 'other',
] as const;

export function actionsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/actions — publish an action (agent auth)
  router.post('/v1/actions', requireAuth(), requireExternalPrincipal(), requireScope('work:publish'),validateBody(ActionPublishSchema, config.nodeId), async (req, res) => {
    const { id, display_name, description, category, input_schema, output_schema, pricing, estimated_time_seconds, max_input_size_bytes, tags, webhook_url, semantic, federate } = req.body ?? {};

    // Category validation
    if (category && !ALLOWED_CATEGORIES.includes(category)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`));
      return;
    }

    // The provider is the caller's resolved identity: a person's GHII, an agent's own GAII. Every work
    // item on the action is addressed to it and every work door compares it, so the person who
    // published an action is the one who takes the work on it.
    const gaii = resolveIdentity(req.auth!, config.nodeId);

    // The pacing amount per use: toll_morsels, or the 3.x base_morsels read as pacing until 4.0.0.
    const priced = actionPricingFromRequest(config, pricing ?? {});
    if ('code' in priced) { res.status(400).json(error(config.nodeId, priced.code, priced.message)); return; }

    // Min trust enforcement for an action that earns pacing: the provider is credited the escrowed
    // pacing amount on every accepted request, so the floor that guarded morsel-priced actions holds.
    if (priced.pricing.tollMorsels > 0) {
      const trust = await calculateTrustScore(gaii, storage);
      if (trust.score < config.minTrustForPaidActions) {
        res.status(403).json(error(config.nodeId, 'TRUST_TOO_LOW',
          `Trust score ${trust.score} is below minimum ${config.minTrustForPaidActions} for an action with pacing`));
        return;
      }
    }

    // Action limit per agent
    const existingActions = await storage.listActionsByProvider(gaii);
    if (existingActions.length >= config.maxActionsPerAgent) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${config.maxActionsPerAgent} actions per agent. Delete unused actions first.`));
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
        pricing: priced.pricing,
        estimatedTimeSeconds: estimated_time_seconds,
        maxInputSizeBytes: max_input_size_bytes,
        tags: tags ?? [],
        webhookUrl: webhook_url,
        semantic: semantic && typeof semantic === 'object' ? semantic : undefined,
        federate: federate === true,
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
      emitChange('actions');
    } catch (e) {
      if (e instanceof Error && e.message === 'ACTION_EXISTS') {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Action "${id}" already exists for this agent`));
        return;
      }
      throw e;
    }
  });

  // DELETE /v1/actions/:id[?provider=<identity>] — remove an action. Without `provider` it is the
  // caller's own action. With it, the caller's own agent's action: the owner signed in as themselves
  // may remove what their agent published (mayActOnAgent), which the Unpublish button on the agent's
  // Services tab needs. Before this, the owner's call looked for the action under the owner's GHII
  // and answered 404.
  router.delete('/v1/actions/:id', requireAuth(), requireExternalPrincipal(), requireScope('work:publish'), async (req, res) => {
    const self = resolveIdentity(req.auth!, config.nodeId);
    const asked = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
    const gaii = asked || self;
    if (gaii !== self && !mayActOnAgent(req.auth, gaii, config.nodeId)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'You can remove only your own actions and the actions of your own agents. Sign in as the owner of that agent to remove it.',
        403, { provider: gaii }));
      return;
    }
    const deleted = await storage.deleteAction(req.params.id as string, gaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${req.params.id}`));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, id: req.params.id }, [
      { description: 'View catalogue', method: 'GET', url: '/v1/catalogue' },
    ]));
    emitChange('actions');
  });

  // GET /v1/actions — discover actions (Tier 0, no auth)
  // `provider` narrows the list to one provider by its exact identity. The agent's Services tab
  // used to filter the whole list in the browser by a substring of the agent's name, so another
  // owner's agent with the same name showed up as this one's.
  router.get('/v1/actions', async (req, res) => {
    const q = req.query.q as string | undefined;
    const category = req.query.category as string | undefined;
    const provider = typeof req.query.provider === 'string' && req.query.provider.trim()
      ? req.query.provider.trim() : null;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string ?? '50', 10)));

    const listed = await storage.listActions({ search: q, category });
    const actions = provider ? listed.filter(a => a.providerGaii === provider) : listed;
    const start = (page - 1) * perPage;
    const paged = actions.slice(start, start + perPage);

    // How often each action was called is the provider's business: counted only for the provider
    // itself or the owner of the provider agent, and only when the list is narrowed to it.
    const self = req.auth ? resolveIdentity(req.auth, config.nodeId) : null;
    const mayCount = !!provider && (self === provider || mayActOnAgent(req.auth, provider, config.nodeId));
    const calls = new Map<string, number>();
    if (mayCount) {
      for (const w of await storage.listWorkByProvider(provider)) calls.set(w.actionId, (calls.get(w.actionId) ?? 0) + 1);
    }

    res.json(success(config.nodeId, {
      actions: paged.map(a => ({
        id: a.id,
        display_name: a.displayName,
        description: a.description,
        provider_gaii: a.providerGaii,
        category: a.category,
        pricing: presentActionPricing(a.pricing, 'snake'),
        tags: a.tags,
        semantic: a.semantic,
        federate: a.federate ?? false,
        // A published action is listed here for anyone and can be called while it exists: there is
        // no private or paused action, so these two are facts, not defaults.
        visibility: 'public',
        status: 'active',
        ...(mayCount ? { call_count: calls.get(a.id) ?? 0 } : {}),
      })),
      total: actions.length,
    }, [
      { description: 'View full catalogue', method: 'GET', url: '/v1/catalogue' },
    ], { page, per_page: perPage, total: actions.length }));
  });

  // PUT /v1/actions/:id — update an action (agent auth)
  // The scope was on publish and on delete but not here, so an update was the one way into an
  // action listing without the word that governs it. Adding it can refuse an agent that used to
  // pass with a narrower grant; that refusal is the point.
  router.put('/v1/actions/:id', requireAuth(), requireExternalPrincipal(), requireScope('work:publish'), validateBody(ActionUpdateSchema, config.nodeId), async (req, res) => {
    const gaii = resolveIdentity(req.auth!, config.nodeId);
    const id = req.params.id as string;
    const { display_name, description, category, input_schema, output_schema, pricing, estimated_time_seconds, max_input_size_bytes, tags, semantic, federate } = req.body ?? {};

    // THE TWO CHECKS PUBLISH MAKES, MADE HERE TOO. They were on POST alone, so the way past both was
    // to publish a free action in an allowed category and then edit it: `category` was validated
    // against ALLOWED_CATEGORIES only at publish, and the trust floor for a PAID listing only at
    // publish, which made "publish free, then set a price" the way around a floor the node advertises.
    if (category !== undefined && !ALLOWED_CATEGORIES.includes(category)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`));
      return;
    }
    // Only when this update WRITES a pacing amount. An edit that does not touch pricing leaves a
    // listing that already cleared the floor alone: a trust score that has since drifted should make
    // a listing unlisted by some other decision, not make it uneditable by this one.
    let nextPricing: ActionRecord['pricing'] | undefined;
    if (pricing !== undefined) {
      // Neither toll_morsels nor base_morsels sent: the stored pacing amount stays.
      const current = await storage.getAction(id, gaii);
      const priced = actionPricingFromRequest(config, pricing, current?.pricing.tollMorsels);
      if ('code' in priced) { res.status(400).json(error(config.nodeId, priced.code, priced.message)); return; }
      nextPricing = priced.pricing;
    }
    if (nextPricing && nextPricing.tollMorsels > 0) {
      const trust = await calculateTrustScore(gaii, storage);
      if (trust.score < config.minTrustForPaidActions) {
        res.status(403).json(error(config.nodeId, 'TRUST_TOO_LOW',
          `Trust score ${trust.score} is below minimum ${config.minTrustForPaidActions} for an action with pacing`));
        return;
      }
    }

    const updates: Partial<ActionRecord> = { updatedAt: new Date().toISOString() };
    if (display_name !== undefined) updates.displayName = display_name;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (input_schema !== undefined) updates.inputSchema = input_schema;
    if (output_schema !== undefined) updates.outputSchema = output_schema;
    if (nextPricing !== undefined) updates.pricing = nextPricing;
    if (estimated_time_seconds !== undefined) updates.estimatedTimeSeconds = estimated_time_seconds;
    if (max_input_size_bytes !== undefined) updates.maxInputSizeBytes = max_input_size_bytes;
    if (tags !== undefined) updates.tags = tags;
    if (semantic !== undefined) updates.semantic = semantic;
    if (typeof federate === 'boolean') updates.federate = federate;

    const updated = await storage.updateAction(id, gaii, updates);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'ACTION_NOT_FOUND', `Action not found: ${id}`));
      return;
    }

    res.json(success(config.nodeId, {
      id: updated.id,
      display_name: updated.displayName,
      description: updated.description,
      federate: updated.federate ?? false,
      updated_at: updated.updatedAt,
    }));
    emitChange('actions');
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
      pricing: presentActionPricing(action.pricing),
      estimated_time_seconds: action.estimatedTimeSeconds,
      tags: action.tags,
      semantic: action.semantic,
      federate: action.federate ?? false,
      created_at: action.createdAt,
      updated_at: action.updatedAt,
    }));
  });

  return router;
}
