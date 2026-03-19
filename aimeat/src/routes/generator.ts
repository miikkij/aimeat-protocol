// @file src/routes/generator.ts
// @description Agent-driven service generator API. Thin validation layer over Memory API.
// Agents submit generated content here; the route validates it, then writes to
// generator.* memory keys using the same structure the frontend reads.
// @structure
//   POST /v1/generator/projects                                           — create a new generator project
//   GET  /v1/generator/projects                                           — list all projects for the caller
//   GET  /v1/generator/my-assignments                                     — poll for projects assigned to this agent (replaces SSE discovery)
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
//   v1.6.0 — 2026-03-19 — Fix emitChange, session ownership, validation status codes, dead code removal, type checks
//   v1.7.0 — 2026-03-19 — Add GET /v1/generator/my-assignments polling endpoint for agent discovery
//   v1.8.0 — 2026-03-19 — Update agent guide to use polling instead of SSE for assignment discovery
//   v1.9.0 — 2026-03-19 — Safety guards: version increment, blueprint immutability, registered component protection, session identity check
//   v1.7.0 — 2026-03-19 — Add polling endpoint, safety guards, update agent guide to polling

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { validateInterviewSpec, validateBlueprint, validateComponent } from '../services/generator-validate.js';
import type { ComponentType } from '../services/generator-validate.js';
import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';
import { emitChange } from '../services/event-bus.js';
// @ts-ignore — frontend ESM module, no .d.ts
import { buildComponentPrompt, buildBlueprintPrompt } from '../../public/js/services/generator-prompts.js';

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

  // Generator data is always stored under the owner's GHII (created by browser/owner session).
  // Agents need to read/write using the owner's GHII, not their own GAII.
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // GET /v1/generator/agent-guide — generic generator agent instructions (no auth, plain text)
  // Agents fetch this URL to learn the session-based pipeline flow.
  router.get('/v1/generator/agent-guide', (_req, res) => {
    const baseUrl = config.baseUrl || `${_req.protocol}://${_req.get('host')}`;
    res.type('text/plain').send(`# AIMEAT Generator Agent — Full Instructions

## Your Role

You are an AIMEAT Generator Agent. You poll for session assignments every 10-15 seconds, then autonomously execute the full service generation pipeline — blueprint, components, registration.

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

## Discovering Session Assignments (Polling)

Poll this endpoint every 10-15 seconds to check if the owner has assigned you to a project:

GET ${baseUrl}/v1/generator/my-assignments
Authorization: Bearer {token}

Response when assigned:
{
  "ok": true,
  "data": {
    "assignments": [
      { "projectId": "gen-xxx", "session": { "agentGaii": "your-gaii", "phase": "starting", ... } }
    ]
  }
}

Response when no assignment:
{ "ok": true, "data": { "assignments": [] } }

When assignments is non-empty, start the pipeline for the first assignment immediately.
Do NOT call /session/claim — the owner already claimed the session for you from the UI.

## Generator Pipeline

Once you find a project where session.agentGaii matches your GAII, execute these steps:

### 1. Start heartbeat loop (CRITICAL)

Call every 60 seconds. If you stop for 5 minutes, the UI shows "Agent disconnected" and the owner can reassign.

POST ${baseUrl}/v1/generator/{projectId}/session/heartbeat
Authorization: Bearer {token}
Content-Type: application/json

{ "phase": "blueprint", "stepNumber": 1, "totalSteps": 7 }

If heartbeat returns 404 SESSION_RELEASED → stop immediately (owner clicked Stop).

### 2. Generate and submit the blueprint

FIRST, fetch the blueprint generation prompt:

GET ${baseUrl}/v1/generator/{projectId}/prompts
Authorization: Bearer {token}

Response: { "data": { "prompt": "...full blueprint generation instructions..." } }

Use that prompt to generate a blueprint as JSON with this EXACT structure:

{
  "components": [
    { "id": "csm-main", "type": "csm", "label": "Main Service Manifest", "produces": ["service-config"], "consumes": [] },
    { "id": "msm-main", "type": "msm", "label": "Main Service Module", "produces": ["api-endpoints"], "consumes": ["service-config"] },
    { "id": "ext-data", "type": "extension", "label": "Data Fetcher", "produces": ["raw-data"], "consumes": [], "schedules": [{ "action": "fetch", "cron": "*/15 * * * *" }] },
    { "id": "app-dashboard", "type": "app", "label": "Dashboard App", "consumes": ["raw-data"] },
    { "id": "mem-config", "type": "memory", "label": "Default Configuration" },
    { "id": "tr-fi", "type": "translation", "label": "Finnish Translations" },
    { "id": "cortex-lib", "type": "cortex", "label": "Shared Utilities", "uses": ["charts"] }
  ],
  "phases": [
    { "id": "phase-1", "label": "Core Service", "componentIds": ["csm-main", "msm-main", "mem-config"] },
    { "id": "phase-2", "label": "Data & UI", "componentIds": ["ext-data", "app-dashboard", "tr-fi"] },
    { "id": "phase-3", "label": "Libraries", "componentIds": ["cortex-lib"] }
  ]
}

REQUIRED fields per component: id, type, label
OPTIONAL fields: produces (array), consumes (array), schedules (for extensions), uses (for cortex)
Valid types: csm, msm, extension, app, memory, translation, cortex

REQUIRED top-level: components (array), phases (array)
Each phase: id, label, componentIds (array of component ids)

Submit the blueprint. Stringify the JSON object before sending:
POST ${baseUrl}/v1/generator/{projectId}/steps/blueprint
Authorization: Bearer {token}
Content-Type: application/json

{ "blueprint": "<JSON string — use JSON.stringify() on the blueprint object>" }

Backend validates. If errors, fix the specific fields and resubmit (max 3 attempts).

### 3. Generate each component

IMPORTANT: For each component, FIRST fetch the generation prompt from the API. This prompt contains the exact format, examples, anti-patterns, and context (completed components, data model) you need:

GET ${baseUrl}/v1/generator/{projectId}/prompts/{componentId}
Authorization: Bearer {token}

Response: { "data": { "prompt": "...full generation instructions..." } }

Use that prompt to generate the content. Then submit:

POST ${baseUrl}/v1/generator/{projectId}/components/{componentId}/submit
Authorization: Bearer {token}
Content-Type: application/json

{ "type": "<type>", "content": "<string content in the format below>" }

Update heartbeat after each: { "phase": "generating", "componentId": "...", "stepNumber": N, "totalSteps": M }

#### Component format: CSM (Content Service Manifest) — YAML

content must be a YAML string:
\`\`\`yaml
service:
  name: my-service
  description: What this service does
  version: "1.0"
  category: monitoring
consent_requirements:
  personal_data: false
  cookies: false
  third_party: false
  legal_basis: legitimate_interest
data_schema:
  required:
    - fieldName1
    - fieldName2
  properties:
    fieldName1:
      type: string
      description: What this field is
    fieldName2:
      type: number
      description: What this field is
\`\`\`

#### Component format: MSM (Micro Service Module) — YAML

content must be a YAML string:
\`\`\`yaml
service:
  name: my-service
  version: "1.0"
auth:
  required: true
  scopes:
    - memory:read
    - memory:write
actions:
  - name: getData
    method: GET
    path: /data
    description: Fetches the data
  - name: updateData
    method: POST
    path: /data
    description: Updates the data
\`\`\`

#### Component format: Extension — JavaScript

content must be valid JavaScript. The extension runs in a sandbox with access to AIMEAT APIs.
IMPORTANT: Do NOT use JSON.parse on untrusted input, require(), or import. Use the AIMEAT memory API.

#### Component format: App — HTML

content must be a complete HTML document with a manifest comment at the top:
\`\`\`html
<!-- MANIFEST: {"name":"My App","version":"1.0","description":"What it does"} -->
<!DOCTYPE html>
<html>...</html>
\`\`\`

#### Component format: Memory — JSON

content must be valid JSON representing key-value data to store.

#### Component format: Translation — JSON

content must be a JSON locale object: { "key": "translated text", ... }

#### Component format: Cortex — YAML + JS

content must be YAML metadata followed by JavaScript library code in IIFE format.

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

## Complete Example Script (Node.js)

This script shows EXACTLY how to implement the full pipeline. Copy and adapt it.

\`\`\`javascript
import * as ed from '@noble/ed25519';

const GAII = '{your-gaii}';
const PRIVATE_KEY = '{your-private-key}';
const NODE = '${baseUrl}';
let token = '';

// Auth
async function auth() {
  const ts = new Date().toISOString();
  const msg = new TextEncoder().encode(GAII + ts);
  const key = Uint8Array.from(atob(PRIVATE_KEY), c => c.charCodeAt(0));
  const sig = btoa(String.fromCharCode(...await ed.signAsync(msg, key)));
  const r = await fetch(NODE + '/v1/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gaii: GAII, timestamp: ts, signature: sig })
  });
  token = (await r.json()).data.token;
}

// API helper
async function api(method, path, body) {
  const opts = { method, headers: { 'Authorization': 'Bearer ' + token } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(NODE + path, opts);
  return r.json();
}

// STEP 1: Poll for assignment
async function findAssignment() {
  const resp = await api('GET', '/v1/generator/my-assignments');
  const assignments = resp.data?.assignments || [];
  if (assignments.length === 0) return null;
  const a = assignments[0];
  const full = (await api('GET', '/v1/generator/' + a.projectId)).data;
  return { projectId: a.projectId, ...full };
}

// STEP 2: Generate blueprint using API prompt
async function generateBlueprint(projectId) {
  const promptResp = await api('GET', '/v1/generator/' + projectId + '/prompts');
  const prompt = promptResp.data.prompt;  // 13000+ chars of detailed instructions

  // Send prompt to your LLM and get the blueprint JSON back
  const blueprintJson = await callYourLLM(prompt);  // YOU implement this

  // Submit to API — it validates the structure
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await api('POST', '/v1/generator/' + projectId + '/steps/blueprint',
      { blueprint: blueprintJson });
    if (resp.ok) { console.log('Blueprint OK'); return true; }
    // 422 = validation error — fix and retry
    console.log('Blueprint error:', resp.error?.message);
    // Re-generate with error context
    blueprintJson = await callYourLLM(prompt + '\\nERROR: ' + resp.error?.message + '\\nFix and output ONLY the corrected JSON.');
  }
  return false;
}

// STEP 3: Generate each component using API prompts
async function generateComponents(projectId) {
  const project = (await api('GET', '/v1/generator/' + projectId)).data;
  const components = project.project.blueprint.components;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    await api('POST', '/v1/generator/' + projectId + '/session/heartbeat',
      { phase: 'generating', componentId: comp.id, stepNumber: i + 1, totalSteps: components.length });

    // GET THE PROMPT FROM THE API — this is the key step
    const promptResp = await api('GET', '/v1/generator/' + projectId + '/prompts/' + comp.id);
    const prompt = promptResp.data.prompt;  // Contains exact format, YAML examples, anti-patterns

    for (let attempt = 1; attempt <= 3; attempt++) {
      const content = await callYourLLM(prompt);  // LLM generates the content
      const resp = await api('POST', '/v1/generator/' + projectId + '/components/' + comp.id + '/submit',
        { type: comp.type, content: content });
      if (resp.ok && resp.data?.valid) {
        console.log(comp.id + ' OK');
        // Register immediately
        await api('POST', '/v1/generator/' + projectId + '/components/' + comp.id + '/register');
        break;
      }
      console.log(comp.id + ' error:', resp.error?.message);
      // Retry with error
      prompt += '\\nERROR: ' + resp.error?.message + '\\nFix and output ONLY the corrected content.';
    }
    await api('POST', '/v1/generator/' + projectId + '/log',
      { level: 'info', message: 'Generated ' + comp.label, componentId: comp.id });
  }
}

// STEP 4: Complete
async function complete(projectId) {
  const resp = await api('POST', '/v1/generator/' + projectId + '/complete');
  console.log(resp.ok ? 'DONE!' : 'Complete failed: ' + resp.error?.message);
}

async function main() {
  await auth();
  while (true) {
    await api('POST', '/v1/checkin');
    const assignment = await findAssignment();
    if (assignment) {
      console.log('Assigned to:', assignment.projectId);
      if (await generateBlueprint(assignment.projectId)) {
        await generateComponents(assignment.projectId);
        await complete(assignment.projectId);
      }
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}
main();
\`\`\`

The key pattern: ALWAYS call \`GET /v1/generator/{projectId}/prompts/{componentId}\` BEFORE generating content. The API returns the exact prompt with format requirements, examples, and context. Send that prompt to your LLM. Submit the LLM output to the API. If 422, append the error to the prompt and retry.
`);
  });

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

  // GET /v1/generator/my-assignments — poll for assigned projects (replaces SSE discovery)
  // Agents call this every 10-15 seconds to check if they've been assigned to a project.
  router.get('/v1/generator/my-assignments',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const callerGaii = req.auth!.sub; // The calling agent's GAII

      // List all generator sessions
      const records = await storage.listMemory(gaii, { prefix: 'generator.', visibility: 'owner' });
      const sessions = records.filter(r => r.key.endsWith('.session'));

      const assignments: Array<{ projectId: string; session: unknown }> = [];
      for (const rec of sessions) {
        const session = rec.value as { agentGaii?: string };
        if (session.agentGaii === callerGaii) {
          // Extract projectId from key: generator.{projectId}.session
          const parts = rec.key.split('.');
          const projectId = parts.slice(1, -1).join('.');
          assignments.push({ projectId, session: rec.value });
        }
      }

      res.json(success(config.nodeId, { assignments }));
    }
  );

  // GET /v1/generator/:projectId — get full project state
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
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/session/claim — agent claims an execution session
  // NOTE: registered before the generic /:projectId handler to ensure correct routing
  router.post('/v1/generator/:projectId/session/claim',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { agentGaii, agentName } = req.body ?? {};

      if (!agentGaii || typeof agentGaii !== 'string' || !agentName || typeof agentName !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'agentGaii and agentName are required strings'));
        return;
      }

      // Verify claimed agent exists and has generator capability
      const claimedAgent = await storage.getAgent(agentGaii);
      if (!claimedAgent) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Agent not found'));
        return;
      }
      // Verify agent belongs to the same owner
      if (claimedAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Agent belongs to a different owner'));
        return;
      }
      if (!claimedAgent.capabilities.includes('generator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agent does not have generator capability'));
        return;
      }

      // Check for existing fresh session
      const existing = await storage.getMemory(gaii, `generator.${projectId}.session`);
      if (existing) {
        const session = existing.value as { heartbeat: string; agentGaii: string };
        const age = Date.now() - new Date(session.heartbeat).getTime();

        // If same agent is re-claiming, update heartbeat instead of 409
        if (session.agentGaii === agentGaii && age < SESSION_TTL_MS) {
          const now = new Date().toISOString();
          const updated = { ...session, heartbeat: now };
          await storage.setMemory({ ...existing, value: updated, version: (existing.version ?? 1) + 1, updatedAt: now });
          const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
          res.json(success(config.nodeId, { claimed: true, expiresAt }));
          emitChange('memory');
          return;
        }

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
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/session/heartbeat — agent keeps session alive and updates progress
  router.post('/v1/generator/:projectId/session/heartbeat',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const existing = await storage.getMemory(gaii, `generator.${projectId}.session`);
      if (!existing) {
        res.status(404).json(error(config.nodeId, 'SESSION_RELEASED', 'Session no longer exists — agent should halt'));
        return;
      }

      const sessionAgent = (existing.value as { agentGaii?: string })?.agentGaii;
      if (sessionAgent && sessionAgent !== req.auth!.sub) {
        const isOwner = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
        if (!isOwner) {
          res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You do not own this session'));
          return;
        }
      }

      const now = new Date().toISOString();
      const updated: Record<string, unknown> = { ...(existing.value as Record<string, unknown>), heartbeat: now };

      // Allow agent to update progress fields via heartbeat body — with type checks
      const { phase, componentId, stepNumber, totalSteps } = req.body ?? {};

      // Enforce phase progression — agent cannot skip steps
      if (phase !== undefined && typeof phase === 'string') {
        if (phase === 'generating' || phase === 'registering' || phase === 'completing') {
          // These phases require a valid blueprint
          const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
          const blueprint = (projectRec?.value as Record<string, unknown>)?.blueprint;
          if (!blueprint) {
            res.status(400).json(error(config.nodeId, 'PHASE_BLOCKED', `Cannot enter phase "${phase}" — blueprint not yet submitted`));
            return;
          }
        }
        if (phase === 'completing') {
          // Completing requires at least one registered component
          const componentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
          const registeredCount = componentRecords.filter(r => {
            const val = r.value as { status?: string };
            return val.status === 'registered';
          }).length;
          if (registeredCount === 0) {
            res.status(400).json(error(config.nodeId, 'PHASE_BLOCKED', 'Cannot enter "completing" phase — no components have been registered'));
            return;
          }
        }
        updated['phase'] = phase;
      }
      if (componentId !== undefined && typeof componentId === 'string') updated['componentId'] = componentId;
      if (stepNumber !== undefined && typeof stepNumber === 'number') updated['stepNumber'] = stepNumber;
      if (totalSteps !== undefined && typeof totalSteps === 'number') updated['totalSteps'] = totalSteps;

      await storage.setMemory({ ...existing, value: updated, version: (existing.version ?? 1) + 1, updatedAt: now });

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      res.json(success(config.nodeId, { updated: true, expiresAt }));
      emitChange('memory');
    }
  );

  // DELETE /v1/generator/:projectId/session — release session (UI stop button or agent done)
  router.delete('/v1/generator/:projectId/session',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const deleted = await storage.deleteMemory(gaii, `generator.${projectId}.session`);
      if (!deleted) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No active session to release'));
        return;
      }
      res.json(success(config.nodeId, { released: true }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/steps/blueprint — validate + store blueprint
  // NOTE: registered before /:projectId/components/:componentId/submit to prevent 'steps' matching as componentId
  router.post('/v1/generator/:projectId/steps/blueprint',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { blueprint } = req.body ?? {};

      if (!blueprint || typeof blueprint !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'blueprint string is required'));
        return;
      }

      const validation = validateBlueprint(blueprint);
      if (!validation.valid) {
        // Return validation errors to agent — do NOT write to memory
        const errors = validation.errors ?? [];
        res.status(422).json(error(config.nodeId, 'VALIDATION_FAILED', errors.join('; ')));
        return;
      }

      // Update the project's blueprint field in memory
      const now = new Date().toISOString();
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: prevent blueprint overwrite if components have been submitted
      const existingComponents = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const hasSubmitted = existingComponents.some(r => {
        const val = r.value as { status?: string };
        return val.status === 'ready' || val.status === 'registered';
      });
      if (hasSubmitted) {
        res.status(409).json(error(config.nodeId, 'BLUEPRINT_LOCKED', 'Cannot overwrite blueprint — components have already been submitted. Delete components first or create a new project.'));
        return;
      }

      const updatedProject = {
        ...(projectRec.value as Record<string, unknown>),
        blueprint: validation.extracted ?? blueprint,
        status: 'blueprint_ready',
        updatedAt: now,
      };
      await storage.setMemory({ ...projectRec, value: updatedProject, version: (projectRec.version ?? 1) + 1, updatedAt: now });

      res.json(success(config.nodeId, { valid: true, errors: [], warnings: validation.warnings ?? [] }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/submit — validate + store component content
  router.post('/v1/generator/:projectId/components/:componentId/submit',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:write'),
    async (req, res) => {
      const gaii = ownerGhii(req);
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

      // Blueprint is REQUIRED before submitting components
      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      const blueprint = (projectRec?.value as any)?.blueprint;
      if (!blueprint) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint must be submitted before components'));
        return;
      }
      if (blueprint.components && !blueprint.components.some((c: any) => c.id === componentId)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint`));
        return;
      }

      const validation = validateComponent(type as ComponentType, content);

      if (!validation.valid) {
        // Return errors for agent to correct — do NOT write to memory
        const errors = validation.errors ?? [];
        res.status(422).json(error(config.nodeId, 'VALIDATION_FAILED', errors.join('; ')));
        return;
      }

      // Write validated component to memory
      const now = new Date().toISOString();
      const existingRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      if (existingRec) {
        const existingStatus = (existingRec.value as { status?: string })?.status;
        if (existingStatus === 'registered') {
          res.status(409).json(error(config.nodeId, 'ALREADY_REGISTERED', 'Component is already registered. Cannot re-submit.'));
          return;
        }
      }
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
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/components/:componentId/register — register a validated component into the AIMEAT catalogue
  router.post('/v1/generator/:projectId/components/:componentId/register',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
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

      // For registration, resolve owner from auth (works for both owner and agent sessions)
      const ownerName = req.auth!.owner;
      const regGhii = `${ownerName}@${config.nodeId}`;

      try {
        switch (component.type) {
          case 'csm': await registerCsm(component.content, ownerName, storage); break;
          case 'msm': await registerMsm(component.content, ownerName, storage); break;
          case 'extension': await registerExtension(component.content, ownerName, regGhii, storage, config.maxExtensionsPerOwner); break;
          case 'app': await registerApp(component.content, ownerName, regGhii, storage); break;
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
          version: (componentRec.version ?? 1) + 1,
          updatedAt: now,
        });
        res.json(success(config.nodeId, { registered: true, componentId }));
        emitChange('memory');
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
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { level, message, componentId, meta } = req.body ?? {};

      if (!level || typeof level !== 'string' || !message || typeof message !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level and message are required strings'));
        return;
      }
      if (!['info', 'warn', 'error'].includes(level)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level must be info, warn, or error'));
        return;
      }
      if (meta != null && typeof meta !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'meta must be an object or null'));
        return;
      }

      const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      await storage.setMemory({
        key: `generator.${projectId}.logs.${logId}`,
        ownerGaii: gaii,
        value: { logId, level, message, componentId: componentId ?? null, meta: meta ?? null, timestamp: now },
        visibility: 'owner',
        version: 1,
        tags: ['generator', 'log'],
        ttlHours: null,
        createdAt: now,
        updatedAt: now,
      });

      res.json(success(config.nodeId, { logged: true, logId }));
      emitChange('memory');
    }
  );

  // POST /v1/generator/:projectId/complete — mark project active, release session
  router.post('/v1/generator/:projectId/complete',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:execute'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      // Guard: require at least one registered component before marking complete
      const componentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const registeredCount = componentRecords.filter(r => {
        const val = r.value as { status?: string };
        return val.status === 'registered';
      }).length;

      if (registeredCount === 0) {
        res.status(400).json(error(config.nodeId, 'NO_COMPONENTS', 'Cannot complete project — no components have been registered. Generate and register components first.'));
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

      res.json(success(config.nodeId, { status: 'active', registeredComponents: registeredCount }));
      emitChange('memory');
    }
  );

  // GET /v1/generator/:projectId/prompts/:componentId — get the generation prompt for a component
  // Returns the SAME prompt that the UI gives to users, with full context (blueprint, completed components, interview spec).
  router.get('/v1/generator/:projectId/prompts/:componentId',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;

      // Load project state
      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const project = projectRec.value as { blueprint?: { components?: Array<{ id: string; type: string; label: string }>; dataModel?: Record<string, unknown> }; description?: string };
      const interviewSpec = interviewRec?.value ?? null;
      const blueprint = project.blueprint;

      if (!blueprint?.components) {
        res.status(400).json(error(config.nodeId, 'NO_BLUEPRINT', 'Blueprint not yet submitted'));
        return;
      }

      const component = blueprint.components.find((c: { id: string }) => c.id === componentId);
      if (!component) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Component "${componentId}" not in blueprint`));
        return;
      }

      // Load completed components for context
      const allComponentRecords = await storage.listMemory(gaii, { prefix: `generator.${projectId}.component.` });
      const completedComponents = allComponentRecords
        .filter(r => {
          const val = r.value as { status?: string };
          return val.status === 'registered' || val.status === 'ready';
        })
        .map(r => r.value);

      // Build the same prompt that UI shows to users
      const prompt = buildComponentPrompt(
        component.type,
        component.label,
        project.description || '',
        blueprint,
        completedComponents,
        interviewSpec,
      );

      res.json(success(config.nodeId, {
        componentId,
        type: component.type,
        label: component.label,
        prompt,
      }));
    }
  );

  // GET /v1/generator/:projectId/prompts — get the blueprint generation prompt
  router.get('/v1/generator/:projectId/prompts',
    requireAuth(),
    requireRole('agent'),
    requireScope('generator:read'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;

      const [projectRec, interviewRec] = await Promise.all([
        storage.getMemory(gaii, `generator.${projectId}.project`),
        storage.getMemory(gaii, `generator.${projectId}.interview-spec`),
      ]);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const project = projectRec.value as { description?: string };
      const interviewSpec = interviewRec?.value ?? null;

      const prompt = buildBlueprintPrompt(project.description || '', interviewSpec);

      res.json(success(config.nodeId, { prompt }));
    }
  );

  return router;
}
