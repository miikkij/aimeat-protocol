import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import type { DirectoryService } from '../services/directory.js';
import type { RealtimeStats } from '../services/realtime-manager.js';

export function catalogueRouter(config: AimeatConfig, storage: Storage, directoryService?: DirectoryService, getRealtimeStats?: () => RealtimeStats | null): Router {
  const router = Router();

  // GET /v1/catalogue — public action catalogue (Tier 0, no auth)
  router.get('/v1/catalogue', async (req, res) => {
    const search = req.query.search as string | undefined;
    const category = req.query.category as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string ?? '20', 10)));

    const actions = await storage.listActions({ search, category });
    const start = (page - 1) * perPage;
    const paged = actions.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
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
      { description: 'View node bootstrap info', method: 'GET', url: '/' },
      { description: 'Register as an owner to start using actions', method: 'POST', url: '/v1/owners' },
    ], { page, per_page: perPage, total: actions.length }));
  });

  // GET /v1/catalogue/actions — actions sub-catalogue (Tier 0)
  router.get('/v1/catalogue/actions', async (req, res) => {
    const category = req.query.category as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string ?? '20', 10)));

    const actions = await storage.listActions({ category });
    const start = (page - 1) * perPage;
    const paged = actions.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      actions: paged.map(a => ({
        id: a.id,
        display_name: a.displayName,
        description: a.description,
        provider_gaii: a.providerGaii,
        category: a.category,
        pricing: { base_morsels: a.pricing.baseMorsels },
        tags: a.tags,
        semantic: a.semantic,
      })),
      total: actions.length,
    }, undefined, { page, per_page: perPage, total: actions.length }));
  });

  // GET /v1/catalogue/agents — agent directory (Tier 0)
  router.get('/v1/catalogue/agents', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string ?? '20', 10)));

    const agents = await storage.listAgents();
    const start = (page - 1) * perPage;
    const paged = agents.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      agents: paged.map(a => ({
        gaii: a.gaii,
        display_name: a.displayName,
        description: a.description,
        trust_score: a.trustScore,
        capabilities: a.capabilities,
        semantic: a.semantic,
        last_seen: a.lastSeen,
      })),
      total: agents.length,
    }, undefined, { page, per_page: perPage, total: agents.length }));
  });

  // GET /v1/catalogue/boards — public boards (Tier 0)
  router.get('/v1/catalogue/boards', async (_req, res) => {
    const boards = await storage.listBoards();
    const publicBoards = boards.filter(b => b.visibility === 'public');

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      boards: publicBoards.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        semantic: b.semantic,
        created_at: b.createdAt,
      })),
      total: publicBoards.length,
    }));
  });

  // GET /v1/catalogue/hash — SHA-256 for change detection (§17.3 Tier 0)
  router.get('/v1/catalogue/hash', async (_req, res) => {
    const actions = await storage.listActions();
    const agents = await storage.listAgents();
    const boards = await storage.listBoards();

    // Include updatedAt so edits are detected, not just additions
    const content = JSON.stringify({
      actions: actions.map(a => ({ id: a.id, u: a.updatedAt })).sort((x, y) => x.id.localeCompare(y.id)),
      agents: agents.map(a => ({ g: a.gaii, s: a.lastSeen })).sort((x, y) => x.g.localeCompare(y.g)),
      boards: boards.map(b => b.id).sort(),
      counts: { actions: actions.length, agents: agents.length, boards: boards.length },
    });

    const hash = createHash('sha256').update(content).digest('hex');

    res.json(success(config.nodeId, {
      hash,
      counts: { actions: actions.length, agents: agents.length, boards: boards.length },
      computed_at: new Date().toISOString(),
    }));
  });

  // GET /v1/stats — public node statistics (Tier 0)
  router.get('/v1/stats', async (_req, res) => {
    const agents = await storage.listAgents();
    const actions = await storage.listActions();
    const boards = await storage.listBoards();
    const owners = await storage.listOwners();

    let activeAgents24h = 0;
    const now = Date.now();
    for (const a of agents) {
      if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) {
        activeAgents24h++;
      }
    }

    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      uptime_seconds: Math.floor(process.uptime()),
      counts: {
        owners: owners.length,
        agents: agents.length,
        active_agents_24h: activeAgents24h,
        actions: actions.length,
        boards: boards.length,
      },
      economy: {
        welcome_bonus: config.welcomeBonus,
        daily_allowance: config.dailyAllowance,
        burn_rate: config.burnRate,
      },
      ...(getRealtimeStats ? (() => {
        const rt = getRealtimeStats();
        return rt ? { realtime: { rooms: rt.rooms, peers: rt.peers, messages_in: rt.messagesIn, messages_out: rt.messagesOut } } : {};
      })() : {}),
    }));
  });

  // GET /v1/catalogue/directory — people directory search (Tier 0, Phase 1.4)
  // Consent note: DirectoryService only indexes profiles with an active "federation"
  // consent grant, so all entries returned here have already opted in to public listing.
  router.get('/v1/catalogue/directory', async (req, res) => {
    if (!directoryService) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Directory service is not available'));
      return;
    }

    const type = req.query.type as string | undefined;
    const city = req.query.city as string | undefined;
    const area = req.query.area as string | undefined;
    const country = req.query.country as string | undefined;
    const interest = req.query.interest as string | undefined;
    const interestsRaw = req.query.interests as string | undefined;
    const radiusKm = req.query.radius_km ? parseFloat(req.query.radius_km as string) : undefined;
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lon = req.query.lon ? parseFloat(req.query.lon as string) : undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string ?? '20', 10)));

    const interests = interestsRaw ? interestsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    const result = await directoryService.search({
      type: type as 'people' | 'organisms' | undefined,
      city,
      area,
      country,
      interest,
      interests,
      radiusKm,
      lat,
      lon,
      page,
      perPage,
    });

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      entries: result.entries,
      facets: result.facets,
      total: result.total,
    }, [
      { description: 'View directory statistics', method: 'GET', url: '/v1/catalogue/directory/stats' },
      { description: 'Browse action catalogue', method: 'GET', url: '/v1/catalogue' },
    ], { page, per_page: perPage, total: result.total }));
  });

  // GET /v1/catalogue/directory/stats — directory statistics (Tier 0, Phase 1.4)
  router.get('/v1/catalogue/directory/stats', async (_req, res) => {
    if (!directoryService) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Directory service is not available'));
      return;
    }

    const stats = directoryService.getStats();

    res.json(success(config.nodeId, {
      total_people: stats.totalPeople,
      top_interests: stats.topInterests,
      top_cities: stats.topCities,
      updated_at: stats.updatedAt,
    }, [
      { description: 'Search the directory', method: 'GET', url: '/v1/catalogue/directory' },
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
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
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
    }));
  });

  return router;
}
