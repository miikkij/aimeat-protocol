/**
 * @file discover.ts
 * @description The unified "master directory" discovery route — one faceted surface over every
 *   content domain so agents/Secretary and humans can ask "what exists here that I can use?"
 *   `GET /v1/discover` returns ranked, paginated, normalized `DiscoveryEntry` items; `GET
 *   /v1/discover/facets` returns the catalog-of-catalogs counts (map mode — a cheap probe before
 *   pulling entries). Generic + reusable: the handler holds NO domain logic — it builds a
 *   `DiscoveryContext` and delegates to the source registry (design doc 2026-06-23, §3/§4).
 *   Phase 1: scope=own|public only (scope=shared lands in Phase 3).
 * @structure
 *   - discoverRouter(config, storage) — registers the memory/FTS source, mounts both routes
 *   - buildContext() — resolve caller + scope + filters from the request
 *   - GET /v1/discover · GET /v1/discover/facets
 * @usage app.use(discoverRouter(config, storage))
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 1: /v1/discover + /facets over the memory/FTS source.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  buildDiscoveryRegistry,
  runDiscovery,
  computeFacets,
  type DiscoveryContext,
  type DiscoveryFilters,
  type DiscoveryType,
} from '../services/discovery/index.js';

const MAX_PER_PAGE = 100;
const VALID_TYPES = new Set<DiscoveryType>([
  'capability', 'workflow', 'knowledge', 'decision', 'research', 'material',
  'company', 'offering', 'document', 'organism', 'app', 'memory',
]);

/** Split a CSV query param into a trimmed, non-empty list. */
function csv(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function parseFilters(query: Record<string, unknown>): DiscoveryFilters {
  const types = csv(query.type).filter((t): t is DiscoveryType => VALID_TYPES.has(t as DiscoveryType));
  const limitRaw = typeof query.limit === 'string' ? parseInt(query.limit, 10) : NaN;
  return {
    q: typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined,
    types: types.length ? types : undefined,
    segments: csv(query.segment).length ? csv(query.segment) : undefined,
    tags: csv(query.tags).length ? csv(query.tags) : undefined,
    owner: typeof query.owner === 'string' && query.owner.trim() ? query.owner.trim() : undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  };
}

/**
 * Build the discovery context from the request, or return an error response.
 * Default scope: authenticated → own; anonymous → public. scope=shared is Phase 3.
 */
function buildContext(
  req: { auth?: { sub: string; owner: string; roles: string[]; scopes?: string[] }; query: Record<string, unknown> },
  config: AimeatConfig,
): { ctx: DiscoveryContext } | { errCode: string; errMsg: string; status: number } {
  const requested = typeof req.query.scope === 'string' ? req.query.scope : undefined;
  const scope = requested ?? (req.auth ? 'own' : 'public');

  if (scope !== 'own' && scope !== 'public' && scope !== 'shared') {
    return { errCode: 'INVALID_INPUT', errMsg: 'scope must be one of: own, public, shared', status: 400 };
  }
  if ((scope === 'own' || scope === 'shared') && !req.auth) {
    return { errCode: 'UNAUTHORIZED', errMsg: `scope=${scope} requires authentication`, status: 401 };
  }

  const filters = parseFilters(req.query);
  const ctx: DiscoveryContext = {
    caller: req.auth
      ? {
          ownerName: req.auth.owner,
          sub: req.auth.sub,
          gaii: resolveIdentity(req.auth, config.nodeId),
          isOwnerSession: req.auth.roles.includes('owner') && !req.auth.roles.includes('agent'),
          scopes: req.auth.scopes ?? [],
        }
      : { ownerName: '', sub: '', gaii: '', isOwnerSession: false, scopes: [] },
    scope,
    filters,
    nodeId: config.nodeId,
  };
  return { ctx };
}

export function discoverRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Shared source registry (same list the MCP aimeat_discover tool uses). Adding a content type =
  // one register() in services/discovery/setup.ts (design §7); this handler never changes.
  const registry = buildDiscoveryRegistry(storage, config);

  // GET /v1/discover — ranked, paginated, faceted entries (entry mode).
  router.get('/v1/discover', async (req, res) => {
    const built = buildContext(req as never, config);
    if ('errCode' in built) {
      res.status(built.status).json(error(config.nodeId, built.errCode, built.errMsg));
      return;
    }

    const pageRaw = parseInt((req.query.page as string) ?? '1', 10);
    const perPageRaw = parseInt((req.query.per_page as string) ?? '20', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perPage = Math.min(Number.isFinite(perPageRaw) && perPageRaw > 0 ? perPageRaw : 20, MAX_PER_PAGE);

    const entries = await runDiscovery(registry, built.ctx);
    const start = (page - 1) * perPage;
    const pageItems = entries.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      entries: pageItems,
      total: entries.length,
      page,
      per_page: perPage,
      scope: built.ctx.scope,
      facets: computeFacets(entries),
    }, [
      { description: 'Get the catalog map (counts only)', method: 'GET', url: '/v1/discover/facets' },
    ]));
  });

  // GET /v1/discover/facets — map mode: catalog-of-catalogs counts, no entries.
  router.get('/v1/discover/facets', async (req, res) => {
    const built = buildContext(req as never, config);
    if ('errCode' in built) {
      res.status(built.status).json(error(config.nodeId, built.errCode, built.errMsg));
      return;
    }
    const entries = await runDiscovery(registry, built.ctx);
    res.json(success(config.nodeId, {
      scope: built.ctx.scope,
      total: entries.length,
      ...computeFacets(entries),
    }, [
      { description: 'Fetch matching entries', method: 'GET', url: '/v1/discover' },
    ]));
  });

  return router;
}
