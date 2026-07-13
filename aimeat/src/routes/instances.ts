/**
 * @file instances.ts
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
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { registerInstallRoutes } from './instances/install.js';
import { registerManageRoutes } from './instances/manage.js';
import { registerMigrationRoutes } from './instances/migration.js';

// ── Router factory ────────────────────────────────────────────────────

export function instancesRouter(
  config: AimeatConfig,
  storage: Storage,
  scheduler?: Scheduler,
): Router {
  const router = Router();

  // ══════════════════════════════════════════════════════════════════════
  // Phase 3: Instance Management
  // ══════════════════════════════════════════════════════════════════════

  // POST /v1/packages/:groupId/install
  registerInstallRoutes(router, config, storage, scheduler);

  // GET /v1/instances, GET/:id/status, GET/:id/check-update, GET/:id, DELETE /:id
  registerManageRoutes(router, config, storage);

  // ══════════════════════════════════════════════════════════════════════
  // Phase 4: Migration
  // ══════════════════════════════════════════════════════════════════════

  // POST /:id/migration-prompt, POST /:id/apply-migration
  registerMigrationRoutes(router, config, storage);

  return router;
}
