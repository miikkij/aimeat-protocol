/**
 * @file extensions.ts
 * @description REST routes for the WASM/sandbox Extension system — install (POST), idempotent
 *   upsert/redeploy (PUT), inspect, activate/deactivate, action-script patch, instances, action
 *   execution (/v1/ext/...), and uninstall (DELETE). Extensions run server-side action scripts
 *   in a sandbox with a scoped ctx (memory/fetch/wallet/consent/...).
 * @structure extensionsRouter() wires three sibling route groups (extensions/crud.ts —
 *   lifecycle/install/activate; extensions/instances.ts — per-instance CRUD; extensions/actions.ts
 *   — action execution) in original registration order. Shared: extensions/manifest.ts
 *   (buildExtensionRecordFromManifest) + extensions/permissions.ts (write/manage guards).
 * @usage app.use(extensionsRouter(config, storage, scheduler, emailService)) in server.ts
 * @version-history
 *   v1.4.0 — 2026-07-13 — Split into extensions/ sibling modules (crud/instances/actions/manifest/
 *     permissions) to satisfy max-file-lines; pure extraction, registration order + behavior preserved.
 *   v1.3.0 — 2026-07-10 — Security (TARGET-020): ownership guard (canManageInstalledExt) on
 *     activate/deactivate — owner sessions bypass requireScope, so a second owner could toggle another
 *     owner's extension (DELETE/PUT/instances were already guarded).
 *   v1.2.0 — 2026-06-24 — Secretary P5 (S-C / §18): config fields marked `type: secret` (manifest
 *     `config:` or per-instance `config_per_instance`) are encrypted at rest (AES-256-GCM, node key)
 *     on install/update + instance create/update, decrypted only just before the sandbox VM, and
 *     masked in API responses. See services/extension-secrets.ts.
 *   v1.1.0 — 2026-06-05 — Add PUT /v1/extensions/:name idempotent upsert: redeploy in place
 *     (preserving ext:{name} memory + instances) instead of DELETE→re-POST; extract shared
 *     manifest validator so POST and PUT stay in sync.
 *   v1.1.1 — 2026-06-19 — Security (CR-1): ctx.wallet.consume rejects non-positive/non-finite
 *     amounts before debiting (a negative amount would mint morsels).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { registerExtensionCrudRoutes } from './extensions/crud.js';
import { registerExtensionInstanceRoutes } from './extensions/instances.js';
import { registerExtensionActionRoutes } from './extensions/actions.js';

export function extensionsRouter(config: AimeatConfig, storage: Storage, scheduler?: Scheduler, emailService?: import('../services/email.js').EmailService): Router {
  const router = Router();

  // Registration order matters (Express matches top-to-bottom): lifecycle/CRUD routes first,
  // then per-instance routes, then the /v1/ext/... action-execution routes.
  registerExtensionCrudRoutes(router, config, storage, scheduler);
  registerExtensionInstanceRoutes(router, config, storage);
  registerExtensionActionRoutes(router, config, storage, emailService);

  return router;
}
