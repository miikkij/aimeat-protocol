/**
 * @file generator-autopilot.ts
 * @description REST endpoints for the server-side generator autopilot.
 *   Start, poll status, and cancel the background pipeline.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial backend autopilot endpoints
 *   v1.1.0 — 2026-06-06 — start accepts { testScope } from the "Testauslaajuus" selector and forwards it to runAutopilot (scope 'none' skips the test phase)
 */

import { Router, type Request, type Response } from 'express';
import { type AimeatConfig } from '../config.js';
import { type Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { runAutopilot, getAutopilotStatus, cancelAutopilot, isAutopilotRunning } from '../services/generator-autopilot.js';
import { logger } from '../utils/logger.js';

export function generatorAutopilotRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

  // POST /v1/generator/:projectId/autopilot/start — start the background autopilot
  router.post('/v1/generator/:projectId/autopilot/start',
    requireAuth(),
    requireRole('owner'),
    async (req: Request, res: Response) => {
      const projectId = req.params['projectId'] as string;
      const ownerGhii = resolve(req);
      const ownerName = req.auth!.owner;
      const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
      // Test scope from the "Testauslaajuus" selector — 'none' tells the autopilot to skip the test
      // phase entirely (spec + code + register still run for every component). Defaults to
      // 'comprehensive' for older clients that don't send it.
      const rawScope = (req.body as { testScope?: unknown } | undefined)?.testScope;
      const testScope: 'comprehensive' | 'basic' | 'none' =
        rawScope === 'none' || rawScope === 'basic' ? rawScope : 'comprehensive';

      if (isAutopilotRunning(projectId)) {
        res.status(409).json(error(config.nodeId, 'ALREADY_RUNNING', 'Autopilot is already running for this project'));
        return;
      }

      // Verify project exists
      const projectRec = await storage.getMemory(ownerGhii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Start autopilot in background — don't await, return immediately
      runAutopilot(projectId, ownerGhii, ownerName, jwt, config, storage, testScope)
        .catch(err => {
          logger.error(`Autopilot crashed for ${projectId}: ${err.message}`);
        });

      res.json(success(config.nodeId, { started: true, projectId, testScope }));
    }
  );

  // GET /v1/generator/:projectId/autopilot/status — poll current autopilot status
  router.get('/v1/generator/:projectId/autopilot/status',
    requireAuth(),
    requireRole('owner'),
    async (req: Request, res: Response) => {
      const projectId = req.params['projectId'] as string;
      const ownerGhii = resolve(req);

      // Check in-memory first (running autopilot)
      const inMemory = getAutopilotStatus(projectId);
      if (inMemory) {
        res.json(success(config.nodeId, inMemory));
        return;
      }

      // Check persisted status (completed/failed autopilot)
      const statusRec = await storage.getMemory(ownerGhii, `generator.${projectId}.autopilot-status`);
      if (statusRec?.value) {
        res.json(success(config.nodeId, statusRec.value));
        return;
      }

      res.json(success(config.nodeId, { status: 'idle' }));
    }
  );

  // POST /v1/generator/:projectId/autopilot/cancel — cancel running autopilot
  router.post('/v1/generator/:projectId/autopilot/cancel',
    requireAuth(),
    requireRole('owner'),
    async (req: Request, res: Response) => {
      const projectId = req.params['projectId'] as string;

      const cancelled = cancelAutopilot(projectId);
      if (cancelled) {
        res.json(success(config.nodeId, { cancelled: true }));
      } else {
        res.status(404).json(error(config.nodeId, 'NOT_RUNNING', 'No running autopilot for this project'));
      }
    }
  );

  return router;
}
