/**
 * @file instances.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package instance API routes — install packages, track instances,
 *   check for updates, generate migration prompts, and apply migrations.
 *   Includes real component registration via native storage APIs, rollback on
 *   failure, dry_run validation, and hash-based customization detection.
 *   Handler groups extracted to sibling modules under ./instances/ (max-file-lines).
 * @structure
 *   - instancesRouter() — main router factory
 *   - ./instances/install.ts — POST /v1/packages/:groupId/install (supports dry_run)
 *   - ./instances/manage.ts — GET /v1/instances, GET/:id, GET/:id/status,
 *     GET/:id/check-update, DELETE /:id
 *   - ./instances/migration.ts — POST /:id/migration-prompt, POST /:id/apply-migration
 *   - ./instances/install-requests.ts — the install requests an agent or an app files, and the
 *     decision door the owner and their agents answer them on
 *   - ./instances/install-sets.ts — POST /v1/install-sets/apply, GET /v1/install-sets
 * @usage
 *   import { instancesRouter } from '../routes/instances.js';
 *   app.use(instancesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phases 3-4)
 *   v1.1.0 — 2026-03-15 — rename install route from /v1/packages to /v1/bundles
 *   v2.1.0 — 2026-03-18 — rename install route back from /v1/bundles to /v1/packages (knowledge moved to /v1/knowledge)
 *   v2.0.0 — 2026-03-15 — full implementation: component registration, rollback,
 *     dry_run, hash comparison, migration apply, component deletion
 *   v2.2.0 — 2026-07-13 — extract handler groups to ./instances/{install,manage,migration}.ts (max-file-lines)
 *   v2.3.0 — 2026-09-25 — ./instances/install-requests.ts: the package install requests and their decision door
 *   v2.4.0 — 2026-09-28 — The router takes the federation peers, for POST /v1/instances/check-updates.
 *   v2.5.0 — 2026-09-28 — ./instances/install-sets.ts: applying an install set (install packages, phase 4).
 *   v2.6.0 — 2026-10-02 — The install route takes the peers too: installing a set reaches its repository.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import type { PeerInfo } from '../services/federation.js';
import { registerInstallRoutes } from './instances/install.js';
import { registerManageRoutes } from './instances/manage.js';
import { registerMigrationRoutes } from './instances/migration.js';
import { registerInstallRequestRoutes } from './instances/install-requests.js';
import { registerInstallSetRoutes } from './instances/install-sets.js';

// ── Router factory ────────────────────────────────────────────────────

export function instancesRouter(
  config: AimeatConfig,
  storage: Storage,
  scheduler?: Scheduler,
  peers: Map<string, PeerInfo> = new Map(),
): Router {
  const router = Router();

  // ══════════════════════════════════════════════════════════════════════
  // Phase 3: Instance Management
  // ══════════════════════════════════════════════════════════════════════

  // POST /v1/packages/:groupId/install
  registerInstallRoutes(router, config, storage, scheduler, peers);

  // GET /v1/instances, GET/:id/status, GET/:id/check-update, GET/:id, DELETE /:id, PATCH /:id,
  // POST /:id/fork, POST /check-updates (the last reaches other nodes, so it takes the peers)
  registerManageRoutes(router, config, storage, peers);

  // ══════════════════════════════════════════════════════════════════════
  // Phase 4: Migration
  // ══════════════════════════════════════════════════════════════════════

  // POST /:id/migration-prompt, POST /:id/apply-migration
  registerMigrationRoutes(router, config, storage);

  // GET /v1/package-install-requests(/:id), POST /v1/package-install-requests/:id/decision
  registerInstallRequestRoutes(router, config, storage, scheduler);

  // POST /v1/install-sets/apply, GET /v1/install-sets: the operator sets up this node from an install set
  registerInstallSetRoutes(router, config, storage, peers, scheduler);

  return router;
}
