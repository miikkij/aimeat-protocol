/**
 * @file src/routes/generator/stages.ts
 * @description Generator interview-spec + project-settings routes — validate/store the interview
 *   spec and store/retrieve project settings values. Extracted from src/routes/generator.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { validateInterviewSpec, validateSpecQuality } from '../../services/generator-validate.js';

export function registerStageRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  ownerGhii: (req: Express.Request) => string,
): void {
  // POST /v1/generator/:projectId/interview — save/update interview spec
  // Also fixes visibility: frontend previously wrote 'private', now writes 'owner' so agents can read it.
  router.post('/v1/generator/:projectId/interview',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { interviewSpec } = req.body ?? {};

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const validation = validateInterviewSpec(JSON.stringify(interviewSpec));
      if (!validation.valid) {
        res.status(422).json(error(config.nodeId, 'VALIDATION_ERROR', 'Invalid interview spec', undefined, { errors: validation.errors }));
        return;
      }

      // Spec-quality gate (parity with the UI): block on hard errors (e.g. an unverified data
      // source with no fallback); warnings are advisory and returned to the caller.
      const quality = validateSpecQuality(interviewSpec);
      if (!quality.valid) {
        res.status(422).json(error(config.nodeId, 'SPEC_QUALITY_FAILED', quality.errors.join('; '), undefined, { errors: quality.errors, warnings: quality.warnings }));
        return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({
        key: `generator.${projectId}.interview-spec`,
        ownerGaii: gaii,
        value: interviewSpec,
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'interview'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { saved: true, warnings: quality.warnings }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/settings — store project settings values
  router.post('/v1/generator/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);
      const { values } = req.body as {
        values: Record<string, string | number | boolean>;
      };

      if (!values || typeof values !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'values object required'));
        return;
      }

      // Verify project exists
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Store values as-is (no encryption — settings are already protected by owner-scoped memory)
      const storedValues = { ...values };

      // Store using full MemoryRecord pattern
      const now = new Date().toISOString();
      const existing = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      await storage.setMemory({
        key: `generator.${projectId}.settings`,
        ownerGaii: gaii,
        value: storedValues,
        visibility: 'owner',
        version: existing ? existing.version + 1 : 1,
        tags: ['generator', 'settings'],
        ttlHours: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { stored: Object.keys(values).length }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/:projectId/settings — retrieve project settings values
  router.get('/v1/generator/:projectId/settings',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);

      const rec = await storage.getMemory(gaii, `generator.${projectId}.settings`);
      const values = (rec?.value as Record<string, unknown>) ?? {};

      res.json(success(config.nodeId, { values }));
    }
  );
}
