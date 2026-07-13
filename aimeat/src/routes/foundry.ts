/**
 * @file src/routes/foundry.ts
 * @description Service foundry API — a thin validation layer over the Memory API. Agents and the
 *   browser UI submit generated project content (interview spec, blueprint, components); the route
 *   validates it and persists to owner-scoped foundry.* memory keys the frontend reads back.
 *
 * @structure
 *   Route groups are registered IN ORDER (Express matches top-to-bottom) from ./foundry/*:
 *   - registerProjectRoutes: project lifecycle + debug viewer + full-state read (cascade delete)
 *   - registerInterviewSettingsRoutes: interview spec + settings store/retrieve
 *   - registerTestingRoutes: per-component test runner, debug artifacts, apply-settings, probe,
 *     bulk-test stub, screenshot serving, browser test page
 *   - registerComponentRoutes: blueprint, component submit/register, log, complete, prompts
 *
 * @usage
 *   Consumed by AI agents via device auth (foundry:read/write/execute scopes) and by the browser UI
 *   (owner JWT satisfies the agent role check).
 *
 * @version-history
 *   v1.0.0 — 2026-03-26 — Copied from generator.ts (v5.2.0) and renamed to foundry
 *   v1.1.0 — 2026-07-13 — Converted line-comment header to standard JSDoc block header
 *   v2.0.0 — 2026-07-13 — Split handlers into ./foundry/* modules (max-file-lines); order preserved
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { registerProjectRoutes } from './foundry/projects.js';
import { registerInterviewSettingsRoutes } from './foundry/interview-settings.js';
import { registerTestingRoutes } from './foundry/testing.js';
import { registerComponentRoutes } from './foundry/components.js';

export function foundryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Registration ORDER is load-bearing — Express matches routes top-to-bottom, and several
  // static/segment routes must precede their `:projectId`/`:componentId` counterparts.
  registerProjectRoutes(router, config, storage);
  registerInterviewSettingsRoutes(router, config, storage);
  registerTestingRoutes(router, config, storage);
  registerComponentRoutes(router, config, storage);

  return router;
}
