// @file src/routes/generator.ts
// @description Agent-driven service generator API. Thin validation layer over Memory API.
// Agents submit generated content here; the route validates it, then writes to
// generator.* memory keys using the same structure the frontend reads.
// @structure
//   POST /v1/generator/projects                        — create a new generator project
//   GET  /v1/generator/projects                        — list all projects for the caller
//   GET  /v1/generator/:projectId                      — get full project state (project, interviewSpec, components, session)
//   POST /v1/generator/:projectId/interview            — save/update interview spec for a project
//   POST /v1/generator/:projectId/session/claim        — agent claims an execution session
//   POST /v1/generator/:projectId/session/heartbeat    — agent keeps session alive / updates progress
//   DELETE /v1/generator/:projectId/session            — release session (user stop or agent done)
// @usage
//   Consumed by AI agents via device auth (generator:read / generator:write / generator:execute scopes)
//   and by the browser UI (owner JWT satisfies agent role check).
// @version-history
//   v1.0.0 — 2026-03-18 — Initial implementation
//   v1.1.0 — 2026-03-18 — Add project management and interview endpoints (Task 3)
//   v1.2.0 — 2026-03-18 — Add session claim, heartbeat, and release endpoints (Task 4)

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { validateInterviewSpec } from '../services/generator-validate.js';

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // POST /v1/generator/projects — create a new generator project
  router.post('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = resolve(req);
      const { name, description } = req.body ?? {};

      if (!name || typeof name !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'name is required'));
        return;
      }

      const projectId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const project = {
        id: projectId,
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
    }
  );

  // GET /v1/generator/projects — list all projects for the caller
  // NOTE: This static route MUST be registered before GET /v1/generator/:projectId
  router.get('/v1/generator/projects',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = resolve(req);
      const records = await storage.listMemory(gaii, { prefix: 'generator.', visibility: 'owner' });
      const projects = records
        .filter(r => r.key.endsWith('.project'))
        .map(r => r.value);

      res.json(success(config.nodeId, { projects }));
    }
  );

  // GET /v1/generator/:projectId — get full project state
  router.get('/v1/generator/:projectId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = resolve(req);
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

  // POST /v1/generator/:projectId/interview — save/update interview spec
  // Also fixes visibility: frontend previously wrote 'private', now writes 'owner' so agents can read it.
  router.post('/v1/generator/:projectId/interview',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = resolve(req);
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

      res.json(success(config.nodeId, { saved: true }));
    }
  );

  // POST /v1/generator/:projectId/session/claim — agent claims an execution session
  // NOTE: registered before the generic /:projectId handler to ensure correct routing
  router.post('/v1/generator/:projectId/session/claim',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      const { agentGaii, agentName } = req.body ?? {};

      if (!agentGaii || !agentName) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'agentGaii and agentName are required'));
        return;
      }

      // Verify authenticated caller has generator capability
      const agentRecord = await storage.getAgent(gaii);
      if (!agentRecord || !agentRecord.capabilities.includes('generator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agent does not have generator capability'));
        return;
      }

      // Check for existing fresh session
      const existing = await storage.getMemory(gaii, `generator.${projectId}.session`);
      if (existing) {
        const session = existing.value as { heartbeat: string };
        const age = Date.now() - new Date(session.heartbeat).getTime();
        if (age < SESSION_TTL_MS) {
          res.status(409).json(error(config.nodeId, 'SESSION_BUSY', 'Another agent holds an active session for this project'));
          return;
        }
      }

      const now = new Date().toISOString();
      const sessionData = {
        agentGaii,
        agentName,
        phase: 'starting',
        componentId: null,
        stepNumber: 0,
        totalSteps: 0,
        startedAt: now,
        heartbeat: now,
      };

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const sessionRecord = {
        key: `generator.${projectId}.session`,
        ownerGaii: gaii,
        value: sessionData,
        visibility: 'owner' as const,
        tags: ['generator', 'session'],
        ttlHours: null,
      };

      if (storage.setMemoryIfVersion) {
        const expectedVersion = existing ? existing.version : 0;
        const newVersion = existing ? existing.version + 1 : 1;
        const result = await storage.setMemoryIfVersion(
          { ...sessionRecord, version: newVersion, createdAt: existing?.createdAt ?? now, updatedAt: now },
          expectedVersion,
        );
        if (!result) {
          res.status(409).json(error(config.nodeId, 'SESSION_BUSY', 'Session was claimed by another agent'));
          return;
        }
      } else {
        await storage.setMemory({ ...sessionRecord, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now });
      }

      res.json(success(config.nodeId, { claimed: true, expiresAt }));
    }
  );

  // POST /v1/generator/:projectId/session/heartbeat — agent keeps session alive and updates progress
  router.post('/v1/generator/:projectId/session/heartbeat',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;

      const existing = await storage.getMemory(gaii, `generator.${projectId}.session`);
      if (!existing) {
        res.status(404).json(error(config.nodeId, 'SESSION_RELEASED', 'Session no longer exists — agent should halt'));
        return;
      }

      const now = new Date().toISOString();
      const updated: Record<string, unknown> = { ...(existing.value as Record<string, unknown>), heartbeat: now };

      // Allow agent to update progress fields via heartbeat body
      const { phase, componentId, stepNumber, totalSteps } = req.body ?? {};
      if (phase !== undefined) updated['phase'] = phase;
      if (componentId !== undefined) updated['componentId'] = componentId;
      if (stepNumber !== undefined) updated['stepNumber'] = stepNumber;
      if (totalSteps !== undefined) updated['totalSteps'] = totalSteps;

      await storage.setMemory({ ...existing, value: updated, updatedAt: now });

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      res.json(success(config.nodeId, { ok: true, expiresAt }));
    }
  );

  // DELETE /v1/generator/:projectId/session — release session (UI stop button or agent done)
  router.delete('/v1/generator/:projectId/session',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      await storage.deleteMemory(gaii, `generator.${projectId}.session`);
      res.json(success(config.nodeId, { released: true }));
    }
  );

  return router;
}
