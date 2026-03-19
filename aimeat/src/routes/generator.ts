// @file src/routes/generator.ts
// @description Agent-driven service generator API. Thin validation layer over Memory API.
// Agents submit generated content here; the route validates it, then writes to
// generator.* memory keys using the same structure the frontend reads.
// @structure
//   POST /v1/generator/projects                                           — create a new generator project
//   GET  /v1/generator/projects                                           — list all projects for the caller
//   GET  /v1/generator/:projectId                                         — get full project state (project, interviewSpec, components, session)
//   POST /v1/generator/:projectId/interview                               — save/update interview spec for a project
//   POST /v1/generator/:projectId/session/claim                           — agent claims an execution session
//   POST /v1/generator/:projectId/session/heartbeat                       — agent keeps session alive / updates progress
//   DELETE /v1/generator/:projectId/session                               — release session (user stop or agent done)
//   POST /v1/generator/:projectId/steps/blueprint                         — validate + store blueprint
//   POST /v1/generator/:projectId/components/:componentId/submit          — validate + store component content
//   POST /v1/generator/:projectId/components/:componentId/register        — register a validated component into the AIMEAT catalogue
//   POST /v1/generator/:projectId/log                                     — write log entry to memory
//   POST /v1/generator/:projectId/complete                                — mark project active, release session
// @usage
//   Consumed by AI agents via device auth (generator:read / generator:write / generator:execute scopes)
//   and by the browser UI (owner JWT satisfies agent role check).
// @version-history
//   v1.0.0 — 2026-03-18 — Initial implementation
//   v1.1.0 — 2026-03-18 — Add project management and interview endpoints (Task 3)
//   v1.2.0 — 2026-03-18 — Add session claim, heartbeat, and release endpoints (Task 4)
//   v1.3.0 — 2026-03-18 — Add blueprint, component submit, log, and complete endpoints (Task 5)
//   v1.4.0 — 2026-03-18 — Add component registration endpoint (Task 6)
//   v1.5.0 — 2026-03-18 — Fix session claim: use setMemory for new sessions (setMemoryIfVersion only for CAS on existing stale sessions)

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { validateInterviewSpec, validateBlueprint, validateComponent } from '../services/generator-validate.js';
import type { ComponentType } from '../services/generator-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

  // GET /v1/generator/agent-guide — generic generator agent instructions (no auth, plain text)
  // Agents fetch this URL to learn the session-based pipeline flow.
  router.get('/v1/generator/agent-guide', (_req, res) => {
    const baseUrl = config.baseUrl || `${_req.protocol}://${_req.get('host')}`;
    res.type('text/plain').send(`# AIMEAT Generator Agent — Full Instructions

## Your Role

You are an AIMEAT Generator Agent. You listen for session assignments via SSE, then autonomously execute the full service generation pipeline — blueprint, components, registration.

## AIMEAT API Conventions

All responses follow this envelope: { "ok": true, "data": { ... }, "hints": [...] }
Error responses: { "ok": false, "error": { "code": "...", "message": "..." } }
Memory keys use dots as separators (e.g. generator.project123.session). Allowed: a-z0-9._-

## Authentication

1. Concatenate: {your GAII}{ISO 8601 timestamp} — no separator
2. Sign with your Ed25519 private key (raw bytes, not hashed first)
3. Base64-encode the 64-byte signature
4. POST ${baseUrl}/v1/auth/token with { "gaii": "...", "timestamp": "...", "signature": "..." }
5. Use the returned JWT as: Authorization: Bearer {token}

Token expires after 24h. Re-authenticate when you get HTTP 401.

## Discovering Session Assignments (SSE)

### Get an SSE ticket
POST ${baseUrl}/v1/events/ticket
Authorization: Bearer {token}

### Connect to the SSE stream
GET ${baseUrl}/v1/events?ticket={ticket}

Listen for events where domain === "memory". On each event, check for assigned sessions.

### Check for your assignment
GET ${baseUrl}/v1/generator/projects
Authorization: Bearer {token}

Scan projects. Use GET ${baseUrl}/v1/generator/{projectId} to load full state.
If the session object has your GAII in agentGaii, you have been assigned.

## Generator Pipeline

Once assigned to a project, execute these steps:

### 1. Start heartbeat loop (CRITICAL)

Call every 60 seconds. If you stop for 5 minutes, the UI shows "Agent disconnected" and the owner can reassign.

POST ${baseUrl}/v1/generator/{projectId}/session/heartbeat
Authorization: Bearer {token}
Content-Type: application/json

{ "phase": "blueprint", "stepNumber": 1, "totalSteps": 7 }

If heartbeat returns 404 SESSION_RELEASED → stop immediately (owner clicked Stop).

### 2. Generate and submit the blueprint

Read the interviewSpec from the project state. Generate a blueprint listing all components to create.

POST ${baseUrl}/v1/generator/{projectId}/steps/blueprint
Authorization: Bearer {token}
Content-Type: application/json

{ "blueprint": "<your generated blueprint>" }

Backend validates. If errors, fix and resubmit (max 3 attempts).

### 3. Generate each component

For each component in the blueprint:

POST ${baseUrl}/v1/generator/{projectId}/components/{componentId}/submit
Authorization: Bearer {token}
Content-Type: application/json

{ "type": "csm|msm|extension|app|memory|translation|cortex", "content": "<generated content>" }

Update heartbeat after each: { "phase": "generating", "componentId": "...", "stepNumber": N, "totalSteps": M }

### 4. Register components

POST ${baseUrl}/v1/generator/{projectId}/components/{componentId}/register
Authorization: Bearer {token}

### 5. Write logs for real-time UI updates

POST ${baseUrl}/v1/generator/{projectId}/log
Authorization: Bearer {token}
Content-Type: application/json

{ "level": "info|warn|error", "message": "...", "componentId": "..." }

### 6. Mark project complete

POST ${baseUrl}/v1/generator/{projectId}/complete
Authorization: Bearer {token}

### 7. Checkin (keep listener status alive)

POST ${baseUrl}/v1/checkin
Authorization: Bearer {token}

Call periodically so the UI shows you as an active listener.

## Error Handling

- 404 on heartbeat: Owner stopped session — halt immediately
- 409 SESSION_BUSY: Another agent holds the session — do not proceed
- 400 validation error: Read error details, fix, resubmit (max 3 retries)
- Network error: Retry with exponential backoff (1s, 2s, 4s)
- 401: Re-authenticate and retry

## SSE Reconnection

If SSE disconnects: re-auth if needed → new ticket → reconnect → scan for pending assignments.
`);
  });

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

      // Verify claimed agent exists and has generator capability
      const claimedAgent = await storage.getAgent(agentGaii);
      if (!claimedAgent) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${agentGaii}`));
        return;
      }
      if (!claimedAgent.capabilities.includes('generator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agent does not have generator capability'));
        return;
      }

      // Verify caller has generator capability (skip for owner sessions — they bypass scopes)
      const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
      if (!isOwnerSession) {
        const agentRecord = await storage.getAgent(gaii);
        if (!agentRecord || !agentRecord.capabilities.includes('generator')) {
          res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agent does not have generator capability'));
          return;
        }
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

      if (existing && storage.setMemoryIfVersion) {
        // Stale session exists — use atomic CAS to prevent two agents claiming simultaneously
        const result = await storage.setMemoryIfVersion(
          { ...sessionRecord, version: existing.version + 1, createdAt: existing.createdAt, updatedAt: now },
          existing.version,
        );
        if (!result) {
          res.status(409).json(error(config.nodeId, 'SESSION_BUSY', 'Session was claimed by another agent'));
          return;
        }
      } else {
        // No prior session — simple write (version 1, new record)
        await storage.setMemory({ ...sessionRecord, version: 1, createdAt: now, updatedAt: now });
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

  // POST /v1/generator/:projectId/steps/blueprint — validate + store blueprint
  // NOTE: registered before /:projectId/components/:componentId/submit to prevent 'steps' matching as componentId
  router.post('/v1/generator/:projectId/steps/blueprint',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      const { blueprint } = req.body ?? {};

      if (!blueprint || typeof blueprint !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'blueprint string is required'));
        return;
      }

      const validation = validateBlueprint(blueprint);
      if (!validation.valid) {
        // Return validation errors to agent — do NOT write to memory
        res.json(success(config.nodeId, { valid: false, errors: validation.errors, warnings: validation.warnings }));
        return;
      }

      // Update the project's blueprint field in memory
      const now = new Date().toISOString();
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const updated = {
        ...(projectRec.value as Record<string, unknown>),
        blueprint: validation.extracted ?? blueprint,
        status: 'blueprint_ready',
        updatedAt: now,
      };
      await storage.setMemory({ ...projectRec, value: updated, updatedAt: now });

      res.json(success(config.nodeId, { valid: true, errors: [], warnings: validation.warnings ?? [] }));
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/submit — validate + store component content
  router.post('/v1/generator/:projectId/components/:componentId/submit',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { type, content } = req.body ?? {};

      if (!type || !VALID_COMPONENT_TYPES.includes(type as ComponentType)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', `type must be one of: ${VALID_COMPONENT_TYPES.join(', ')}`));
        return;
      }
      if (!content || typeof content !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'content string is required'));
        return;
      }

      const validation = validateComponent(type as ComponentType, content);

      if (!validation.valid) {
        // Return errors for agent to correct — do NOT write to memory
        res.json(success(config.nodeId, {
          valid: false,
          errors: validation.errors,
          warnings: validation.warnings ?? [],
          extracted: validation.extracted,
        }));
        return;
      }

      // Write validated component to memory
      const now = new Date().toISOString();
      const existingRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      const newVersion = existingRec ? existingRec.version + 1 : 1;

      const extractedContent = typeof validation.extracted === 'string'
        ? validation.extracted
        : JSON.stringify(validation.extracted);

      await storage.setMemory({
        key: `generator.${projectId}.component.${componentId}`,
        ownerGaii: gaii,
        value: { type, content: extractedContent, status: 'ready', submittedAt: now },
        visibility: 'owner',
        version: newVersion,
        tags: ['generator', 'component', type as string],
        ttlHours: null,
        createdAt: existingRec?.createdAt ?? now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, {
        valid: true,
        errors: [],
        warnings: validation.warnings ?? [],
        extracted: validation.extracted,
      }));
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/register — register a validated component into the AIMEAT catalogue
  router.post('/v1/generator/:projectId/components/:componentId/register',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      const componentRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      if (!componentRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Component not found — submit content first'));
        return;
      }

      const component = componentRec.value as { type: ComponentType; content: string; status: string };
      if (component.status !== 'ready') {
        res.status(400).json(error(config.nodeId, 'NOT_READY', 'Component must be in "ready" status before registration'));
        return;
      }

      const agentRecord = await storage.getAgent(gaii);
      if (!agentRecord) {
        res.status(403).json(error(config.nodeId, 'AUTH_ERROR', 'Agent record not found'));
        return;
      }
      const ownerName = agentRecord.owner;
      const ownerGhii = `${ownerName}@${config.nodeId}`;

      try {
        switch (component.type) {
          case 'csm': await registerCsm(component.content, ownerName, storage); break;
          case 'msm': await registerMsm(component.content, ownerName, storage); break;
          case 'extension': await registerExtension(component.content, ownerName, ownerGhii, storage, config.maxExtensionsPerOwner); break;
          case 'app': await registerApp(component.content, ownerName, gaii, storage); break;
          case 'memory':
          case 'translation':
          case 'cortex':
            // No catalogue registration needed — stored in generator memory keys only
            break;
          default:
            res.status(400).json(error(config.nodeId, 'UNSUPPORTED_TYPE', `Registration not supported for type: ${component.type as string}`));
            return;
        }

        const now = new Date().toISOString();
        await storage.setMemory({
          ...componentRec,
          value: { ...component, status: 'registered', registeredAt: now },
          updatedAt: now,
        });
        res.json(success(config.nodeId, { registered: true, componentId }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json(error(config.nodeId, 'REGISTRATION_ERROR', msg));
      }
    }
  );

  // POST /v1/generator/:projectId/log — write log entry to memory
  router.post('/v1/generator/:projectId/log',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;
      const { taskId, level, message, meta } = req.body ?? {};

      if (!taskId || typeof taskId !== 'string' || !level || typeof level !== 'string' || !message || typeof message !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'taskId, level, and message must be strings'));
        return;
      }
      if (!['info', 'warn', 'error'].includes(level as string)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level must be info, warn, or error'));
        return;
      }

      const now = new Date().toISOString();
      // Log entries are keyed by taskId — last-write-wins for a given task step (intentional)
      await storage.setMemory({
        key: `generator.${projectId}.logs.${taskId as string}`,
        ownerGaii: gaii,
        value: { taskId, level, message, meta: meta ?? null, timestamp: now },
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'log'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { ok: true }));
    }
  );

  // POST /v1/generator/:projectId/complete — mark project active, release session
  router.post('/v1/generator/:projectId/complete',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = resolve(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({
        ...projectRec,
        value: {
          ...(projectRec.value as Record<string, unknown>),
          status: 'active',
          completedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      });

      // Release session if it exists
      await storage.deleteMemory(gaii, `generator.${projectId}.session`);

      res.json(success(config.nodeId, { status: 'active' }));
    }
  );

  return router;
}
