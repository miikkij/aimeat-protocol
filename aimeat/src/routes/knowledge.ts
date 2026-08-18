/**
 * @file knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge package routes — import, CRUD, links, sharing, cloning,
 *   export, organism contribution, reputation, and operator review endpoints.
 *   All routes are under /v1/knowledge/* (plus /v1/templates/* and /v1/admin/knowledge/*).
 *   The handlers are grouped into sibling modules under ./knowledge/ and registered here in
 *   their original declaration order.
 * @structure
 *   - knowledgeRouter() — main router factory
 *   - ./knowledge/helpers.ts — resolve() + findOwnerScopeMemory()
 *   - ./knowledge/packages-core.ts — import, get manifest, link CRUD, broken-links
 *   - ./knowledge/templates.ts — knowledge-packager + chat-session prompt templates
 *   - ./knowledge/sharing.ts — sharing settings, entry visibility, clone, export
 *   - ./knowledge/organism.ts — contribute, organism list, reputation
 *   - ./knowledge/admin.ts — operator list/import/delete/review + reviews list
 * @usage
 *   import { knowledgeRouter } from '../routes/knowledge.js';
 *   app.use(knowledgeRouter(config, storage));
 * @version-history
 *   v1.3.0 — 2026-07-16 — Add GET /v1/knowledge/tab composite (owner packages + consents) folding the
 *     Knowledge tab's owner-scoped mount; discovery + per-organism packages stay separate (KnowledgeTabService).
 *   v1.0.0 — 2026-03-07 — initial knowledge package system
 *   v1.1.0 — 2026-03-18 — rename routes from /v1/packages/* to /v1/knowledge/*
 *   v1.2.0 — 2026-06-16 — Record a public-activity-feed event when a package becomes
 *     catalog_listed (on import and on the sharing private→public edge).
 *   v1.3.0 — 2026-07-13 — Split handler groups into sibling modules under ./knowledge/ to
 *     satisfy max-file-lines; registration order and behavior unchanged.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { createKnowledgeTabService } from '../services/db/knowledge-tab-db-service.js';
import { makeKnowledgeHelpers } from './knowledge/helpers.js';
import { registerPackagesCoreRoutes } from './knowledge/packages-core.js';
import { registerTemplateRoutes } from './knowledge/templates.js';
import { registerSharingRoutes } from './knowledge/sharing.js';
import { registerOrganismRoutes } from './knowledge/organism.js';
import { registerAdminRoutes } from './knowledge/admin.js';

export function knowledgeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const helpers = makeKnowledgeHelpers(config, storage);

  // GET /v1/knowledge/tab — the Knowledge tab's OWNER-scoped mount in one call: the owner's knowledge
  // packages + consents (the tab derives federated packages from the consents). Public discovery and the
  // per-organism shared-package scan stay separate (cross-user / heavy node-wide scan). MUST be registered
  // before the /v1/knowledge/:id captures below (a literal 'tab' would otherwise match :id).
  const knowledgeTabDb = createKnowledgeTabService(storage);
  router.get('/v1/knowledge/tab', requireAuth(), requireRole('owner'), async (req, res) => {
    const data = await knowledgeTabDb.overview(resolveIdentity(req.auth!, config.nodeId));
    res.json(success(config.nodeId, data));
  });

  // Register handler groups IN ORIGINAL DECLARATION ORDER (Express matches top-to-bottom).
  registerPackagesCoreRoutes(router, config, storage, helpers);
  registerTemplateRoutes(router, config, storage, helpers);
  registerSharingRoutes(router, config, storage, helpers);
  registerOrganismRoutes(router, config, storage, helpers);
  registerAdminRoutes(router, config, storage, helpers);

  return router;
}
