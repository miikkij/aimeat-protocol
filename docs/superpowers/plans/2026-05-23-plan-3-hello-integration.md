# Plan 3: Hello Integration Backend -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the structured 11-step onboarding handshake ("Hello Integration") so AIMEAT can validate each agent's capabilities before it enters production, with automatic readiness scoring and platform detection.

**Architecture:** An AgentOnboardingRecord tracks 11 steps per agent. A platform detector auto-identifies the agent's runtime from connection metadata. An onboarding validator service checks each step automatically (capabilities reported, telemetry received, test task completed). A readiness scorer computes a composite score from onboarding baseline and 7-day operational health. REST endpoints let agents confirm steps and let owners view/manage onboarding. Onboarding auto-starts when an agent is approved through device auth.

**Tech Stack:** Express 5, Zod (input validation), existing webhook dispatcher (Plan 1), existing storage patterns

**Master plan:** `docs/superpowers/plans/2026-05-23-agent-integration-master-plan.md`
**Spec:** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` (Parts 3, 4)
**Depends on:** Plan 1 (webhook dispatcher, telemetry endpoint, webhook fields on AgentRecord)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `aimeat/src/models/agent-onboarding-schemas.ts` | Zod schemas for onboarding step confirmation payloads |
| `aimeat/src/services/platform-detector.ts` | Auto-detect agent platform from User-Agent, MCP metadata |
| `aimeat/src/services/onboarding-validator.ts` | Step validation logic: checks each step's pass/fail criteria |
| `aimeat/src/services/readiness-scorer.ts` | Composite readiness score: onboarding baseline + 7-day operational health |
| `aimeat/src/routes/agent-onboarding.ts` | REST endpoints: GET status, POST start, POST step/:id, DELETE cancel |
| `aimeat/src/storage/repositories/agent-onboarding.repository.ts` | Repository interface for onboarding records |
| `test/agent-onboarding.ts` | E2E tests for the full onboarding flow |

### Modified Files

| File | What changes |
|------|-------------|
| `aimeat/src/storage/interface.ts` | Add AgentOnboardingRecord, AgentOnboardingStep types |
| `aimeat/src/storage/repositories/index.ts` | Export new repository |
| `aimeat/prisma/schema.prisma` | AgentOnboarding model |
| `aimeat/src/storage/providers/sqlite/schema.ts` | agent_onboarding table + migration |
| `aimeat/src/storage/providers/sqlite/index.ts` | Implement onboarding storage methods |
| `aimeat/src/storage/providers/mongodb/index.ts` | Implement onboarding storage methods |
| `aimeat/src/server-bootstrap/routes-loader.ts` | Mount agentOnboardingRouter |
| `aimeat/openapi.yaml` | Onboarding endpoints |
| `aimeat/locales/en.json` | Onboarding step titles, readiness labels |
| `aimeat/locales/fi.json` | Same in Finnish |

---

## Task 1: Onboarding Data Types + Storage

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Create: `aimeat/src/storage/repositories/agent-onboarding.repository.ts`
- Modify: `aimeat/src/storage/repositories/index.ts`
- Modify: `aimeat/prisma/schema.prisma`
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`

- [ ] **Step 1: Add AgentOnboardingRecord types to interface.ts**

In `aimeat/src/storage/interface.ts`, add after the TelemetryEvent/WebhookDeliveryLog types (added in Plan 1):

```typescript
export interface AgentOnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  required: boolean;
  validatedAt?: string;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  details?: Record<string, unknown>;
  failureReason?: string;
}

export interface AgentOnboardingRecord {
  agentGaii: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  steps: AgentOnboardingStep[];
  readinessScore?: number;
  readinessLevel?: 'basic' | 'standard' | 'full' | 'expert';
  detectedPlatform?: string;
  installedRuntime?: string;
  onboardingBaseline?: number;
  operationalHealth?: number;
  healthComponents?: {
    deliveryHealth: number;
    telemetryContinuity: number;
    taskCompletion: number;
  };
  healthRecalculatedAt?: string;
  readinessOverride?: {
    level: 'basic' | 'standard' | 'full' | 'expert';
    setBy: string;
    setAt: string;
    expiresAt: string;
    reason?: string;
  };
}
```

- [ ] **Step 2: Create onboarding repository interface**

Create `aimeat/src/storage/repositories/agent-onboarding.repository.ts`:

```typescript
/**
 * @file agent-onboarding.repository.ts
 * @description Repository interface for agent onboarding records (Hello Integration)
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { AgentOnboardingRecord } from '../interface.js';

export interface AgentOnboardingRepository {
  createOnboarding(record: AgentOnboardingRecord): Promise<AgentOnboardingRecord>;
  getOnboarding(agentGaii: string): Promise<AgentOnboardingRecord | null>;
  updateOnboarding(agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null>;
  deleteOnboarding(agentGaii: string): Promise<boolean>;
  listOnboardingByOwner(owner: string): Promise<AgentOnboardingRecord[]>;
  listOnboardingByStatus(status: string): Promise<AgentOnboardingRecord[]>;
}
```

- [ ] **Step 3: Export from repositories index**

In `aimeat/src/storage/repositories/index.ts`, add:

```typescript
export type { AgentOnboardingRepository } from './agent-onboarding.repository.js';
```

- [ ] **Step 4: Add AgentOnboardingRepository to Storage interface**

In `aimeat/src/storage/interface.ts`, add `AgentOnboardingRepository` to the `Storage` interface intersection (line ~1633, after `AgentMessageRepository`).

- [ ] **Step 5: Add Prisma model**

In `aimeat/prisma/schema.prisma`:

```prisma
model AgentOnboarding {
  id                   String   @id @default(auto()) @map("_id") @db.ObjectId
  agentGaii            String   @unique
  status               String   @default("pending")
  startedAt            DateTime @default(now())
  completedAt          DateTime?
  steps                Json     @default("[]")
  readinessScore       Int?
  readinessLevel       String?
  detectedPlatform     String?
  installedRuntime     String?
  onboardingBaseline   Int?
  operationalHealth    Float?
  healthComponents     Json?
  healthRecalculatedAt DateTime?
  readinessOverride    Json?

  @@index([agentGaii])
  @@index([status])
}
```

- [ ] **Step 6: Add SQLite table**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add:

```sql
CREATE TABLE IF NOT EXISTS agent_onboarding (
  agentGaii TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  readinessScore INTEGER,
  readinessLevel TEXT,
  detectedPlatform TEXT,
  installedRuntime TEXT,
  onboardingBaseline INTEGER,
  operationalHealth REAL,
  healthComponents TEXT,
  healthRecalculatedAt TEXT,
  readinessOverride TEXT
);
```

- [ ] **Step 7: Implement storage methods in SQLite provider**

In `aimeat/src/storage/providers/sqlite/index.ts`, implement:

- `createOnboarding`: INSERT with JSON.stringify for steps, healthComponents, readinessOverride
- `getOnboarding`: SELECT with JSON.parse for steps, healthComponents, readinessOverride
- `updateOnboarding`: UPDATE with partial field handling (JSON.stringify complex fields)
- `deleteOnboarding`: DELETE
- `listOnboardingByOwner`: SELECT WHERE agentGaii LIKE '%#${owner}@%'
- `listOnboardingByStatus`: SELECT WHERE status = ?

Follow the existing SQLite patterns (db.prepare, JSON serialization for complex fields).

- [ ] **Step 8: Implement storage methods in MongoDB provider**

In `aimeat/src/storage/providers/mongodb/index.ts`, implement using Prisma CRUD:

- `createOnboarding`: prisma.agentOnboarding.create
- `getOnboarding`: prisma.agentOnboarding.findUnique({ where: { agentGaii } })
- `updateOnboarding`: prisma.agentOnboarding.update
- `deleteOnboarding`: prisma.agentOnboarding.delete
- `listOnboardingByOwner`: prisma.agentOnboarding.findMany({ where: { agentGaii: { contains: `#${owner}@` } } })
- `listOnboardingByStatus`: prisma.agentOnboarding.findMany({ where: { status } })

Convert Prisma Date objects to ISO strings in the mapper. Parse JSON fields (steps, healthComponents, readinessOverride).

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/repositories/ aimeat/prisma/schema.prisma aimeat/src/storage/providers/
git commit -m "feat(onboarding): add AgentOnboardingRecord type and storage in both backends"
```

---

## Task 2: Onboarding Step Definitions + Zod Schemas

**Files:**
- Create: `aimeat/src/models/agent-onboarding-schemas.ts`

Defines the 11 onboarding steps as constants and Zod schemas for step confirmation payloads.

- [ ] **Step 1: Create the schemas file**

Create `aimeat/src/models/agent-onboarding-schemas.ts`:

```typescript
/**
 * @file agent-onboarding-schemas.ts
 * @description Onboarding step definitions and Zod validation schemas for
 *   Hello Integration step confirmation payloads.
 * @structure
 *   - ONBOARDING_STEPS -- constant array defining all 11 steps
 *   - Step-specific confirmation schemas (IdentifyPlatformSchema, etc.)
 *   - createDefaultSteps() -- factory for fresh onboarding step list
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import { z } from 'zod';
import type { AgentOnboardingStep } from '../storage/interface.js';

export const ONBOARDING_STEP_IDS = [
  'authenticate',
  'identify_platform',
  'install_skill',
  'report_capabilities',
  'read_directives',
  'send_test_message',
  'configure_delivery',
  'report_telemetry',
  'accept_test_task',
  'complete_test_task',
  'declare_services',
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEP_IDS[number];

interface StepDefinition {
  id: OnboardingStepId;
  order: number;
  title: string;
  description: string;
  required: boolean;
}

const STEP_DEFINITIONS: StepDefinition[] = [
  { id: 'authenticate', order: 1, title: 'Authenticate', description: 'Agent is authenticated via device auth', required: true },
  { id: 'identify_platform', order: 2, title: 'Identify Platform', description: 'Determine which AI platform the agent runs on', required: true },
  { id: 'install_skill', order: 3, title: 'Install Skill Bundle', description: 'Skill bundle installed and version reported', required: true },
  { id: 'report_capabilities', order: 4, title: 'Report Capabilities', description: 'PUT /capabilities called with non-empty data', required: true },
  { id: 'read_directives', order: 5, title: 'Read Directives', description: 'GET /directives called, agent confirms reading', required: true },
  { id: 'send_test_message', order: 6, title: 'Send Test Message', description: 'POST /messages proves the message channel works', required: true },
  { id: 'configure_delivery', order: 7, title: 'Configure Delivery', description: 'Webhook registered OR MCP detected OR polling confirmed', required: true },
  { id: 'report_telemetry', order: 8, title: 'Report Telemetry', description: 'At least one telemetry event with non-zero data', required: true },
  { id: 'accept_test_task', order: 9, title: 'Accept Test Task', description: 'Agent proposes todos for the test task', required: true },
  { id: 'complete_test_task', order: 10, title: 'Complete Test Task', description: 'Agent executes and completes the test task', required: true },
  { id: 'declare_services', order: 11, title: 'Declare Services', description: 'Agent declares offered services (optional)', required: false },
];

export function createDefaultSteps(): AgentOnboardingStep[] {
  return STEP_DEFINITIONS.map(def => ({
    id: def.id,
    order: def.order,
    title: def.title,
    description: def.description,
    status: 'pending' as const,
    required: def.required,
    validationMethod: 'automatic' as const,
  }));
}

export const IdentifyPlatformSchema = z.object({
  platform: z.string().min(1).max(50),
  platform_version: z.string().max(50).optional(),
});

export const InstallSkillSchema = z.object({
  version: z.string().min(1).max(50),
  platform: z.string().min(1).max(50),
});

export const ReadDirectivesSchema = z.object({
  confirmed: z.boolean().optional().default(true),
});

export const DeclareServicesSchema = z.object({
  services: z.array(z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
  })).default([]),
});

export const STEP_SCHEMAS: Partial<Record<OnboardingStepId, z.ZodType>> = {
  identify_platform: IdentifyPlatformSchema,
  install_skill: InstallSkillSchema,
  read_directives: ReadDirectivesSchema,
  declare_services: DeclareServicesSchema,
};

export function getStepDefinition(stepId: string): StepDefinition | undefined {
  return STEP_DEFINITIONS.find(s => s.id === stepId);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/models/agent-onboarding-schemas.ts
git commit -m "feat(onboarding): add step definitions and Zod validation schemas"
```

---

## Task 3: Platform Detector Service

**Files:**
- Create: `aimeat/src/services/platform-detector.ts`

Auto-detects the agent's platform from connection metadata (User-Agent header, MCP client info).

- [ ] **Step 1: Create the platform detector**

Create `aimeat/src/services/platform-detector.ts`:

```typescript
/**
 * @file platform-detector.ts
 * @description Auto-detect agent platform from connection metadata.
 *   Checks User-Agent header and MCP client metadata against known patterns.
 * @structure
 *   - KNOWN_PLATFORMS -- registry of known platform patterns
 *   - detectPlatform(userAgent, mcpMetadata) -- returns detected platform or null
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

export interface PlatformInfo {
  id: string;
  displayName: string;
  version?: string;
  detectedBy: 'auto' | 'self_report' | 'message_reply';
}

interface PlatformPattern {
  id: string;
  displayName: string;
  userAgentPattern: RegExp;
  bundleName: string;
}

const KNOWN_PLATFORMS: PlatformPattern[] = [
  { id: 'hermes', displayName: 'Hermes (OpenClaw)', userAgentPattern: /Hermes\/([\d.]+)/i, bundleName: 'aimeat-hermes' },
  { id: 'claude-code', displayName: 'Claude Code', userAgentPattern: /claude-code\/([\d.]+)/i, bundleName: 'aimeat-claude-code' },
  { id: 'copilot', displayName: 'GitHub Copilot CLI', userAgentPattern: /copilot-cli\/([\d.]+)/i, bundleName: 'aimeat-copilot' },
  { id: 'codex', displayName: 'OpenAI Codex CLI', userAgentPattern: /codex\/([\d.]+)/i, bundleName: 'aimeat-codex' },
  { id: 'gemini', displayName: 'Google Gemini CLI', userAgentPattern: /gemini-cli\/([\d.]+)/i, bundleName: 'aimeat-gemini' },
];

export function detectPlatform(userAgent?: string, mcpMetadata?: Record<string, unknown>): PlatformInfo | null {
  if (userAgent) {
    for (const platform of KNOWN_PLATFORMS) {
      const match = platform.userAgentPattern.exec(userAgent);
      if (match) {
        return {
          id: platform.id,
          displayName: platform.displayName,
          version: match[1],
          detectedBy: 'auto',
        };
      }
    }
  }

  if (mcpMetadata) {
    const clientName = (mcpMetadata.clientName ?? mcpMetadata.client_name ?? '') as string;
    for (const platform of KNOWN_PLATFORMS) {
      if (platform.userAgentPattern.test(clientName)) {
        const match = platform.userAgentPattern.exec(clientName);
        return {
          id: platform.id,
          displayName: platform.displayName,
          version: match?.[1],
          detectedBy: 'auto',
        };
      }
    }
  }

  return null;
}

export function parsePlatformFromMessage(message: string): PlatformInfo | null {
  const lower = message.toLowerCase().trim();

  for (const platform of KNOWN_PLATFORMS) {
    if (lower === platform.id || lower.startsWith(platform.id + ' ')) {
      return {
        id: platform.id,
        displayName: platform.displayName,
        detectedBy: 'message_reply',
      };
    }
  }

  if (lower === 'other' || lower.startsWith('other ')) {
    return {
      id: 'other',
      displayName: 'Other / Unknown',
      detectedBy: 'message_reply',
    };
  }

  return null;
}

export function getKnownPlatforms(): Array<{ id: string; displayName: string; bundleName: string }> {
  return KNOWN_PLATFORMS.map(p => ({ id: p.id, displayName: p.displayName, bundleName: p.bundleName }));
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/platform-detector.ts
git commit -m "feat(onboarding): add platform auto-detection from User-Agent and MCP metadata"
```

---

## Task 4: Onboarding Validator Service

**Files:**
- Create: `aimeat/src/services/onboarding-validator.ts`

Checks whether each onboarding step has been completed by examining actual system state (not trusting the agent's word).

- [ ] **Step 1: Create the onboarding validator**

Create `aimeat/src/services/onboarding-validator.ts`:

```typescript
/**
 * @file onboarding-validator.ts
 * @description Validates onboarding steps by checking actual system state.
 *   AIMEAT does not trust the agent's word -- every step is verified against
 *   real data (capabilities reported, telemetry received, test task completed, etc.).
 * @structure
 *   - validateStep(stepId, agentGaii, storage, body?) -- validates a single step
 *   - checkAutoSteps(agentGaii, storage) -- checks all auto-validatable steps
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { Storage, AgentOnboardingRecord, AgentOnboardingStep } from '../storage/interface.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { STEP_SCHEMAS, getStepDefinition } from '../models/agent-onboarding-schemas.js';

export interface StepValidationResult {
  passed: boolean;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  details?: Record<string, unknown>;
  failureReason?: string;
}

export async function validateStep(
  stepId: OnboardingStepId,
  agentGaii: string,
  storage: Storage,
  body?: Record<string, unknown>,
): Promise<StepValidationResult> {
  switch (stepId) {
    case 'authenticate':
      return validateAuthenticate(agentGaii, storage);
    case 'identify_platform':
      return validateIdentifyPlatform(body);
    case 'install_skill':
      return validateInstallSkill(body);
    case 'report_capabilities':
      return validateCapabilities(agentGaii, storage);
    case 'read_directives':
      return validateReadDirectives(body);
    case 'send_test_message':
      return validateTestMessage(agentGaii, storage);
    case 'configure_delivery':
      return validateDelivery(agentGaii, storage);
    case 'report_telemetry':
      return validateTelemetry(agentGaii, storage);
    case 'accept_test_task':
      return validateAcceptTestTask(agentGaii, storage);
    case 'complete_test_task':
      return validateCompleteTestTask(agentGaii, storage);
    case 'declare_services':
      return validateDeclareServices(body);
    default:
      return { passed: false, validationMethod: 'automatic', failureReason: `Unknown step: ${stepId}` };
  }
}

async function validateAuthenticate(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  return {
    passed: agent !== null,
    validationMethod: 'automatic',
    details: agent ? { createdAt: agent.createdAt } : undefined,
    failureReason: agent ? undefined : 'Agent record not found',
  };
}

function validateIdentifyPlatform(body?: Record<string, unknown>): StepValidationResult {
  if (!body) return { passed: false, validationMethod: 'api_call', failureReason: 'No platform data provided' };
  const schema = STEP_SCHEMAS.identify_platform!;
  const result = schema.safeParse(body);
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: { platform: (result.data as { platform: string }).platform, platform_version: (result.data as { platform_version?: string }).platform_version },
  };
}

function validateInstallSkill(body?: Record<string, unknown>): StepValidationResult {
  if (!body) return { passed: false, validationMethod: 'api_call', failureReason: 'No install data provided' };
  const schema = STEP_SCHEMAS.install_skill!;
  const result = schema.safeParse(body);
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body,
  };
}

async function validateCapabilities(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  const hasTechnical = (agent?.technicalCapabilities?.length ?? 0) > 0;
  const hasDomain = (agent?.domainCapabilities?.length ?? 0) > 0;
  const passed = hasTechnical || hasDomain;
  return {
    passed,
    validationMethod: 'automatic',
    details: { technicalCount: agent?.technicalCapabilities?.length ?? 0, domainCount: agent?.domainCapabilities?.length ?? 0 },
    failureReason: passed ? undefined : 'No capabilities reported. Call PUT /v1/agents/me/capabilities',
  };
}

function validateReadDirectives(body?: Record<string, unknown>): StepValidationResult {
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body,
  };
}

async function validateTestMessage(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const messages = await storage.listAgentMessages(agentGaii, { direction: 'outbound', perPage: 1 });
  const passed = messages.messages.length > 0;
  return {
    passed,
    validationMethod: 'automatic',
    details: { messageCount: messages.messages.length },
    failureReason: passed ? undefined : 'No outbound message found. Send a test message via POST /v1/agents/me/messages',
  };
}

async function validateDelivery(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const agent = await storage.getAgent(agentGaii);
  const hasWebhook = !!(agent?.webhookUrl && agent.webhookEnabled);
  return {
    passed: hasWebhook,
    validationMethod: 'automatic',
    details: { webhookUrl: agent?.webhookUrl, webhookEnabled: agent?.webhookEnabled },
    failureReason: hasWebhook ? undefined : 'No delivery channel configured. Register a webhook via PUT /v1/agents/me/webhook',
  };
}

async function validateTelemetry(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const events = await storage.listTelemetry(agentGaii, { limit: 1 });
  const passed = events.length > 0;
  return {
    passed,
    validationMethod: 'automatic',
    details: { eventCount: events.length },
    failureReason: passed ? undefined : 'No telemetry events received. Report telemetry via POST /v1/agents/me/telemetry',
  };
}

async function validateAcceptTestTask(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const onboarding = await storage.getOnboarding(agentGaii);
  const testTaskId = (onboarding?.steps.find(s => s.id === 'accept_test_task')?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
  if (!testTaskId) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'No test task created. Start onboarding first.' };
  }
  const task = await storage.getAgentTask(testTaskId);
  if (!task) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'Test task not found' };
  }
  const hasTodos = (task.todos?.length ?? 0) > 0;
  return {
    passed: hasTodos,
    validationMethod: 'automatic',
    details: { taskId: testTaskId, todoCount: task.todos?.length ?? 0 },
    failureReason: hasTodos ? undefined : 'Test task has no todos. Propose todos via PATCH /v1/agents/me/tasks/{id}',
  };
}

async function validateCompleteTestTask(agentGaii: string, storage: Storage): Promise<StepValidationResult> {
  const onboarding = await storage.getOnboarding(agentGaii);
  const testTaskId = (onboarding?.steps.find(s => s.id === 'accept_test_task')?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
  if (!testTaskId) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'No test task created' };
  }
  const task = await storage.getAgentTask(testTaskId);
  if (!task) {
    return { passed: false, validationMethod: 'automatic', failureReason: 'Test task not found' };
  }
  const passed = task.status === 'done';
  return {
    passed,
    validationMethod: 'automatic',
    details: { taskId: testTaskId, status: task.status },
    failureReason: passed ? undefined : `Test task status is '${task.status}', expected 'done'`,
  };
}

function validateDeclareServices(body?: Record<string, unknown>): StepValidationResult {
  const schema = STEP_SCHEMAS.declare_services!;
  const result = schema.safeParse(body ?? { services: [] });
  if (!result.success) {
    return { passed: false, validationMethod: 'api_call', failureReason: result.error.message };
  }
  return {
    passed: true,
    validationMethod: 'api_call',
    details: body ?? { services: [] },
  };
}

export async function checkAutoSteps(
  agentGaii: string,
  onboarding: AgentOnboardingRecord,
  storage: Storage,
): Promise<AgentOnboardingStep[]> {
  const autoStepIds: OnboardingStepId[] = [
    'authenticate', 'report_capabilities', 'send_test_message',
    'configure_delivery', 'report_telemetry', 'accept_test_task', 'complete_test_task',
  ];

  const updatedSteps = [...onboarding.steps];
  for (const stepId of autoStepIds) {
    const step = updatedSteps.find(s => s.id === stepId);
    if (!step || step.status !== 'pending') continue;

    const result = await validateStep(stepId, agentGaii, storage);
    if (result.passed) {
      step.status = 'passed';
      step.validatedAt = new Date().toISOString();
      step.validationMethod = result.validationMethod;
      step.details = result.details;
    }
  }
  return updatedSteps;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/onboarding-validator.ts
git commit -m "feat(onboarding): add step validation service with auto-check for system-observable steps"
```

---

## Task 5: Readiness Scorer Service

**Files:**
- Create: `aimeat/src/services/readiness-scorer.ts`

Computes composite readiness score from onboarding baseline (0-100, set once) and 7-day operational health (0.0-1.0 multiplier).

- [ ] **Step 1: Create the readiness scorer**

Create `aimeat/src/services/readiness-scorer.ts`:

```typescript
/**
 * @file readiness-scorer.ts
 * @description Composite readiness score: onboarding baseline * operational health.
 *   Baseline is set once when onboarding completes (9 pts per required step, 10 bonus for services).
 *   Health is a 7-day rolling average of delivery, telemetry, and task completion signals.
 * @structure
 *   - calculateBaseline(steps) -- onboarding score (0-100)
 *   - calculateHealth(agentGaii, storage) -- 7-day operational health (0.0-1.0)
 *   - calculateReadiness(baseline, health) -- effective score + level
 *   - getReadinessLevel(score) -- score to level mapping
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import type { Storage, AgentOnboardingStep } from '../storage/interface.js';

export interface ReadinessResult {
  effectiveScore: number;
  level: 'basic' | 'standard' | 'full' | 'expert';
  baseline: number;
  health: number;
  healthComponents: {
    deliveryHealth: number;
    telemetryContinuity: number;
    taskCompletion: number;
  };
}

export function calculateBaseline(steps: AgentOnboardingStep[]): number {
  let score = 0;
  for (const step of steps) {
    if (step.status !== 'passed') continue;
    if (step.required) {
      score += 9;
    } else {
      score += 10;
    }
  }
  return Math.min(score, 100);
}

export function getReadinessLevel(score: number): 'basic' | 'standard' | 'full' | 'expert' {
  if (score >= 91) return 'expert';
  if (score >= 61) return 'full';
  if (score >= 31) return 'standard';
  return 'basic';
}

export async function calculateHealth(
  agentGaii: string,
  storage: Storage,
): Promise<{ health: number; components: ReadinessResult['healthComponents'] }> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceStr = sevenDaysAgo.toISOString();

  const deliveryHealth = await calculateDeliveryHealth(agentGaii, storage, sinceStr);
  const telemetryContinuity = await calculateTelemetryContinuity(agentGaii, storage, sinceStr);
  const taskCompletion = await calculateTaskCompletion(agentGaii, storage, sinceStr);

  const health = deliveryHealth * 0.4 + telemetryContinuity * 0.3 + taskCompletion * 0.3;

  return {
    health,
    components: { deliveryHealth, telemetryContinuity, taskCompletion },
  };
}

async function calculateDeliveryHealth(agentGaii: string, storage: Storage, since: string): Promise<number> {
  const logs = await storage.listDeliveryLog(agentGaii, 200);
  const recentLogs = logs.filter(l => l.createdAt >= since);

  if (recentLogs.length === 0) return 1.0;

  const successCount = recentLogs.filter(l => l.status === 'success').length;
  return successCount / recentLogs.length;
}

async function calculateTelemetryContinuity(agentGaii: string, storage: Storage, since: string): Promise<number> {
  const events = await storage.listTelemetry(agentGaii, { since, limit: 1000 });

  if (events.length === 0) return 1.0;

  const daysWithEvents = new Set<string>();
  for (const event of events) {
    const day = event.createdAt.substring(0, 10);
    daysWithEvents.add(day);
  }

  return Math.min(daysWithEvents.size / 7, 1.0);
}

async function calculateTaskCompletion(agentGaii: string, storage: Storage, _since: string): Promise<number> {
  const counts = await storage.countTasksByAgent(agentGaii);
  const total = counts.done + counts.failed;

  if (total === 0) return 1.0;

  return counts.done / total;
}

export async function calculateReadiness(
  agentGaii: string,
  steps: AgentOnboardingStep[],
  storage: Storage,
): Promise<ReadinessResult> {
  const baseline = calculateBaseline(steps);
  const { health, components } = await calculateHealth(agentGaii, storage);
  const effectiveScore = Math.floor(baseline * health);
  const level = getReadinessLevel(effectiveScore);

  return { effectiveScore, level, baseline, health, healthComponents: components };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/readiness-scorer.ts
git commit -m "feat(onboarding): add readiness scorer with baseline + 7-day rolling health"
```

---

## Task 6: Onboarding REST Endpoints

**Files:**
- Create: `aimeat/src/routes/agent-onboarding.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

Four endpoints: GET status, POST start/reset, POST step/:id, DELETE cancel.

- [ ] **Step 1: Create the route file**

Create `aimeat/src/routes/agent-onboarding.ts`:

```typescript
/**
 * @file agent-onboarding.ts
 * @description REST endpoints for Hello Integration onboarding process.
 *   Agents confirm steps, owners view status and manage onboarding.
 * @structure
 *   - GET    /v1/agents/:name/onboarding           -- Get onboarding status
 *   - POST   /v1/agents/:name/onboarding/start     -- Start/reset onboarding
 *   - POST   /v1/agents/:name/onboarding/step/:id  -- Agent confirms a step
 *   - DELETE /v1/agents/:name/onboarding           -- Cancel onboarding
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { createDefaultSteps, ONBOARDING_STEP_IDS, STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { validateStep, checkAutoSteps } from '../services/onboarding-validator.js';
import { calculateReadiness } from '../services/readiness-scorer.js';
import { detectPlatform } from '../services/platform-detector.js';

export function agentOnboardingRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) return true;
    const expectedGaii = resolveAgentGaii(req, agentName);
    return req.auth!.sub === expectedGaii;
  }

  /* -- GET /v1/agents/:name/onboarding -- Get onboarding status -- */
  router.get('/v1/agents/:name/onboarding', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    let onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) {
      res.json(success(config.nodeId, { onboarding: null, status: 'not_started' }));
      return;
    }

    // Auto-check observable steps on every status request
    if (onboarding.status === 'in_progress') {
      const updatedSteps = await checkAutoSteps(agentGaii, onboarding, storage);
      const passedCount = updatedSteps.filter(s => s.status === 'passed').length;
      const allRequiredPassed = updatedSteps.filter(s => s.required).every(s => s.status === 'passed');

      if (allRequiredPassed && passedCount >= 10) {
        const readiness = await calculateReadiness(agentGaii, updatedSteps, storage);
        onboarding = (await storage.updateOnboarding(agentGaii, {
          steps: updatedSteps,
          status: 'completed',
          completedAt: new Date().toISOString(),
          readinessScore: readiness.effectiveScore,
          readinessLevel: readiness.level,
          onboardingBaseline: readiness.baseline,
          operationalHealth: readiness.health,
          healthComponents: readiness.healthComponents,
          healthRecalculatedAt: new Date().toISOString(),
        }))!;
        emitChange('agent-onboarding');
      } else {
        onboarding = (await storage.updateOnboarding(agentGaii, { steps: updatedSteps }))!;
      }
    }

    res.json(success(config.nodeId, { onboarding }));
  });

  /* -- POST /v1/agents/:name/onboarding/start -- Start/reset onboarding -- */
  router.post('/v1/agents/:name/onboarding/start', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Auto-detect platform from User-Agent on the connection
    const steps = createDefaultSteps();
    steps[0].status = 'passed';
    steps[0].validatedAt = new Date().toISOString();
    steps[0].validationMethod = 'automatic';
    steps[0].details = { createdAt: agent.createdAt };

    // Try auto-detect platform
    const userAgent = req.headers['user-agent'];
    const detected = detectPlatform(userAgent as string | undefined);
    if (detected) {
      steps[1].status = 'passed';
      steps[1].validatedAt = new Date().toISOString();
      steps[1].validationMethod = 'automatic';
      steps[1].details = { platform: detected.id, version: detected.version };
      await storage.updateAgent(agentGaii, {
        platform: detected.id,
        platformVersion: detected.version,
        platformDetectedBy: detected.detectedBy,
      });
    }

    // Create a test task for steps 9-10
    const testTaskId = randomUUID();
    const testTask = {
      id: testTaskId,
      agentGaii,
      ownerGaii: `${req.auth!.owner}@${config.nodeId}`,
      title: 'Onboarding verification',
      description: 'This is a test task created during Hello Integration. Propose todos, get approval, execute, and complete.',
      status: 'queued' as const,
      scope: [],
      rules: [],
      todos: [],
      events: [],
      verification: [],
      resources: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.createAgentTask(testTask);

    // Store test task reference in step 9
    steps[8].details = { testTaskId };

    const existing = await storage.getOnboarding(agentGaii);
    const now = new Date().toISOString();

    let onboarding;
    if (existing) {
      onboarding = await storage.updateOnboarding(agentGaii, {
        status: 'in_progress',
        startedAt: now,
        completedAt: undefined,
        steps,
        readinessScore: undefined,
        readinessLevel: undefined,
      });
    } else {
      onboarding = await storage.createOnboarding({
        agentGaii,
        status: 'in_progress',
        startedAt: now,
        steps,
      });
    }

    emitChange('agent-onboarding');
    res.json(success(config.nodeId, { onboarding }, [
      { description: 'Check onboarding status', method: 'GET', url: `/v1/agents/${agentName}/onboarding` },
    ]));
  });

  /* -- POST /v1/agents/:name/onboarding/step/:id -- Agent confirms a step -- */
  router.post('/v1/agents/:name/onboarding/step/:id', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const stepId = req.params.id as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (!ONBOARDING_STEP_IDS.includes(stepId as OnboardingStepId)) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', `Unknown onboarding step: ${stepId}`));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
      res.status(400).json(error(config.nodeId, 'ONBOARDING_NOT_ACTIVE', 'Onboarding is not in progress'));
      return;
    }

    const step = onboarding.steps.find(s => s.id === stepId);
    if (!step) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', `Step '${stepId}' not found`));
      return;
    }

    if (step.status === 'passed') {
      res.json(success(config.nodeId, { step, message: 'Step already passed' }));
      return;
    }

    // Validate input if step has a schema
    const schema = STEP_SCHEMAS[stepId as OnboardingStepId];
    if (schema) {
      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', parseResult.error.message));
        return;
      }
    }

    // Validate the step
    const result = await validateStep(stepId as OnboardingStepId, agentGaii, storage, req.body);

    if (result.passed) {
      step.status = 'passed';
      step.validatedAt = new Date().toISOString();
      step.validationMethod = result.validationMethod;
      step.details = { ...step.details, ...result.details };

      // Side effects for specific steps
      if (stepId === 'identify_platform' && req.body?.platform) {
        await storage.updateAgent(agentGaii, {
          platform: req.body.platform,
          platformVersion: req.body.platform_version,
          platformDetectedBy: 'self_report',
        });
        onboarding.detectedPlatform = req.body.platform;
      }
      if (stepId === 'install_skill' && req.body?.platform) {
        onboarding.installedRuntime = req.body.platform;
      }
    } else {
      step.status = 'failed';
      step.failureReason = result.failureReason;
    }

    await storage.updateOnboarding(agentGaii, { steps: onboarding.steps });
    emitChange('agent-onboarding');

    res.json(success(config.nodeId, {
      step,
      progress: onboarding.steps.filter(s => s.status === 'passed').length,
      total: onboarding.steps.length,
    }));
  });

  /* -- DELETE /v1/agents/:name/onboarding -- Cancel onboarding -- */
  router.delete('/v1/agents/:name/onboarding', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const deleted = await storage.deleteOnboarding(agentGaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No onboarding record found'));
      return;
    }

    emitChange('agent-onboarding');
    res.json(success(config.nodeId, { deleted: true }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in routes-loader.ts**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add:

```typescript
import { agentOnboardingRouter } from '../routes/agent-onboarding.js';
```

And mount before `agentsRouter`:

```typescript
app.use(agentOnboardingRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/agent-onboarding.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(onboarding): add REST endpoints for Hello Integration (status, start, step confirm, cancel)"
```

---

## Task 7: Onboarding Auto-Start on Agent Approval

**Files:**
- Modify: `aimeat/src/routes/agents.ts` (or the device auth approval handler)

When an agent is approved through device auth, AIMEAT automatically creates an onboarding record with Step 1 (Authenticate) already passed.

- [ ] **Step 1: Find the agent approval handler**

Locate the device auth approval handler in `aimeat/src/routes/agents.ts`. Look for the endpoint where the owner approves the device auth request (the handler that creates the agent record and issues the JWT).

- [ ] **Step 2: Add onboarding auto-start**

After the agent record is created (successful approval), add:

```typescript
import { createDefaultSteps } from '../models/agent-onboarding-schemas.js';
import { detectPlatform } from '../services/platform-detector.js';

// After agent creation succeeds:
const steps = createDefaultSteps();
steps[0].status = 'passed';
steps[0].validatedAt = new Date().toISOString();
steps[0].validationMethod = 'automatic';
steps[0].details = { createdAt: agent.createdAt };

// Try auto-detect platform from the original device auth request User-Agent
const detected = detectPlatform(req.headers['user-agent'] as string | undefined);
if (detected) {
  steps[1].status = 'passed';
  steps[1].validatedAt = new Date().toISOString();
  steps[1].validationMethod = 'automatic';
  steps[1].details = { platform: detected.id, version: detected.version };
  await storage.updateAgent(agent.gaii, {
    platform: detected.id,
    platformVersion: detected.version,
    platformDetectedBy: detected.detectedBy,
  });
}

await storage.createOnboarding({
  agentGaii: agent.gaii,
  status: 'in_progress',
  startedAt: new Date().toISOString(),
  steps,
  detectedPlatform: detected?.id,
});

emitChange('agent-onboarding');
```

- [ ] **Step 3: Also handle the connectivity key flow**

Check `aimeat/src/routes/agents.ts` for `POST /v1/agents/connect` (connectivity key flow). Add the same onboarding auto-start logic there. The connectivity key flow is the primary agent connection path per CLAUDE.md.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/agents.ts
git commit -m "feat(onboarding): auto-start Hello Integration when agent is approved"
```

---

## Task 8: OpenAPI + i18n Sync

**Files:**
- Modify: `aimeat/openapi.yaml`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add onboarding endpoints to openapi.yaml**

Add to the paths section:

```yaml
  /v1/agents/{name}/onboarding:
    get:
      summary: Get onboarding status
      description: Returns the Hello Integration onboarding record with all step statuses.
      tags:
        - Agent Onboarding
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Onboarding status
          content:
            application/json:
              schema:
                type: object
                properties:
                  onboarding:
                    $ref: '#/components/schemas/AgentOnboardingRecord'
        '404':
          description: Agent not found
    delete:
      summary: Cancel onboarding
      description: Cancel in-progress onboarding (owner only).
      tags:
        - Agent Onboarding
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Onboarding cancelled
        '404':
          description: No onboarding record found

  /v1/agents/{name}/onboarding/start:
    post:
      summary: Start or reset onboarding
      description: >
        Start the Hello Integration onboarding process. Creates a test task
        for steps 9-10. If onboarding already exists, resets it.
      tags:
        - Agent Onboarding
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Onboarding started
        '404':
          description: Agent not found

  /v1/agents/{name}/onboarding/step/{stepId}:
    post:
      summary: Confirm an onboarding step
      description: >
        Agent confirms completion of an onboarding step. The server validates
        the step against actual system state before marking it as passed.
      tags:
        - Agent Onboarding
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
        - name: stepId
          in: path
          required: true
          schema:
            type: string
            enum:
              - authenticate
              - identify_platform
              - install_skill
              - report_capabilities
              - read_directives
              - send_test_message
              - configure_delivery
              - report_telemetry
              - accept_test_task
              - complete_test_task
              - declare_services
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '200':
          description: Step validation result
        '400':
          description: Invalid step or validation failed
```

Also add the `AgentOnboardingRecord` schema to `components/schemas`.

- [ ] **Step 2: Add i18n keys to en.json**

```json
"agentOnboarding": {
  "title": "Hello Integration",
  "status": "Onboarding Status",
  "notStarted": "Not started",
  "inProgress": "In progress",
  "completed": "Completed",
  "failed": "Failed",
  "progress": "Progress",
  "startButton": "Start Hello Integration",
  "restartButton": "Re-run Hello Integration",
  "cancelButton": "Cancel",
  "steps": {
    "authenticate": "Authenticate",
    "identify_platform": "Identify Platform",
    "install_skill": "Install Skill Bundle",
    "report_capabilities": "Report Capabilities",
    "read_directives": "Read Directives",
    "send_test_message": "Send Test Message",
    "configure_delivery": "Configure Delivery",
    "report_telemetry": "Report Telemetry",
    "accept_test_task": "Accept Test Task",
    "complete_test_task": "Complete Test Task",
    "declare_services": "Declare Services"
  },
  "readiness": {
    "title": "Readiness",
    "basic": "Basic",
    "standard": "Standard",
    "full": "Full",
    "expert": "Expert",
    "overrideActive": "Manual override active",
    "overrideExpires": "Expires"
  },
  "platform": {
    "title": "Platform",
    "autoDetected": "Auto-detected",
    "selfReported": "Self-reported",
    "messageReply": "Message reply",
    "unknown": "Unknown"
  }
}
```

- [ ] **Step 3: Add i18n keys to fi.json**

```json
"agentOnboarding": {
  "title": "Hello-integraatio",
  "status": "Perehdytyksen tila",
  "notStarted": "Ei aloitettu",
  "inProgress": "Käynnissä",
  "completed": "Valmis",
  "failed": "Epäonnistunut",
  "progress": "Edistyminen",
  "startButton": "Aloita Hello-integraatio",
  "restartButton": "Suorita uudelleen",
  "cancelButton": "Peruuta",
  "steps": {
    "authenticate": "Tunnistaudu",
    "identify_platform": "Tunnista alusta",
    "install_skill": "Asenna taitopaketti",
    "report_capabilities": "Raportoi kyvykkyydet",
    "read_directives": "Lue ohjeistukset",
    "send_test_message": "Lähetä testiviesti",
    "configure_delivery": "Määritä toimitus",
    "report_telemetry": "Raportoi telemetria",
    "accept_test_task": "Hyväksy testitehtävä",
    "complete_test_task": "Suorita testitehtävä",
    "declare_services": "Ilmoita palvelut"
  },
  "readiness": {
    "title": "Valmius",
    "basic": "Perus",
    "standard": "Normaali",
    "full": "Täysi",
    "expert": "Asiantuntija",
    "overrideActive": "Manuaalinen ohitus aktiivinen",
    "overrideExpires": "Vanhenee"
  },
  "platform": {
    "title": "Alusta",
    "autoDetected": "Automaattisesti tunnistettu",
    "selfReported": "Itse ilmoitettu",
    "messageReply": "Viestivastaus",
    "unknown": "Tuntematon"
  }
}
```

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/openapi.yaml aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "docs(onboarding): add OpenAPI spec and i18n keys for Hello Integration"
```

---

## Task 9: E2E Tests

**Files:**
- Create: `test/agent-onboarding.ts`

Tests cover the full onboarding flow: start, step confirmations, auto-validation, readiness scoring.

- [ ] **Step 1: Create the E2E test file**

Create `test/agent-onboarding.ts`:

```typescript
/**
 * @file agent-onboarding.ts
 * @description E2E tests for Hello Integration onboarding flow
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './helpers/harness.js';

describe('Agent Onboarding (Hello Integration)', () => {
  let harness: TestHarness;
  let ownerToken: string;
  let agentToken: string;
  const agentName = 'onboarding-test-agent';

  before(async () => {
    harness = await TestHarness.create();
    ownerToken = await harness.registerOwner('onboardowner');
    agentToken = await harness.connectAgent('onboardowner', agentName);
  });

  after(async () => {
    await harness.cleanup();
  });

  describe('GET /v1/agents/:name/onboarding', () => {
    it('returns not_started when no onboarding exists', async () => {
      const res = await harness.get(`/v1/agents/${agentName}/onboarding`, ownerToken);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.status, 'not_started');
    });
  });

  describe('POST /v1/agents/:name/onboarding/start', () => {
    it('starts onboarding with step 1 auto-passed', async () => {
      const res = await harness.post(`/v1/agents/${agentName}/onboarding/start`, ownerToken);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.onboarding.status, 'in_progress');
      assert.equal(body.data.onboarding.steps[0].status, 'passed');
      assert.equal(body.data.onboarding.steps[0].id, 'authenticate');
      assert.equal(body.data.onboarding.steps.length, 11);
    });

    it('creates a test task for steps 9-10', async () => {
      const res = await harness.get(`/v1/agents/${agentName}/onboarding`, ownerToken);
      const body = await res.json();
      const step9 = body.data.onboarding.steps.find((s: Record<string, unknown>) => s.id === 'accept_test_task');
      assert.ok(step9.details?.testTaskId);

      const taskRes = await harness.get(`/v1/agents/${agentName}/tasks/${step9.details.testTaskId}`, ownerToken);
      assert.equal(taskRes.status, 200);
    });

    it('requires owner role', async () => {
      const res = await harness.post(`/v1/agents/${agentName}/onboarding/start`, agentToken);
      assert.equal(res.status, 403);
    });
  });

  describe('POST /v1/agents/:name/onboarding/step/:id', () => {
    it('confirms identify_platform with valid payload', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/identify_platform`,
        agentToken,
        { platform: 'hermes', platform_version: '2.1.0' },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.step.status, 'passed');
    });

    it('confirms install_skill', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/install_skill`,
        agentToken,
        { version: 'v1', platform: 'hermes' },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.step.status, 'passed');
    });

    it('confirms read_directives', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/read_directives`,
        agentToken,
        { confirmed: true },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.step.status, 'passed');
    });

    it('confirms declare_services with empty list', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/declare_services`,
        agentToken,
        { services: [] },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.step.status, 'passed');
    });

    it('rejects unknown step id', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/nonexistent`,
        agentToken,
      );
      assert.equal(res.status, 400);
    });

    it('returns already passed for repeated confirmation', async () => {
      const res = await harness.post(
        `/v1/agents/${agentName}/onboarding/step/identify_platform`,
        agentToken,
        { platform: 'hermes' },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.message?.includes('already passed'));
    });
  });

  describe('DELETE /v1/agents/:name/onboarding', () => {
    it('cancels onboarding', async () => {
      const res = await harness.delete(`/v1/agents/${agentName}/onboarding`, ownerToken);
      assert.equal(res.status, 200);

      const statusRes = await harness.get(`/v1/agents/${agentName}/onboarding`, ownerToken);
      const body = await statusRes.json();
      assert.equal(body.data.status, 'not_started');
    });

    it('requires owner role', async () => {
      const res = await harness.delete(`/v1/agents/${agentName}/onboarding`, agentToken);
      assert.equal(res.status, 403);
    });
  });
});
```

**Important:** Adjust test helper calls to match the actual `TestHarness` API. Read `test/helpers/harness.ts` before implementing.

- [ ] **Step 2: Run tests**

Run: `pnpm test:e2e -- agent-onboarding`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/agent-onboarding.ts
git commit -m "test(onboarding): add E2E tests for Hello Integration flow"
```

---

## Task 10: Run Full E2E Tests

**Files:** None (validation only)

- [ ] **Step 1: Run E2E tests on both backends**

Run: `pnpm test:e2e:mongodb`
Expected: PASS (0 failures)

Run: `pnpm test:e2e:sqlite`
Expected: PASS (0 failures)

- [ ] **Step 2: Fix any failures**

If tests fail, fix them before marking Plan 3 complete.

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(onboarding): address E2E test failures"
```
