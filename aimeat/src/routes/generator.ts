/**
 * @file src/routes/generator.ts
 * @description Service generator API — a thin validation layer over the Memory API. Agents and the
 *   browser UI submit generated content (interview specs, blueprints, components) here; the route
 *   validates each, then writes to `generator.*` memory keys using the same structure the frontend reads.
 *
 * @structure
 *   generatorRouter() wires five sibling route groups in original registration order (order matters —
 *   Express matches top-to-bottom): generator/projects.ts (project lifecycle + debug viewer),
 *   generator/stages.ts (interview + settings), generator/testing.ts (test/probe/screenshots/test-page),
 *   generator/components.ts (blueprint/spec/submit/register/reset/log/complete), generator/prompts.ts
 *   (prompt building). All groups close over the shared `ownerGhii` resolver (owner GHII for the caller).
 *
 * @usage
 *   Consumed by AI agents via device auth (generator:read / generator:write / generator:execute
 *   scopes) and by the browser UI (owner JWT satisfies the agent role check).
 *
 * @version-history
 *   v1.0.0 — 2026-03-18 — Initial implementation
 *   v1.1.0 — 2026-03-18 — Add project management and interview endpoints (Task 3)
 *   v1.2.0 — 2026-03-18 — Add session claim, heartbeat, and release endpoints (Task 4)
 *   v1.3.0 — 2026-03-18 — Add blueprint, component submit, log, and complete endpoints (Task 5)
 *   v1.4.0 — 2026-03-18 — Add component registration endpoint (Task 6)
 *   v1.5.0 — 2026-03-18 — Fix session claim: use setMemory for new sessions (setMemoryIfVersion only for CAS on existing stale sessions)
 *   v1.6.0 — 2026-03-19 — Fix emitChange, session ownership, validation status codes, dead code removal, type checks
 *   v1.7.0 — 2026-03-19 — Add GET /v1/generator/my-assignments polling endpoint for agent discovery
 *   v1.8.0 — 2026-03-19 — Update agent guide to use polling instead of SSE for assignment discovery
 *   v1.9.0 — 2026-03-19 — Safety guards: version increment, blueprint immutability, registered component protection, session identity check
 *   v2.0.0 — 2026-03-19 — Add DELETE /v1/generator/:projectId cascade delete; validate componentId in heartbeat against blueprint
 *   v5.0.0 — 2026-03-20 — Remove agent guide, my-assignments, and session endpoints (replaced by OpenRouter autopilot)
 *   v5.1.0 — 2026-03-21 — Add settings collection endpoints (POST/GET /v1/generator/:projectId/settings)
 *   v5.2.0 — 2026-03-21 — Add test execution endpoint, screenshot serving, and screenshot cleanup on delete (Task 16)
 *   v5.3.0 — 2026-06-06 — prompts/:componentId now merges stored specs (generator.<project>.spec.<id>) onto completedComponents, matching the browser's loadAllComponents merge — so dependency specs reach the prompt from their canonical key, not just from the component record
 *   v5.4.0 — 2026-07-13 — Split into generator/ sibling modules (projects/stages/testing/components/prompts) to satisfy max-file-lines; pure extraction, registration order + behavior preserved.
 *   v5.5.0 — 2026-07-16 — Add GET /v1/generator/:projectId/state (dashboard mount composite, GeneratorStateService):
 *     one owner-scope prefix scan replaces the 8 memory reads the dashboard fired; live registries stay separate.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { registerProjectRoutes } from './generator/projects.js';
import { registerStageRoutes } from './generator/stages.js';
import { registerTestingRoutes } from './generator/testing.js';
import { registerComponentRoutes } from './generator/components.js';
import { registerPromptRoutes } from './generator/prompts.js';

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Generator data is always stored under the owner's GHII (created by browser/owner session).
  // Agents need to read/write using the owner's GHII, not their own GAII.
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // Registration order matters (Express matches top-to-bottom). Preserve the original order:
  // projects (incl. static /projects + /debug before :projectId), stages, testing (test-page +
  // screenshots before component routes), components, then prompts.
  registerProjectRoutes(router, config, storage, ownerGhii);
  registerStageRoutes(router, config, storage, ownerGhii);
  registerTestingRoutes(router, config, storage, ownerGhii);
  registerComponentRoutes(router, config, storage, ownerGhii);
  registerPromptRoutes(router, config, storage, ownerGhii);

  return router;
}
