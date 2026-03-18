# Agent-Driven Service Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable AI agents (e.g. OpenClaw) to autonomously execute the full AIMEAT service generation pipeline on behalf of a user, while the user watches real-time progress in the browser.

**Architecture:** Memory stays the single source of truth — all generator state lives in `generator.*` memory keys as before. The new `src/routes/generator.ts` is a thin validation layer: it validates agent submissions, then calls `storage.setMemory()` with the same key structure the UI already reads. Session state is stored in `generator.{id}.session`. SSE (already implemented) delivers all progress updates to the browser.

**Tech Stack:** TypeScript 5.9, Express 5, Node.js 24 ESM, `yaml` npm package (already in package.json), existing `storage.setMemory()` / `storage.getMemory()` storage layer, existing SSE events system.

**Spec:** `docs/plans/2026-03-18-agent-driven-service-generator.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/routes/generator.ts` | Create | All `/v1/generator/*` endpoints |
| `src/services/generator-validate.ts` | Create | TypeScript port of JS component validators |
| `src/services/generator-registration.ts` | Create | Per-type registration helpers extracted from existing routes |
| `src/server-bootstrap/routes-loader.ts` | Modify | Mount generatorRouter (guarded by `config.generatorEnabled`) |
| `src/auth/middleware.ts` | Modify | Add `generator:read/write/execute` to known scope examples/docs |
| `public/js/services/generator.js` | Modify | Change `saveInterviewSpec` visibility `'private'` → `'owner'` |
| `public/views/profile/generator-tab.js` | Modify | Add agent selector + progress banner UI |
| `test/e2e-generator.ts` | Modify | Add agent-driven test scenarios |
| `test/playwright/generator-interview.spec.ts` | Modify | Add banner + stop button tests |
| `openapi.yaml` | Modify | Add generator endpoints (done per task, not at end) |
| `locales/en.json` + `locales/fi.json` | Modify | New UI strings for banner and selector |

---

## Task 1: Port JS validators to TypeScript

**Files:**
- Create: `aimeat/src/services/generator-validate.ts`

The frontend validators live in `public/js/services/generator-validate.js`. Port them to TypeScript for server-side validation. The `yaml` npm package (`"yaml": "^2.8.2"`) is already in `package.json`.

- [ ] **Step 1.1: Create the file with types and YAML import**

```typescript
// @file src/services/generator-validate.ts
// @description Server-side component validators for the AIMEAT service generator.
// TypeScript port of public/js/services/generator-validate.js.
// @version-history v1.0.0 — 2026-03-18 — Initial port from JS validators

import { parse as yamlParse } from 'yaml';

export type ComponentType =
  | 'csm' | 'msm' | 'extension' | 'app'
  | 'memory' | 'translation' | 'cortex';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  extracted: string;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fixedBlueprint?: string;
}
```

- [ ] **Step 1.2: Port `extractCodeBlock` and `tryParseYaml` helpers**

```typescript
function extractCodeBlock(text: string, lang: string): string {
  const fenced = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'i');
  const m = text.match(fenced);
  if (m) return m[1].trim();
  // Fallback: try plain ``` block
  const plain = text.match(/```\s*\n([\s\S]*?)\n```/);
  if (plain) return plain[1].trim();
  return text.trim();
}

interface ParseResult {
  parsed: unknown;
  errors: string[];
  cleaned: string;
}

function tryParseYaml(raw: string): ParseResult {
  const errors: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = yamlParse(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`YAML parse error: ${msg}`);
  }
  return { parsed, errors, cleaned: raw };
}
```

- [ ] **Step 1.3: Port anti-pattern scanner for extensions**

Open `public/js/services/generator-validate.js` and find the `validateAntiPatterns('extension', ...)` function (around line 137-211). Port it exactly:

```typescript
function validateExtensionAntiPatterns(content: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // JSON.parse on ctx.memory.get crashes — memory.get already returns parsed value
  if (/JSON\.parse\s*\(\s*ctx\.memory\.get/.test(content)) {
    errors.push("Extension uses JSON.parse(ctx.memory.get(...)) — memory.get() already returns a parsed value, not a string");
  }
  // require() not available in V8 isolate
  if (/\brequire\s*\(/.test(content)) {
    errors.push("Extension uses require() which is not available in the V8 sandbox — use ctx.* APIs instead");
  }
  // import statements not available in V8 isolate
  if (/^\s*import\s+/m.test(content)) {
    errors.push("Extension uses import statements which are not available in the V8 sandbox");
  }
  // HTML entities in code indicate copy-paste corruption
  if (/&gt;|&lt;|&amp;|&quot;/.test(content)) {
    errors.push("Extension contains HTML entities (&gt;, &lt;, etc.) — likely a copy-paste artifact, use real characters");
  }
  // global fetch without ctx.
  if (/(?<!ctx\.)fetch\s*\(/.test(content)) {
    warnings.push("Extension calls fetch() without ctx. prefix — use ctx.fetch() for HTTP calls in the V8 sandbox");
  }

  return { errors, warnings };
}
```

> **Note:** Check the JS file for any additional anti-patterns not listed above and port them all.

- [ ] **Step 1.4: Port all 7 component validators**

Port `validators.csm`, `validators.msm`, `validators.extension`, `validators.app`, `validators.memory`, `validators.translation`, `validators.cortex` from the JS file into TypeScript. Follow the exact same logic — do not simplify or change behavior. Example for CSM:

```typescript
function validateCsm(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = extractCodeBlock(content, 'yaml');
  const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
  errors.push(...parseErrors);

  if (parsed && typeof parsed === 'object' && parsed !== null) {
    const p = parsed as Record<string, unknown>;
    const service = p['service'] as Record<string, unknown> | undefined;
    if (!service?.['name']) errors.push('Missing: service.name');
    if (!service?.['description']) errors.push('Missing: service.description');
    const schema = p['data_schema'] as Record<string, unknown> | undefined;
    const required = schema?.['required'];
    if (!required || typeof required !== 'object' || Object.keys(required).length === 0) {
      errors.push('data_schema.required must have at least one field');
    }
    if (!p['consent_requirements']) errors.push('Missing section: consent_requirements');
  }

  return { valid: errors.length === 0, errors, warnings, extracted: cleaned };
}
```

Port all 7 validators this way. Add to a `validators` map:

```typescript
export function validateComponent(type: ComponentType, content: string): ValidationResult {
  switch (type) {
    case 'csm': return validateCsm(content);
    case 'msm': return validateMsm(content);
    case 'extension': return validateExtension(content);
    case 'app': return validateApp(content);
    case 'memory': return validateMemorySchema(content);
    case 'translation': return validateTranslation(content);
    case 'cortex': return validateCortex(content);
    default: return { valid: false, errors: [`Unknown component type: ${type}`], warnings: [], extracted: content };
  }
}
```

- [ ] **Step 1.5: Port interview spec validator**

From the JS file's `validateInterviewSpec()` (around line 517-567):

```typescript
export interface InterviewSpec {
  version: string;
  projectName: string;
  description: string;
  technicalLevel: 'beginner' | 'intermediate' | 'advanced';
  useCases: Array<{ id: string; title: string; description: string; priority: 'must-have' | 'nice-to-have' }>;
  audience: { type: 'personal' | 'multi-user'; scale: 'single' | 'small' | 'medium' | 'large'; description: string };
  dataSources: unknown[];
  dataModel: { entities: unknown[] };
  views: unknown[];
  constraints: Record<string, unknown>;
  interviewNotes?: string;
}

export function validateInterviewSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object') return { valid: false, errors: ['spec must be an object'] };
  const s = spec as Record<string, unknown>;
  if (!s['version']) errors.push('Missing: version');
  if (!s['projectName']) errors.push('Missing: projectName');
  if (!s['description']) errors.push('Missing: description');
  if (!Array.isArray(s['useCases']) || s['useCases'].length === 0) errors.push('useCases must be a non-empty array');
  if (!s['audience'] || typeof s['audience'] !== 'object') errors.push('Missing: audience');
  if (!s['dataModel'] || typeof s['dataModel'] !== 'object') errors.push('Missing: dataModel');
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 1.6: Port blueprint validator**

From `validateBlueprint()` in the JS file (around line 571-697). This is the most complex one — port it carefully. It validates component type whitelist, cron formats, produces/consumes consistency, and auto-fixes minor issues:

```typescript
export function validateBlueprint(blueprintYaml: string): BlueprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const VALID_TYPES = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];
  // Type aliases to auto-fix
  const TYPE_ALIASES: Record<string, string> = { 'ext': 'extension' };

  const { parsed, errors: parseErrors } = tryParseYaml(blueprintYaml);
  errors.push(...parseErrors);
  if (errors.length > 0) return { valid: false, errors, warnings };

  // ... port full blueprint validation logic from JS file ...
  // Check: components is array, each has id + type
  // Auto-fix: ext -> extension, cron prefix, cron field count
  // Cross-validate: produces/consumes references

  return { valid: errors.length === 0, errors, warnings };
}
```

> **Important:** Read the full JS blueprint validator carefully and port all checks, including cron expression auto-fixes and cross-reference validation.

- [ ] **Step 1.7: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 1.8: Commit**

```bash
cd aimeat
git add src/services/generator-validate.ts
git commit -m "feat: port generator validators to TypeScript for server-side validation"
```

---

## Task 2: Add generator scopes and create the router skeleton

**Files:**
- Modify: `aimeat/src/auth/middleware.ts`
- Create: `aimeat/src/routes/generator.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`
- Modify: `aimeat/openapi.yaml`

- [ ] **Step 2.1: Document the new scopes in middleware.ts**

Open `src/auth/middleware.ts`. Find where scope examples are listed (the `requireScope` comment block or any scope documentation inline). Add a comment block documenting the new scopes. Scopes don't need to be "registered" — they work automatically via the pattern-matching in `requireScope()`. Just document them:

```typescript
// Generator scopes (agent-driven service generation):
// generator:read    — read projects, interview specs, components, session state
// generator:write   — create projects, save interview spec, submit blueprint and components
// generator:execute — claim/release sessions, register and activate components, write logs
```

- [ ] **Step 2.2: Create router skeleton**

```typescript
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

export function generatorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // Routes will be added in subsequent tasks

  return router;
}
```

- [ ] **Step 2.3: Mount in routes-loader.ts**

Open `src/server-bootstrap/routes-loader.ts`. Add the import near the other route imports:

```typescript
import { generatorRouter } from '../routes/generator.js';
```

Add the mount after `memoryRouter` (line ~177), guarded by `config.generatorEnabled` (same pattern as `extensionsEnabled` and `cortexEnabled` guards already in the file):

```typescript
if (config.generatorEnabled) {
  app.use(generatorRouter(config, storage));   // Agent-driven service generator
}
```

> **Note:** `requireRole('agent')` in the route handlers also passes for owner JWTs — the middleware role hierarchy accepts `'owner'` as satisfying the `'agent'` role check. This means the UI (which uses owner JWTs) can call `GET /v1/generator/*` endpoints without needing a separate owner code path.

- [ ] **Step 2.4: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2.5: Update openapi.yaml — add generator tag and scopes**

In `openapi.yaml`, add a `generator` tag to the `tags:` section:

```yaml
tags:
  # ... existing tags ...
  - name: generator
    description: Agent-driven service generation pipeline
```

Add to the `securitySchemes` or scope documentation:

```yaml
# Under the Bearer scheme scopes (or equivalent location in the file):
generator:read: Read generator projects, interview specs, session state
generator:write: Create projects, submit blueprint and components
generator:execute: Claim sessions, register components, write logs
```

- [ ] **Step 2.6: Commit**

```bash
cd aimeat
git add src/routes/generator.ts src/server-bootstrap/routes-loader.ts src/auth/middleware.ts openapi.yaml
git commit -m "feat: add generator router skeleton and document generator:* scopes"
```

---

## Task 3: Project management endpoints

**Files:**
- Modify: `aimeat/src/routes/generator.ts`
- Modify: `aimeat/openapi.yaml`

The project and interview endpoints are simple memory writes. The key structure matches exactly what the frontend creates today.

Project memory record shape (`generator.{id}.project`):
```json
{
  "id": "gen-abc123",
  "name": "My Service",
  "description": "...",
  "status": "draft",
  "blueprint": null,
  "createdAt": "2026-03-18T10:00:00Z",
  "updatedAt": "2026-03-18T10:00:00Z"
}
```

- [ ] **Step 3.1: Add POST /v1/generator/projects**

In `generatorRouter`, add before `return router`:

```typescript
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
```

- [ ] **Step 3.2: Add GET /v1/generator/projects**

```typescript
// GET /v1/generator/projects — list all projects for this owner
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
```

- [ ] **Step 3.3: Add GET /v1/generator/:projectId**

```typescript
// GET /v1/generator/:projectId — get composite project state
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
```

- [ ] **Step 3.4: Add POST /v1/generator/:projectId/interview**

This also fixes the visibility bug: the existing frontend writes interview-spec with `visibility: 'private'`, making it unreadable by agent JWTs. This endpoint writes with `visibility: 'owner'`.

```typescript
import { validateInterviewSpec } from '../services/generator-validate.js';

// POST /v1/generator/:projectId/interview — save interview spec
router.post('/v1/generator/:projectId/interview',
  requireAuth(),
  requireRole('agent'),
  requireScope('generator:write'),
  async (req, res) => {
    const gaii = resolve(req);
    const projectId = req.params['projectId'] as string;
    const { interviewSpec } = req.body ?? {};

    const validation = validateInterviewSpec(interviewSpec);
    if (!validation.valid) {
      res.status(422).json(error(config.nodeId, 'VALIDATION_ERROR', 'Invalid interview spec', { errors: validation.errors }));
      return;
    }

    const now = new Date().toISOString();
    await storage.setMemory({
      key: `generator.${projectId}.interview-spec`,
      ownerGaii: gaii,
      value: interviewSpec,
      visibility: 'owner',   // ← 'owner' not 'private', so agent can read it back
      version: 1,
      tags: ['generator', 'interview'],
      ttlHours: null,
      createdAt: now,
      updatedAt: now,
    });

    res.json(success(config.nodeId, { saved: true }));
  }
);
```

- [ ] **Step 3.5: Also fix visibility in frontend generator.js**

Open `public/js/services/generator.js`. Find `saveInterviewSpec` and change `visibility: 'private'` to `visibility: 'owner'`:

```javascript
// Before:
visibility: 'private',
// After:
visibility: 'owner',
```

- [ ] **Step 3.6: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3.7: Add openapi.yaml entries for Task 3 endpoints**

Add path entries for `POST /v1/generator/projects`, `GET /v1/generator/projects`, `GET /v1/generator/{projectId}`, `POST /v1/generator/{projectId}/interview` under the `generator` tag. Follow the existing path entry format in the file.

- [ ] **Step 3.8: Commit**

```bash
cd aimeat
git add src/routes/generator.ts public/js/services/generator.js openapi.yaml
git commit -m "feat: add generator project and interview endpoints, fix interview-spec visibility"
```

---

## Task 4: Session management endpoints

**Files:**
- Modify: `aimeat/src/routes/generator.ts`
- Modify: `aimeat/openapi.yaml`

Session state is stored as `generator.{id}.session` in memory. The claim endpoint uses `setMemoryIfVersion` for atomic claim to prevent two agents racing to claim the same session.

Session record shape:
```json
{
  "agentGaii": "claude#alice@node",
  "agentName": "OpenClaw",
  "phase": "blueprint",
  "componentId": null,
  "stepNumber": 0,
  "totalSteps": 0,
  "startedAt": "2026-03-18T10:00:00Z",
  "heartbeat": "2026-03-18T10:00:00Z"
}
```

- [ ] **Step 4.1: Add POST /v1/generator/:projectId/session/claim**

```typescript
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// POST /v1/generator/:projectId/session/claim
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

    // Verify agent exists and has generator capability
    const agentRecord = await storage.getAgent(agentGaii);
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
      // Atomic claim: version 0 means "must not exist" (will fail if key exists with any version)
      // If replacing a stale session, use existing.version so we win only if nobody else wrote
      const expectedVersion = existing ? existing.version : 0;
      const newVersion = existing ? existing.version + 1 : 1;
      const result = await storage.setMemoryIfVersion(
        { ...sessionRecord, version: newVersion, createdAt: existing?.createdAt ?? now, updatedAt: now },
        expectedVersion,
      );
      if (!result) {
        // Another agent claimed between our read and write
        res.status(409).json(error(config.nodeId, 'SESSION_BUSY', 'Session was claimed by another agent'));
        return;
      }
    } else {
      // Non-atomic fallback (single-process dev only) — the read-then-write above is best-effort
      await storage.setMemory({ ...sessionRecord, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now });
    }

    res.json(success(config.nodeId, { claimed: true, expiresAt }));
  }
);
```

- [ ] **Step 4.2: Add POST /v1/generator/:projectId/session/heartbeat**

```typescript
// POST /v1/generator/:projectId/session/heartbeat
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
    const updated = { ...(existing.value as object), heartbeat: now };
    // Also allow updating phase/stepNumber/componentId from body
    const { phase, componentId, stepNumber, totalSteps } = req.body ?? {};
    if (phase) (updated as Record<string, unknown>)['phase'] = phase;
    if (componentId !== undefined) (updated as Record<string, unknown>)['componentId'] = componentId;
    if (stepNumber !== undefined) (updated as Record<string, unknown>)['stepNumber'] = stepNumber;
    if (totalSteps !== undefined) (updated as Record<string, unknown>)['totalSteps'] = totalSteps;

    await storage.setMemory({ ...existing, value: updated, updatedAt: now });

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    res.json(success(config.nodeId, { ok: true, expiresAt }));
  }
);
```

- [ ] **Step 4.3: Add DELETE /v1/generator/:projectId/session**

```typescript
// DELETE /v1/generator/:projectId/session — release session
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
```

- [ ] **Step 4.4: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4.5: Add openapi.yaml entries for session endpoints**

- [ ] **Step 4.6: Commit**

```bash
cd aimeat
git add src/routes/generator.ts openapi.yaml
git commit -m "feat: add generator session claim, heartbeat, and release endpoints"
```

---

## Task 5: Generation step endpoints (blueprint, component submit, log, complete)

**Files:**
- Modify: `aimeat/src/routes/generator.ts`
- Modify: `aimeat/openapi.yaml`

- [ ] **Step 5.1: Add POST /v1/generator/:projectId/steps/blueprint**

```typescript
import { validateBlueprint } from '../services/generator-validate.js';

// POST /v1/generator/:projectId/steps/blueprint
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
      res.json(success(config.nodeId, { valid: false, errors: validation.errors, warnings: validation.warnings }));
      return;
    }

    // Update the project record's blueprint field
    const now = new Date().toISOString();
    const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
    if (!projectRec) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
      return;
    }

    const updated = { ...(projectRec.value as object), blueprint: validation.extracted ?? blueprint, status: 'blueprint_ready', updatedAt: now };
    await storage.setMemory({ ...projectRec, value: updated, updatedAt: now });

    res.json(success(config.nodeId, { valid: true, errors: [], warnings: validation.warnings }));
  }
);
```

- [ ] **Step 5.2: Add POST /v1/generator/:projectId/components/:componentId/submit**

```typescript
import { validateComponent } from '../services/generator-validate.js';
import type { ComponentType } from '../services/generator-validate.js';

const VALID_COMPONENT_TYPES: ComponentType[] = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];

// POST /v1/generator/:projectId/components/:componentId/submit
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
      res.json(success(config.nodeId, { valid: false, errors: validation.errors, warnings: validation.warnings, extracted: validation.extracted }));
      return;
    }

    // Write component to memory
    const now = new Date().toISOString();
    const componentRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
    const newVersion = componentRec ? componentRec.version + 1 : 1;

    await storage.setMemory({
      key: `generator.${projectId}.component.${componentId}`,
      ownerGaii: gaii,
      value: { type, content: validation.extracted, status: 'ready', submittedAt: now },
      visibility: 'owner',
      version: newVersion,
      tags: ['generator', 'component', type],
      ttlHours: null,
      createdAt: componentRec?.createdAt ?? now,
      updatedAt: now,
    });

    res.json(success(config.nodeId, { valid: true, errors: [], warnings: validation.warnings, extracted: validation.extracted }));
  }
);
```

- [ ] **Step 5.3: Add POST /v1/generator/:projectId/log**

```typescript
// POST /v1/generator/:projectId/log
router.post('/v1/generator/:projectId/log',
  requireAuth(),
  requireRole('agent'),
  requireScope('generator:execute'),
  async (req, res) => {
    const gaii = resolve(req);
    const projectId = req.params['projectId'] as string;
    const { taskId, level, message, meta } = req.body ?? {};

    if (!taskId || !level || !message) {
      res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'taskId, level, and message are required'));
      return;
    }
    if (!['info', 'warn', 'error'].includes(level)) {
      res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'level must be info, warn, or error'));
      return;
    }

    const now = new Date().toISOString();
    await storage.setMemory({
      key: `generator.${projectId}.logs.${taskId}`,
      ownerGaii: gaii,
      value: { taskId, level, message, meta: meta ?? null, timestamp: now },
      visibility: 'owner',
      version: 1,
      tags: ['generator', 'log'],
      ttlHours: null,
      createdAt: now,
      updatedAt: now,
    });

    // SSE is triggered automatically by the memory write via the existing events system

    res.json(success(config.nodeId, { ok: true }));
  }
);
```

- [ ] **Step 5.4: Add POST /v1/generator/:projectId/complete**

```typescript
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
      value: { ...(projectRec.value as object), status: 'active', completedAt: now, updatedAt: now },
      updatedAt: now,
    });

    // Release session if it exists
    await storage.deleteMemory(gaii, `generator.${projectId}.session`);

    res.json(success(config.nodeId, { status: 'active' }));
  }
);
```

- [ ] **Step 5.5: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5.6: Add openapi.yaml entries for step endpoints**

- [ ] **Step 5.7: Commit**

```bash
cd aimeat
git add src/routes/generator.ts openapi.yaml
git commit -m "feat: add generator blueprint, component submit, log, and complete endpoints"
```

---

## Task 6: Component registration endpoint

**Files:**
- Modify: `aimeat/src/routes/generator.ts`
- Modify: `aimeat/openapi.yaml`

This is the most complex endpoint. Registration routes (`/v1/csm`, `/v1/msm`, etc.) require `requireRole('owner')` and reject agent JWTs. The generator register endpoint resolves this by calling `storage.*` registration methods directly, using the owner GHII derived from the agent's owner field.

**Before implementing:** Read `src/routes/csm.ts` and `src/routes/msm.ts` to understand the exact shape of `CsmRecord` and `MsmRecord`, and how the frontend currently builds them from component content. Also read `src/routes/apps.ts` and `src/routes/actions.ts` for extension/app record shapes.

- [ ] **Step 6.1: Extract registration helper functions from existing routes**

Registration is non-trivial for each component type — it involves parsing, building typed records, and calling specific storage methods. Before writing the register endpoint, extract the internal logic from existing routes into reusable helpers. This avoids duplicating complex code.

**Read these files first, in this order:**
1. `src/routes/csm.ts` — find the POST handler, understand how it parses YAML → builds `CsmRecord` → calls `storage.createCsm()`. Note any calls to `parseCsm()`, `csmToJsonSchema()`, or similar services.
2. `src/routes/msm.ts` — same for `MsmRecord` and `storage.createMsm()`.
3. `src/routes/actions.ts` — how extension manifests are parsed and `storage.createExtensionInstance()` is called. Note if `extension-runtime` service is involved.
4. `src/routes/apps.ts` — how `AppRecord` is built and `storage.createApp()` is called. Note the `versionNumber` sequence.
5. `src/storage/interface.ts` lines 456-500 — `CsmRecord`, `MsmRecord` exact field types.

**For each type that has complex parsing (csm, msm, extension), extract the core parsing logic into a service function in a new file `src/services/generator-registration.ts`:**

```typescript
// @file src/services/generator-registration.ts
// @description Internal registration helpers used by the agent-driven generator.
// Extracted from src/routes/csm.ts, msm.ts, actions.ts to avoid duplication.
// @version-history v1.0.0 — 2026-03-18 — Initial extraction for generator agent support

import { parse as yamlParse } from 'yaml';
import type { Storage } from '../storage/interface.js';

// One function per type — implement after reading the source routes
export async function registerCsm(content: string, ownerGhii: string, storage: Storage): Promise<void> {
  // Copy the parsing+record-building logic from src/routes/csm.ts POST handler
  // Do NOT simplify — match the exact field set that CsmRecord requires
  throw new Error('not implemented — read src/routes/csm.ts first');
}

export async function registerMsm(content: string, ownerGhii: string, storage: Storage): Promise<void> {
  throw new Error('not implemented — read src/routes/msm.ts first');
}

export async function registerExtension(content: string, ownerGhii: string, storage: Storage): Promise<void> {
  // Extensions may require src/services/extension-runtime.ts for compilation — check actions.ts
  throw new Error('not implemented — read src/routes/actions.ts first');
}

export async function registerApp(content: string, ownerGhii: string, storage: Storage): Promise<void> {
  // Apps need a versionNumber sequence — check src/routes/apps.ts for how this is managed
  throw new Error('not implemented — read src/routes/apps.ts first');
}

// memory, translation, cortex: stored only in generator.* memory keys, no catalogue registration needed
```

Implement each function fully by reading the corresponding route. The `throw` stubs are placeholders to make `tsc` pass while you work through each one.

**Types that need NO catalogue registration** (store in memory only, no storage.create* call):
- `memory` — JSON schema, stored in generator memory key only
- `translation` — i18n JSON, stored in generator memory key only
- `cortex` — client-side library, may need cortex-specific registration — check `src/routes/cortex.ts` if it exists, otherwise treat as memory-only

- [ ] **Step 6.2: Add POST /v1/generator/:projectId/components/:componentId/register**

```typescript
import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';

// POST /v1/generator/:projectId/components/:componentId/register
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
    const ownerGhii = `${agentRecord.owner}@${config.nodeId}`;

    try {
      switch (component.type) {
        case 'csm': await registerCsm(component.content, ownerGhii, storage); break;
        case 'msm': await registerMsm(component.content, ownerGhii, storage); break;
        case 'extension': await registerExtension(component.content, ownerGhii, storage); break;
        case 'app': await registerApp(component.content, ownerGhii, storage); break;
        case 'memory':
        case 'translation':
        case 'cortex':
          // No catalogue registration — stored in generator memory keys only
          break;
        default:
          res.status(400).json(error(config.nodeId, 'UNSUPPORTED_TYPE', `Registration not supported for type: ${component.type}`));
          return;
      }

      const now = new Date().toISOString();
      await storage.setMemory({ ...componentRec, value: { ...component, status: 'registered', registeredAt: now }, updatedAt: now });
      res.json(success(config.nodeId, { registered: true, componentId }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json(error(config.nodeId, 'REGISTRATION_ERROR', msg));
    }
  }
);

- [ ] **Step 6.3: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors. (The `throw new Error('not implemented')` stubs in generator-registration.ts are fine — they satisfy the TypeScript return types.)

- [ ] **Step 6.4: Add openapi.yaml entry**

- [ ] **Step 6.5: Commit**

```bash
cd aimeat
git add src/routes/generator.ts src/services/generator-registration.ts openapi.yaml
git commit -m "feat: add generator component registration endpoint with owner GHII resolution"
```

---

## Task 7: UI — agent selector after interview

**Files:**
- Modify: `aimeat/public/views/profile/generator-tab.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

The "Listening agents" panel already exists in generator-tab.js. After the interview spec is saved, show a new section with the agent list and a "Start with this agent" button.

- [ ] **Step 7.1: Add i18n keys**

In `locales/en.json` under the `"generator"` section:
```json
"agentSelector": {
  "title": "Start with an agent",
  "subtitle": "Interview complete. Let an agent execute the rest of the pipeline.",
  "noAgents": "No agents listening. Copy the agent prompt and paste it into your AI agent.",
  "startButton": "Start with this agent",
  "manualButton": "Continue manually"
}
```

Add the same keys to `locales/fi.json` (use English as placeholder with `[TODO:fi]` if Finnish translation is unknown).

- [ ] **Step 7.2: Add agent selector component to generator-tab.js**

Find the section in `generator-tab.js` that renders after the interview step. Add a conditional block that shows when `interviewSpec` is present and no session is active:

```javascript
// After interview spec is saved, show agent selector
function AgentSelector({ projectId, listeners, onAgentStart, onManual }) {
  const [selected, setSelected] = useState(listeners[0]?.gaii ?? null);
  const { t } = useLocale();

  if (listeners.length === 0) {
    return html`<div class="gen-agent-selector">
      <p class="gen-agent-selector-empty">${t('generator.agentSelector.noAgents')}</p>
      <button class="btn-ghost" onClick=${onManual}>${t('generator.agentSelector.manualButton')}</button>
    </div>`;
  }

  return html`<div class="gen-agent-selector">
    <p class="gen-agent-selector-subtitle">${t('generator.agentSelector.subtitle')}</p>
    <div class="gen-agent-list">
      ${listeners.map(agent => html`
        <label class="gen-agent-option ${selected === agent.gaii ? 'selected' : ''}">
          <input type="radio" name="agent" value=${agent.gaii}
            checked=${selected === agent.gaii}
            onChange=${() => setSelected(agent.gaii)} />
          <span class="gen-agent-name">${agent.name ?? agent.gaii}</span>
          <span class="gen-agent-gaii">${agent.gaii}</span>
        </label>
      `)}
    </div>
    <div class="gen-agent-actions">
      <button class="btn-primary" disabled=${!selected}
        onClick=${() => selected && onAgentStart(selected)}>
        ${t('generator.agentSelector.startButton')}
      </button>
      <button class="btn-ghost" onClick=${onManual}>${t('generator.agentSelector.manualButton')}</button>
    </div>
  </div>`;
}
```

- [ ] **Step 7.3: Wire up agent start to POST /v1/generator/:id/session/claim**

In the project view's `onAgentStart` handler:

```javascript
async function handleAgentStart(agentGaii) {
  const agentRecord = listeners.find(a => a.gaii === agentGaii);
  await apiPost(`/v1/generator/${projectId}/session/claim`, {
    agentGaii,
    agentName: agentRecord?.name ?? agentGaii,
  });
  // The session key will be written to memory → SSE fires → progress banner appears
  reload();
}
```

- [ ] **Step 7.4: Type-check and lint**

```bash
cd aimeat
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 7.5: Commit**

```bash
cd aimeat
git add public/views/profile/generator-tab.js locales/en.json locales/fi.json
git commit -m "feat: add agent selector UI shown after interview spec is saved"
```

---

## Task 8: UI — progress banner

**Files:**
- Modify: `aimeat/public/views/profile/generator-tab.js`
- Modify: `aimeat/public/css/views/profile.css` or generator-specific CSS file
- Modify: `aimeat/locales/en.json` + `locales/fi.json`

- [ ] **Step 8.1: Add banner i18n keys**

In `locales/en.json`:
```json
"agentBanner": {
  "working": "{agentName} is working",
  "phase": "Phase: {phase} ({step}/{total})",
  "disconnected": "Agent may have disconnected",
  "stopButton": "Stop agent",
  "continueManually": "Stop and continue manually"
}
```

- [ ] **Step 8.2: Add AgentProgressBanner component**

```javascript
function AgentProgressBanner({ session, components, projectId, onStop }) {
  const { t } = useLocale();
  const isStale = session &&
    (Date.now() - new Date(session.heartbeat).getTime()) > 5 * 60 * 1000;

  async function handleStop() {
    await apiDelete(`/v1/generator/${projectId}/session`);
    onStop();
  }

  if (!session) return null;

  return html`<div class="gen-agent-banner ${isStale ? 'stale' : ''}">
    <span class="gen-agent-banner-icon">⚠</span>
    <div class="gen-agent-banner-info">
      <strong>${isStale
        ? t('generator.agentBanner.disconnected')
        : t('generator.agentBanner.working', { agentName: session.agentName })
      }</strong>
      ${!isStale && session.totalSteps > 0 && html`
        <span class="gen-agent-banner-phase">
          ${t('generator.agentBanner.phase', {
            phase: session.phase,
            step: session.stepNumber,
            total: session.totalSteps,
          })}
        </span>
      `}
    </div>
    <div class="gen-step-indicators">
      ${components.map(c => html`
        <span class="gen-step-dot ${c.status === 'registered' ? 'done' : c.id === session.componentId ? 'active' : 'pending'}"
              title=${c.id}></span>
      `)}
    </div>
    <button class="btn-ghost gen-stop-btn" onClick=${handleStop}>
      ${isStale
        ? t('generator.agentBanner.continueManually')
        : t('generator.agentBanner.stopButton')
      }
    </button>
  </div>`;
}
```

- [ ] **Step 8.3: Render banner at top of project view when session exists**

In the project detail view, read `generator.{id}.session` from the composite state returned by `GET /v1/generator/{id}` and render the banner:

```javascript
// In project detail component:
const { project, session, components } = projectState;
// ...
return html`
  <${AgentProgressBanner}
    session=${session}
    components=${components}
    projectId=${project.id}
    onStop=${reload}
  />
  <!-- rest of project view -->
`;
```

- [ ] **Step 8.4: Subscribe to SSE live updates in the generator tab**

The generator tab must listen for `aimeat-live-update` events so the progress banner refreshes automatically when the agent writes a heartbeat or log:

```javascript
useEffect(() => {
  const handler = () => loadProject();
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
}, [projectId]);
```

- [ ] **Step 8.5: Add CSS for the banner**

In the appropriate CSS file (follow existing `gen-*` prefix pattern), add:

```css
.gen-agent-banner {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--warning-subtle);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius);
  margin-bottom: var(--spacing-4);
}
.gen-agent-banner.stale {
  background: var(--error-subtle);
  border-color: var(--error-border);
}
.gen-step-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); display: inline-block; }
.gen-step-dot.done { background: var(--success); }
.gen-step-dot.active { background: var(--primary); animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
```

> **Note:** Use only CSS variables from `theme.css` — never hardcode colors. No `rgba(255,255,255,...)`. No `filter: blur()` with continuous animation.

- [ ] **Step 8.6: Lint check**

```bash
cd aimeat
pnpm lint
```

- [ ] **Step 8.7: Commit**

```bash
cd aimeat
git add public/views/profile/generator-tab.js public/css/ locales/en.json locales/fi.json
git commit -m "feat: add agent progress banner with step indicators and stop button"
```

---

## Task 9: E2E tests

**Files:**
- Modify: `aimeat/test/e2e-generator.ts`

Add tests at the end of the existing e2e-generator.ts file. Follow the existing test patterns (embedded server, admin auth, `json()` helper, state management).

- [ ] **Step 9.1: Add agent setup state variables**

Near the top of the test file, add:
```typescript
let generatorAgentToken = '';
let generatorAgentGaii = '';
```

The test agent must be registered with scopes `memory:read,generator:write,generator:execute` and capability `generator`. Follow the existing agent registration pattern in the test file. When the owner approves the agent (RFC 8628 device auth flow), pass these scopes explicitly. Without `memory:read` the agent cannot read back the interview-spec from `GET /v1/memory/...`, and without `generator:execute` it cannot claim sessions.

- [ ] **Step 9.2: Write test — create project via agent API**

```typescript
await test('Agent: create generator project', async () => {
  const { status, body } = await json('/v1/generator/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ name: 'Test Service', description: 'E2E test service' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.projectId, 'Expected projectId in response');
  // store for next tests
  (globalThis as Record<string, unknown>)['e2eGeneratorProjectId'] = body.data.projectId;
});
```

- [ ] **Step 9.3: Write test — save interview spec with owner visibility**

```typescript
await test('Agent: save interview spec (visibility: owner)', async () => {
  const projectId = (globalThis as Record<string, unknown>)['e2eGeneratorProjectId'];
  const spec = {
    version: '1.0', projectName: 'Test', description: 'test',
    technicalLevel: 'beginner', useCases: [{ id: 'uc1', title: 'T', description: 'D', priority: 'must-have' }],
    audience: { type: 'personal', scale: 'single', description: '' },
    dataSources: [], dataModel: { entities: [] }, views: [], constraints: {},
  };
  const { status } = await json(`/v1/generator/${projectId}/interview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ interviewSpec: spec }),
  });
  assert(status === 200, `Expected 200, got ${status}`);

  // Verify agent can read it back via memory API
  const { status: readStatus, body: readBody } = await json(`/v1/memory/generator.${projectId}.interview-spec`, {
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
  });
  assert(readStatus === 200, `Agent should be able to read interview-spec with owner visibility`);
});
```

- [ ] **Step 9.4: Write test — blueprint submit + validation error**

```typescript
await test('Agent: blueprint submit returns validation errors for invalid blueprint', async () => {
  const projectId = (globalThis as Record<string, unknown>)['e2eGeneratorProjectId'];
  const { status, body } = await json(`/v1/generator/${projectId}/steps/blueprint`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ blueprint: 'not: valid: yaml: [' }),
  });
  assert(status === 200, 'Should return 200 with valid:false');
  assert(body.data?.valid === false, 'Should be invalid');
  assert(Array.isArray(body.data?.errors) && body.data.errors.length > 0, 'Should have errors');
});
```

- [ ] **Step 9.5: Write test — component submit + validation + 3 retries**

```typescript
await test('Agent: component submit validates and stores on success', async () => {
  const projectId = (globalThis as Record<string, unknown>)['e2eGeneratorProjectId'];
  const validCsm = `
\`\`\`yaml
service:
  name: test-service
  description: Test
  version: "1.0"
data_schema:
  required:
    name:
      type: string
consent_requirements:
  data_access: required
\`\`\``;

  const { status, body } = await json(`/v1/generator/${projectId}/components/csm-main/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ type: 'csm', content: validCsm }),
  });
  assert(status === 200);
  assert(body.data?.valid === true, `Expected valid:true, errors: ${JSON.stringify(body.data?.errors)}`);

  // Verify stored in memory
  const { status: memStatus } = await json(`/v1/memory/generator.${projectId}.component.csm-main`, {
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
  });
  assert(memStatus === 200, 'Component should be in memory after valid submit');
});
```

- [ ] **Step 9.6: Write test — session claim, heartbeat, stop**

```typescript
await test('Agent: session claim, heartbeat, and release', async () => {
  const projectId = (globalThis as Record<string, unknown>)['e2eGeneratorProjectId'];

  // Claim
  const { status: claimStatus } = await json(`/v1/generator/${projectId}/session/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ agentGaii: generatorAgentGaii, agentName: 'TestAgent' }),
  });
  assert(claimStatus === 200, `Expected 200, got ${claimStatus}`);

  // Second claim returns 409
  const { status: claimStatus2 } = await json(`/v1/generator/${projectId}/session/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
    body: JSON.stringify({ agentGaii: generatorAgentGaii, agentName: 'TestAgent2' }),
  });
  assert(claimStatus2 === 409, `Expected 409 SESSION_BUSY, got ${claimStatus2}`);

  // Heartbeat
  const { status: hbStatus } = await json(`/v1/generator/${projectId}/session/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
  });
  assert(hbStatus === 200, `Heartbeat expected 200, got ${hbStatus}`);

  // Release
  const { status: delStatus } = await json(`/v1/generator/${projectId}/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
  });
  assert(delStatus === 200, `Release expected 200, got ${delStatus}`);

  // Heartbeat after release returns 404
  const { status: hbAfter } = await json(`/v1/generator/${projectId}/session/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generatorAgentToken}` },
  });
  assert(hbAfter === 404, `Expected 404 SESSION_RELEASED after delete, got ${hbAfter}`);
});
```

- [ ] **Step 9.7: Run E2E tests**

```bash
cd aimeat
pnpm test:e2e:mongodb 2>&1 | tail -30
pnpm test:e2e:sqlite 2>&1 | tail -30
```

Expected: 0 failures. Fix any failures before proceeding.

- [ ] **Step 9.8: Commit**

```bash
cd aimeat
git add test/e2e-generator.ts
git commit -m "test: add agent-driven generator E2E tests (session, interview, blueprint, component)"
```

---

## Task 10: Playwright tests

**Files:**
- Modify: `aimeat/test/playwright/generator-interview.spec.ts`

- [ ] **Step 10.1: Add test — progress banner appears after session claim**

In the existing generator Playwright spec, add:

```typescript
test('progress banner appears when agent session is active', async ({ page }) => {
  // Navigate to generator project page
  // ... (follow existing test setup pattern)

  // Simulate session claim via API
  await page.request.post(`/v1/generator/${testProjectId}/session/claim`, {
    data: { agentGaii: testAgentGaii, agentName: 'TestAgent' },
    headers: { Authorization: `Bearer ${ownerToken}` },
  });

  // Wait for SSE to deliver update
  await page.waitForSelector('.gen-agent-banner', { timeout: 5000 });
  await expect(page.locator('.gen-agent-banner')).toBeVisible();
  await expect(page.locator('.gen-agent-banner')).toContainText('TestAgent');
});
```

- [ ] **Step 10.2: Add test — stop button releases session**

```typescript
test('stop button removes progress banner', async ({ page }) => {
  // ... setup with active session ...

  await page.locator('.gen-stop-btn').click();

  // Banner should disappear after stop
  await expect(page.locator('.gen-agent-banner')).not.toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 10.3: Run Playwright tests**

```bash
cd aimeat
npx playwright test test/playwright/generator-interview.spec.ts
```

Expected: 0 failures.

- [ ] **Step 10.4: Commit**

```bash
cd aimeat
git add test/playwright/generator-interview.spec.ts
git commit -m "test: add Playwright tests for generator agent banner and stop button"
```

---

## Task 11: Final validation

- [ ] **Step 11.1: Full E2E test run on both backends**

```bash
cd aimeat
pnpm test:e2e:mongodb 2>&1 | tail -20
pnpm test:e2e:sqlite 2>&1 | tail -20
```

Expected: 0 failures on both backends.

- [ ] **Step 11.2: TypeScript clean build**

```bash
cd aimeat
npx tsc --noEmit
pnpm build
```

Expected: 0 errors.

- [ ] **Step 11.3: ESLint**

```bash
cd aimeat
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 11.4: Verify i18n sync**

Both `locales/en.json` and `locales/fi.json` must have the same key structure. Check that all keys added in Tasks 7 and 8 exist in both files.

- [ ] **Step 11.5: Verify openapi.yaml coverage**

All 11 new endpoints must have entries in `openapi.yaml`. Quick check:

```bash
grep "/v1/generator" openapi.yaml | grep -c "^\s*/"
# Should be >= 11
```

- [ ] **Step 11.6: Final commit**

```bash
cd aimeat
git add -p  # review any remaining unstaged changes
git commit -m "feat: agent-driven service generator — full pipeline with session, progress, and UI"
```
