/**
 * @file memory.ts
 * @description Memory CRUD routes, file storage, search, and federated memory
 *   browsing (pull/push/list across nodes). Route handlers live in sibling modules
 *   under src/routes/memory/ (crud, bulk, federation, files, key); this file wires
 *   them onto one router in registration order (Express matches top-to-bottom).
 * @version-history
 *   v (2026-07-04) — /v1/memory/files upload + download accept external principals (agent/ecosystem/app)
 *     via requireExternalPrincipal, so H-2 app-grant sessions (role 'app') can store/preview drop files.
 *   v1.0.0 — 2026-03-15 — Initial memory routes
 *   v1.1.0 — 2026-05-22 — Add list-home, list-remote, pull-remote federation endpoints
 *   v1.2.0 — 2026-05-22 — Add discover and copy endpoints for cross-user public memory
 *   v1.3.0 -- 2026-05-28 -- Include owner_gaii in memory listing responses
 *   v1.4.0 -- 2026-06-07 -- Route public-read through shared authorizeRead() (access-guard) so
 *     memory and file storage share one access decision + audit path.
 *   v1.5.0 -- 2026-06-15 -- Fire ecosystem-app automation recipes (feature B4) on a successful
 *     memory write — a data publish on a matching key glob materialises an agent task per agent.
 *   v1.6.0 -- 2026-06-22 -- Scalable Memory tab: GET /v1/memory?include=meta (omit values, report
 *     per-entry bytes), GET /v1/memory/search?prefix= (scope to a namespace), and new bulk routes
 *     GET /v1/memory/export, POST /v1/memory/import (skip/overwrite/rename), POST /v1/memory/bulk-delete.
 *   v1.7.0 -- 2026-07-02 -- GET /v1/memory/:key honors ?owner_scope=true for non-owner same-owner
 *     principals (app grants, agents), mirroring the list route's opt-in — so a document's live
 *     aimeat-memory embed (app session) can read a key an MCP agent wrote under its GAII.
 *   v1.8.0 -- 2026-07-03 -- POST /v1/memory/bundle: ZIP export of selected memory values + storage
 *     files (+ manifest.json) for the profile "collection cart". Owner-scoped (caller's GHII + owned
 *     agents); non-owned/missing items are skipped and recorded in the manifest. Uses archiver.
 *   v1.9.0 -- 2026-07-11 -- POST /v1/memory/files response adds embed_url/embed_markdown (owner-addressed
 *     /v1/pub embed form; see services/doc-images).
 *   v1.10.0 -- 2026-07-13 -- Split handlers into sibling modules under src/routes/memory/ (max-file-lines);
 *     behavior, routes, and registration order unchanged.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import { resolveIdentity } from '../utils/gaii.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { createMemoryTabService } from '../services/db/memory-tab-db-service.js';
import { createMemoryDbService } from '../services/db/index.js';
import type { StatsCollector } from '../services/stats.js';
import type { MemoryRouteCtx } from './memory/shared.js';
import { registerCrudRoutes } from './memory/crud.js';
import { registerBulkRoutes } from './memory/bulk.js';
import { registerFederationRoutes } from './memory/federation.js';
import { registerFilesRoutes } from './memory/files.js';
import { registerKeyRoutes } from './memory/key.js';

export function memoryRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector, onDirectoryChange?: () => void, peers?: Map<string, import('../services/federation.js').PeerInfo>): Router {
  const router = Router();

  // Phase 2.3 — Workspace access middleware for organism.* namespace keys
  const workspaceAccess = workspaceAccessMiddleware(config, storage);

  /** Resolve effective identity for memory operations — owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // Data-access redesign: the memory Application-DB-Service, built once and shared via ctx. Routes call
  // its batched whole-operations (owner-scope reads, writeMany) instead of hitting storage directly.
  const memoryDb = createMemoryDbService(storage, config);

  const ctx: MemoryRouteCtx = { config, storage, memoryDb, stats, onDirectoryChange, peers, resolve, workspaceAccess };

  // GET /v1/memory/tab — the whole Memory tab mount in ONE call (agents + owner-scope memory METADATA +
  // files + consent + sharing-groups + organisms), composed in one read scope by MemoryTabService. The
  // memory section is metadata-only (no values loaded). Owner-scope: requires 'owner' role — the Memory
  // tab is an owner view, stricter than the folded endpoints. MUST be registered before the /:key
  // captures below. The individual endpoints stay for interactive re-fetches (agent filter, archived).
  const memoryTabDb = createMemoryTabService(config, storage);
  router.get('/v1/memory/tab', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const data = await memoryTabDb.overview(owner, `${owner}@${config.nodeId}`);
    res.json(success(config.nodeId, data));
  });

  // Registration order is load-bearing (Express matches top-to-bottom): more-specific literal paths
  // (/v1/memory/search, /export, /files, ...) MUST be registered before the /:key and /:gaii/:key
  // captures. Keep these calls in this order.
  registerCrudRoutes(router, ctx);        // POST /v1/memory, GET /v1/memory, GET /v1/memory/search
  registerBulkRoutes(router, ctx);        // export, import, bulk-delete, bundle, discover, copy
  registerFederationRoutes(router, ctx);  // pull, push-home, list-home, list-remote, pull-remote
  registerFilesRoutes(router, ctx);       // /v1/memory/files (upload, visibility, tags, list, get, delete)
  registerKeyRoutes(router, ctx);         // /v1/memory/:key (get/delete/put), cors, /v1/memory/:gaii/:key

  return router;
}
