/**
 * @file src/routes/foundry/interview-settings.ts
 * @description Foundry interview-spec save/validate + project settings store/retrieve routes. Extracted from src/routes/foundry.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/foundry.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { validateInterviewSpec } from '../../services/foundry-validate.js';
import { emitChange } from '../../services/event-bus.js';

export function registerInterviewSettingsRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // POST /v1/foundry/:projectId/interview — save/update interview spec
  // Also fixes visibility: frontend previously wrote 'private', now writes 'owner' so agents can read it.
  router.post('/v1/foundry/:projectId/interview',
    requireAuth(),
    requireRole('agent'),
    requireScope('foundry:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { interviewSpec } = req.body ?? {};

      const projectRec = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const validation = validateInterviewSpec(JSON.stringify(interviewSpec));
      if (!validation.valid) {
        res.status(422).json(error(config.nodeId, 'VALIDATION_ERROR', 'Invalid interview spec', undefined, { errors: validation.errors }));
        return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({
        key: `foundry.${projectId}.interview-spec`,
        ownerGaii: gaii,
        value: interviewSpec,
        visibility: 'owner',
        version: 1,
        tags: ['foundry', 'interview'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { saved: true }));
      emitChange('memory');
    }
  );

  // POST /v1/foundry/:projectId/settings — store project settings values
  router.post('/v1/foundry/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);
      const { values } = req.body as {
        values: Record<string, string | number | boolean>;
        secretKeys?: string[];
      };

      if (!values || typeof values !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'values object required'));
        return;
      }

      // Verify project exists
      const projectRec = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Store values as-is (no encryption — settings are already protected by owner-scoped memory)
      const storedValues = { ...values };

      // Store using full MemoryRecord pattern
      const now = new Date().toISOString();
      const existing = await storage.getMemory(gaii, `foundry.${projectId}.settings`);
      await storage.setMemory({
        key: `foundry.${projectId}.settings`,
        ownerGaii: gaii,
        value: storedValues,
        visibility: 'owner',
        version: existing ? existing.version + 1 : 1,
        tags: ['foundry', 'settings'],
        ttlHours: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { stored: Object.keys(values).length }));
      emitChange('memory');
    }
  );

  // GET /v1/foundry/:projectId/settings — retrieve project settings values
  router.get('/v1/foundry/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);

      const rec = await storage.getMemory(gaii, `foundry.${projectId}.settings`);
      const values = (rec?.value as Record<string, unknown>) ?? {};

      res.json(success(config.nodeId, { values }));
    }
  );
}
