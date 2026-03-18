// @file src/routes/generator.ts
// @description Agent-driven service generator API. Thin validation layer over Memory API.
// Agents submit generated content here; the route validates it, then writes to
// generator.* memory keys using the same structure the frontend reads.
// @version-history v1.0.0 — 2026-03-18 — Initial implementation

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';

export function generatorRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // Routes will be added in Tasks 3-6

  return router;
}
