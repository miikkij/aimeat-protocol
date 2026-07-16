/**
 * @file src/routes/generator/projects.ts
 * @description Generator project lifecycle + debug-file viewer routes — create/list/get/delete
 *   projects and the owner-only debug file API. Extracted from src/routes/generator.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { cleanupScreenshots } from '../../services/generator-testing.js';
import { createGeneratorStateService } from '../../services/db/generator-state-db-service.js';

export function registerProjectRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  ownerGhii: (req: Express.Request) => string,
): void {
  const generatorStateDb = createGeneratorStateService(storage);
  // POST /v1/generator/projects — create a new generator project
  router.post('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const { name, description } = req.body ?? {};

      if (!name || typeof name !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'name is required'));
        return;
      }

      const projectId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const project = {
        projectId,
        name: name.trim(),
        description: (description ?? '').trim(),
        status: 'draft',
        blueprint: null,
        createdAt: now,
        updatedAt: now,
      };

      await storage.setMemory({
        key: `generator.${projectId}.project`,
        ownerGaii: gaii,
        value: project,
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'project'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, { projectId, project }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/projects — list all projects for the caller
  // NOTE: This static route MUST be registered before GET /v1/generator/:projectId
  router.get('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const records = await storage.listMemory(gaii, { prefix: 'generator.', visibility: 'owner' });
      const projects = records
        .filter(r => r.key.endsWith('.project'))
        .map(r => r.value);

      res.json(success(config.nodeId, { projects }));
    }
  );

  // ── Debug file viewer API (MUST be before :projectId routes) ─────────

  router.get('/v1/generator/debug/projects',
    requireAuth(), requireRole('owner'),
    async (_req, res) => {
      const { listDebugProjects } = await import('../../services/generator-debug.js');
      res.json(success(config.nodeId, { projects: await listDebugProjects() }));
    }
  );

  router.get('/v1/generator/debug/:projectId/files',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { listDebugFiles } = await import('../../services/generator-debug.js');
      res.json(success(config.nodeId, { projectId: req.params['projectId'] as string, files: await listDebugFiles(req.params['projectId'] as string) }));
    }
  );

  router.get('/v1/generator/debug/:projectId/file',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { readDebugFile } = await import('../../services/generator-debug.js');
      const filePath = (req.query['path'] as string) || '';
      if (!filePath) { res.status(400).json(error(config.nodeId, 'INVALID_QUERY', 'path query parameter is required')); return; }
      const content = await readDebugFile(req.params['projectId'] as string, filePath);
      if (content === null) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found')); return; }
      res.json(success(config.nodeId, { projectId: req.params['projectId'] as string, path: filePath, content }));
    }
  );

  router.delete('/v1/generator/debug/:projectId',
    requireAuth(), requireRole('owner'),
    async (req, res) => {
      const { deleteDebugProject } = await import('../../services/generator-debug.js');
      res.json(success(config.nodeId, { deleted: await deleteDebugProject(req.params['projectId'] as string), projectId: req.params['projectId'] as string }));
    }
  );

  // GET /v1/generator/:projectId — get full project state
  // GET /v1/generator/:projectId/state — the dashboard mount composite. Folds the EIGHT owner-scope memory
  // scans the dashboard fired (project + interview-spec + component.* + spec.* + pending-edit, twice over
  // for the status recompute + a cleanup scan) into ONE prefix scan, partitioned. The live-registry reads
  // (extensions/cortex/apps) the status check needs stay separate (different subsystem). Raw records are
  // returned so the dashboard's existing parse/merge logic is unchanged. 2-segment path — registered before
  // /:projectId (which matches one segment), no shadow.
  router.get('/v1/generator/:projectId/state',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const data = await generatorStateDb.state(req.auth!.owner as string, gaii, projectId);
      if (!data) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }
      res.json(success(config.nodeId, data));
    }
  );

  router.get('/v1/generator/:projectId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const [projectRec, interviewRec, sessionRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
        storage.getMemory(gaii, `generator.${projectId}.session`),
      ]);

      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const componentRecords = await storage.listMemory(gaii, {
        prefix: `generator.${projectId}.component.`,
      });
      const components = componentRecords.map(r => r.value);

      res.json(success(config.nodeId, {
        project: projectRec.value,
        interviewSpec: interviewRec?.value ?? null,
        components,
        session: sessionRec?.value ?? null,
      }));
    }
  );

  // DELETE /v1/generator/:projectId — delete project and all associated data (cascade)
  router.delete('/v1/generator/:projectId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Cascade delete all project data
      const allRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.` });
      for (const rec of allRecords) {
        await storage.deleteMemory(gaii, rec.key);
      }

      // Clean up test screenshots from filesystem
      await cleanupScreenshots(projectId);

      res.json(success(config.nodeId, { deleted: true, keysRemoved: allRecords.length }));
      emitChange('memory');
    }
  );
}
