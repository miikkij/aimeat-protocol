/**
 * @file agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent registration, device authorization, public profiles,
 *   owner-managed metadata, heartbeat, portability, and import/export routes.
 * @structure
 *   - agentsRouter() -- Express router for agent identity and lifecycle APIs
 *   - RFC 8628 device authorization endpoints
 *   - Agent listing/profile/tag metadata endpoints
 * @usage
 *   app.use(agentsRouter(config, storage));
 * @version-history
 *   v1.0.0 -- 2026-03-15 -- Initial agent routes
 *   v1.x -- 2026-07-03 -- Add GET /v1/agents/:name/engagements (same-owner contract-engagement list)
 *   v1.1.0 -- 2026-05-28 -- Expose owner-managed shared-memory tags
 *   v1.2.0 -- 2026-06-24 -- PATCH /tags is same-owner gated (was owner-role only); agents
 *     may now self-tag (parity with capabilities self-report + server-MCP tags_set). Tag pattern
 *     allows ':' so faceted prefix:value tags validate and compose with aimeat_discover.
 *   v1.3.0 -- 2026-07-02 -- PATCH /mode is same-owner gated (was owner-role only), mirroring /tags:
 *     a device-authed crew (the new connector drops `connect add --mode task-runner`) can self-set
 *     task-runner mode at startup via aimeat_agent_mode_set(self). The handler already enforced
 *     same-owner (own-owner check), so only the route-level requireRole('owner') was dropped.
 *   v1.3.1 -- 2026-07-02 -- PATCH /mode now RE-DERIVES the Hello Integration step list for the new
 *     mode's flow (preserving passed steps), so an agent that self-sets task-runner after a default
 *     'interactive' registration no longer shows a stale full flow (was 7/16, now the reduced 7/7).
 *   v1.4.0 -- 2026-07-13 -- Routes extracted verbatim into sibling modules under ./agents/
 *     (device-auth, registration, profile-metadata, management, offers) to satisfy max-file-lines;
 *     registration order preserved. Pure mechanical split, no behavior change.
 */
import { Router } from 'express';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_agents = dirname(fileURLToPath(import.meta.url));
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { registerDeviceAuthRoutes } from './agents/device-auth.js';
import { registerRegistrationRoutes } from './agents/registration.js';
import { registerProfileMetadataRoutes } from './agents/profile-metadata.js';
import { registerManagementRoutes } from './agents/management.js';
import { registerOffersRoutes } from './agents/offers.js';

export function agentsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Route groups are registered IN ORDER (Express matches top-to-bottom); the original
  // declaration order is preserved across the extracted sibling modules under ./agents/.
  registerDeviceAuthRoutes(router, config, storage);
  registerRegistrationRoutes(router, config, storage, __dirname_agents);
  registerProfileMetadataRoutes(router, config, storage);
  registerManagementRoutes(router, config, storage);
  registerOffersRoutes(router, config, storage);

  return router;
}
