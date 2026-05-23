# Plan 2: Skill Bundle Generator -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a skill bundle generator that produces runtime-specific installable ZIP packages (starting with Hermes + generic fallback) so agents can install AIMEAT integration once instead of reading a boot prompt every session.

**Architecture:** A generator core produces shared `references/` markdown docs from node config + agent record. Runtime adapters (Hermes, generic) wrap the references with runtime-specific SKILL.md, scripts, and config files. The ZIP is served via a REST endpoint. A lightweight version check endpoint lets agents poll for updates without downloading the full bundle.

**Tech Stack:** Express 5, archiver (existing dependency), node:crypto (SHA-256 content hash), Zod (input validation)

**Master plan:** `docs/superpowers/plans/2026-05-23-agent-integration-master-plan.md`
**Spec:** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` (Part 2: Skill Bundle)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `aimeat/src/services/skill-bundle/generator.ts` | Core generator: produces `references/` markdown content from node config + agent record + directives |
| `aimeat/src/services/skill-bundle/hermes-adapter.ts` | Hermes adapter: SKILL.md, scripts/poll-inbox.sh, scripts/post-telemetry.sh, scripts/test-connection.sh, config/webhook-route.yaml, config/hooks.yaml |
| `aimeat/src/services/skill-bundle/generic-adapter.ts` | Generic fallback: minimal SKILL.md + references only, no runtime-specific config |
| `aimeat/src/services/skill-bundle/types.ts` | Shared types: BundleContent, RuntimeAdapter interface, BundleMetadata |
| `aimeat/src/routes/agent-skill-bundle.ts` | REST endpoint: GET /v1/agents/:name/skill-bundle, GET /v1/agents/:name/skill-bundle/version |
| `test/agent-skill-bundle.ts` | E2E tests for skill bundle endpoints |

### Modified Files

| File | What changes |
|------|-------------|
| `aimeat/src/server-bootstrap/routes-loader.ts` | Mount `agentSkillBundleRouter` |
| `aimeat/openapi.yaml` | Add skill-bundle endpoints |
| `aimeat/locales/en.json` | Skill bundle labels |
| `aimeat/locales/fi.json` | Same in Finnish |

---

## Task 1: Skill Bundle Types

**Files:**
- Create: `aimeat/src/services/skill-bundle/types.ts`

- [ ] **Step 1: Create the types file**

Create `aimeat/src/services/skill-bundle/types.ts`:

```typescript
/**
 * @file types.ts
 * @description Shared types for the skill bundle generator and runtime adapters.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

export interface BundleFile {
  path: string;
  content: string;
}

export interface BundleMetadata {
  bundleName: string;
  runtime: string;
  version: string;
  agentName: string;
  agentGaii: string;
  nodeId: string;
  nodeUrl: string;
  generatedAt: string;
}

export interface BundleContent {
  metadata: BundleMetadata;
  files: BundleFile[];
}

export interface BundleContext {
  agentName: string;
  agentGaii: string;
  nodeId: string;
  nodeUrl: string;
  directives: {
    purpose?: string;
    rules: Array<{ id: string; description: string; source: string }>;
    memoryAreas?: string[];
    resources?: Array<{ key: string; description?: string }>;
  };
  capabilities: {
    technical?: string[];
    domain?: string[];
  };
  webhookUrl?: string;
}

export interface RuntimeAdapter {
  readonly runtime: string;
  readonly bundleName: string;
  generate(ctx: BundleContext, references: BundleFile[]): BundleContent;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/skill-bundle/types.ts
git commit -m "feat(skill-bundle): add shared types for bundle generator and runtime adapters"
```

---

## Task 2: Core Generator -- References Content

**Files:**
- Create: `aimeat/src/services/skill-bundle/generator.ts`

The generator produces 6 shared reference documents from node config + agent record. These are identical across all runtimes.

- [ ] **Step 1: Create the generator**

Create `aimeat/src/services/skill-bundle/generator.ts`:

```typescript
/**
 * @file generator.ts
 * @description Core skill bundle generator. Produces shared references/ markdown
 *   documents from node config + agent record + directives. Runtime adapters wrap
 *   these references with runtime-specific SKILL.md, scripts, and config files.
 * @structure
 *   - generateReferences(ctx) -- Produces BundleFile[] for references/ directory
 *   - generateBundle(ctx, adapter) -- Full bundle: references + adapter output
 *   - computeBundleVersion(bundle) -- SHA-256 content hash for versioning
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

import { createHash } from 'node:crypto';
import type { BundleContext, BundleFile, BundleContent, RuntimeAdapter } from './types.js';

export function generateReferences(ctx: BundleContext): BundleFile[] {
  return [
    { path: 'references/api-overview.md', content: renderApiOverview(ctx) },
    { path: 'references/task-lifecycle.md', content: renderTaskLifecycle(ctx) },
    { path: 'references/message-protocol.md', content: renderMessageProtocol(ctx) },
    { path: 'references/telemetry-protocol.md', content: renderTelemetryProtocol(ctx) },
    { path: 'references/capability-report.md', content: renderCapabilityReport(ctx) },
    { path: 'references/error-protocol.md', content: renderErrorProtocol(ctx) },
  ];
}

export function generateBundle(ctx: BundleContext, adapter: RuntimeAdapter): BundleContent {
  const references = generateReferences(ctx);
  return adapter.generate(ctx, references);
}

export function computeBundleVersion(bundle: BundleContent): string {
  const hash = createHash('sha256');
  for (const file of bundle.files) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest('hex').substring(0, 12);
}

function renderApiOverview(ctx: BundleContext): string {
  return `# API Overview

## Identity
- Agent name: ${ctx.agentName}
- Agent GAII: ${ctx.agentGaii}
- Node: ${ctx.nodeUrl}
- Node ID: ${ctx.nodeId}

## Authentication
All API calls require a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer {your_jwt_token}
\`\`\`

## Base URL
\`\`\`
${ctx.nodeUrl}/v1
\`\`\`

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/agents/me/inbox\` | GET | Consolidated inbox (queued tasks, active tasks, pending messages) |
| \`/agents/me/inbox?since={cursor}\` | GET | Delta inbox (new items since cursor) |
| \`/agents/me/tasks\` | GET | List your tasks |
| \`/agents/me/tasks/{id}\` | GET | Get task details |
| \`/agents/me/tasks/{id}\` | PATCH | Update task (propose todos, update status) |
| \`/agents/me/tasks/{id}/event\` | POST | Log task event (progress, error) |
| \`/agents/me/tasks/{id}/complete\` | POST | Mark task complete |
| \`/agents/me/messages\` | GET | List messages |
| \`/agents/me/messages\` | POST | Send a message |
| \`/agents/me/directives\` | GET | Get your directives (rules, purpose, constraints) |
| \`/agents/me/capabilities\` | PUT | Report your capabilities |
| \`/agents/me/telemetry\` | POST | Report telemetry (token usage, tool calls) |
| \`/agents/me/webhook\` | PUT | Register webhook URL for push notifications |
| \`/agents/me/skill-bundle/version\` | GET | Check for skill bundle updates |
| \`/agents/me/onboarding\` | GET | Onboarding status |
| \`/agents/me/onboarding/step/{id}\` | POST | Confirm onboarding step |

## Response Format
All responses use the AIMEAT envelope:
\`\`\`json
{
  "ok": true,
  "protocol": "aimeat",
  "version": "v1",
  "node": "${ctx.nodeId}",
  "data": { ... }
}
\`\`\`

Errors:
\`\`\`json
{
  "ok": false,
  "error": { "code": "NOT_FOUND", "message": "..." }
}
\`\`\`
`;
}

function renderTaskLifecycle(ctx: BundleContext): string {
  return `# Task Lifecycle

## States
\`\`\`
queued -> active -> done
           |
           +-> failed
           +-> stalled (auto-detected: no events for 30 min)
\`\`\`

## Flow

### 1. Task Queued (you receive it)
Owner creates a task for you. You receive a \`task.queued\` event via webhook or find it in your inbox.

**Action:** Fetch the full task via \`GET /v1/agents/me/tasks/{task_id}\`, then propose a plan by PATCHing with todos:

\`\`\`
PATCH /v1/agents/me/tasks/{task_id}
{
  "todos": [
    { "title": "Step 1: Fetch data", "description": "..." },
    { "title": "Step 2: Process results", "description": "..." }
  ]
}
\`\`\`

### 2. Task Approved (owner clicks Start)
Owner reviews your proposed todos and clicks Start. You receive a \`task.approved\` event.

**Action:** Execute todos in order. Log progress via events.

### 3. Executing Todos
For each todo, do the work, then mark it done:

\`\`\`
PATCH /v1/agents/me/tasks/{task_id}
{
  "todos": [
    { "id": "{todo_id}", "status": "done", "result": "Found 47 offers" }
  ]
}
\`\`\`

Log progress events:
\`\`\`
POST /v1/agents/me/tasks/{task_id}/event
{
  "type": "progress",
  "message": "Fetched 3/5 store pages"
}
\`\`\`

### 4. Task Complete
When all todos are done:
\`\`\`
POST /v1/agents/me/tasks/{task_id}/complete
\`\`\`

### 5. Error Handling
If you hit a problem:
\`\`\`
POST /v1/agents/me/tasks/{task_id}/event
{
  "type": "error",
  "message": "K-Ruoka API returned 503"
}
\`\`\`

If unrecoverable, fail the task:
\`\`\`
POST /v1/agents/me/tasks/{task_id}/fail
{
  "reason": "K-Ruoka API is down after 3 retries"
}
\`\`\`

## Important Rules
- **Never self-start.** Wait for the owner to approve (click Start).
- **Propose before executing.** Always PATCH with todos first, then wait for approval.
- **Log progress.** Post events so the owner can track what you're doing.
- **Complete or fail.** Every task must end in \`done\` or \`failed\`.
`;
}

function renderMessageProtocol(ctx: BundleContext): string {
  return `# Message Protocol

## Inbox
Messages appear in your inbox. Check via:
\`\`\`
GET /v1/agents/me/inbox
\`\`\`

Or use delta polling:
\`\`\`
GET /v1/agents/me/inbox?since={cursor}
\`\`\`

## Reading Messages
\`\`\`
GET /v1/agents/me/messages?thread_id={thread_id}
\`\`\`

## Sending Messages
\`\`\`
POST /v1/agents/me/messages
{
  "content": "Your response text",
  "direction": "outbound",
  "thread_id": "{thread_id}"
}
\`\`\`

## Message Threading
- Messages belong to threads (thread_id)
- Threads can be linked to tasks (linked_task_id)
- Reply in the same thread to continue a conversation
- New conversations start a new thread (omit thread_id)

## Slash Commands
If you support slash commands (e.g., /model, /status, /help), register them by writing to memory:

\`\`\`
PUT /v1/memory/agents.${ctx.agentName}.commands
{
  "value": [
    {"name": "/model", "category": "System", "description": "Show current AI model"},
    {"name": "/status", "category": "System", "description": "Show agent status"}
  ]
}
\`\`\`

The owner's UI will display a command palette with your registered commands.
`;
}

function renderTelemetryProtocol(ctx: BundleContext): string {
  return `# Telemetry Protocol

## Why Telemetry Matters
Telemetry feeds into your readiness score. Agents that report telemetry consistently score higher and get more permissions.

## Reporting Telemetry

\`\`\`
POST /v1/agents/me/telemetry
{
  "type": "llm_call",
  "tokens_in": 1523,
  "tokens_out": 847,
  "model": "anthropic/claude-sonnet-4-20250514",
  "duration_ms": 3200,
  "session_id": "your-session-id",
  "task_id": "optional-task-id"
}
\`\`\`

## Event Types

| Type | When | Required Fields |
|------|------|-----------------|
| \`llm_call\` | After each LLM API call | tokens_in, tokens_out, model, duration_ms |
| \`tool_call\` | After each tool invocation | tool_name, duration_ms, success |
| \`agent_report\` | Periodic self-report | Freeform data |

## Best Practice
- Use runtime hooks (e.g., post_llm_call) for automatic reporting
- Report per LLM call, not per task (granular data is more useful)
- Include session_id so AIMEAT can group events by session
- Include task_id when working on a specific task
`;
}

function renderCapabilityReport(ctx: BundleContext): string {
  return `# Capability Report

## Reporting Capabilities
Tell AIMEAT what you can do:

\`\`\`
PUT /v1/agents/me/capabilities
{
  "technical": ["memory", "tasks", "messages", "web_scraping"],
  "domain": ["grocery_monitoring", "price_comparison"]
}
\`\`\`

## Technical Capabilities
MCP tools and system features you support:
- \`memory\` -- read/write AIMEAT memory
- \`tasks\` -- accept, update, complete tasks
- \`messages\` -- send/receive messages
- \`events\` -- emit events
- \`web_scraping\` -- fetch web pages
- \`file_operations\` -- read/write files
- \`code_execution\` -- run code

## Domain Capabilities
What problem domains you specialize in. Examples:
- \`grocery_monitoring\` -- tracking grocery prices
- \`data_analysis\` -- analyzing datasets
- \`report_generation\` -- creating reports

## When to Update
- On first connection (Hello Integration Step 4)
- When your capabilities change (new tools, new skills)
`;
}

function renderErrorProtocol(ctx: BundleContext): string {
  return `# Error Protocol

## HTTP Status Codes
| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Continue |
| 400 | Bad request | Fix your request and retry |
| 401 | Unauthorized | Re-authenticate |
| 403 | Forbidden | You lack permission for this action |
| 404 | Not found | Resource doesn't exist |
| 429 | Rate limited | Wait and retry (check Retry-After header) |
| 500 | Server error | Report and retry with backoff |

## Retry Strategy
For transient errors (429, 500, 502, 503, 504):
1. Wait 5 seconds, retry
2. Wait 30 seconds, retry
3. Wait 120 seconds, retry
4. Give up, log error event

## Error Reporting
When you encounter an error during task execution:
\`\`\`
POST /v1/agents/me/tasks/{task_id}/event
{
  "type": "error",
  "message": "API returned 503 after 3 retries",
  "details": { "endpoint": "/v1/memory/search", "status": 503 }
}
\`\`\`

## Rate Limits
- Default: 60 requests/minute per agent
- Telemetry: 120 events/minute
- Memory writes: 30 writes/minute

If you receive 429, slow down. The Retry-After header tells you how long to wait.
`;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/skill-bundle/generator.ts
git commit -m "feat(skill-bundle): add core generator with 6 reference documents"
```

---

## Task 3: Hermes Runtime Adapter

**Files:**
- Create: `aimeat/src/services/skill-bundle/hermes-adapter.ts`

The Hermes adapter produces the full `aimeat-hermes` bundle: SKILL.md manifest, shell scripts for polling/telemetry/healthcheck, and YAML config files for webhook routes and hooks.

- [ ] **Step 1: Create the Hermes adapter**

Create `aimeat/src/services/skill-bundle/hermes-adapter.ts`:

```typescript
/**
 * @file hermes-adapter.ts
 * @description Hermes (OpenClaw) runtime adapter for skill bundle generation.
 *   Produces aimeat-hermes bundle with SKILL.md, scripts/, and config/ directories.
 * @structure
 *   - HermesAdapter class implementing RuntimeAdapter
 *   - SKILL.md template with on-wake protocol
 *   - Shell scripts: poll-inbox.sh, post-telemetry.sh, test-connection.sh
 *   - YAML configs: webhook-route.yaml, hooks.yaml
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

import { computeBundleVersion } from './generator.js';
import type { RuntimeAdapter, BundleContext, BundleFile, BundleContent } from './types.js';

export class HermesAdapter implements RuntimeAdapter {
  readonly runtime = 'hermes';
  readonly bundleName = 'aimeat-hermes';

  generate(ctx: BundleContext, references: BundleFile[]): BundleContent {
    const files: BundleFile[] = [
      { path: 'SKILL.md', content: this.renderSkillMd(ctx) },
      ...references,
      { path: 'scripts/poll-inbox.sh', content: this.renderPollInbox(ctx) },
      { path: 'scripts/post-telemetry.sh', content: this.renderPostTelemetry(ctx) },
      { path: 'scripts/test-connection.sh', content: this.renderTestConnection(ctx) },
      { path: 'config/webhook-route.yaml', content: this.renderWebhookRoute(ctx) },
      { path: 'config/hooks.yaml', content: this.renderHooksYaml(ctx) },
    ];

    const metadata = {
      bundleName: this.bundleName,
      runtime: this.runtime,
      version: '',
      agentName: ctx.agentName,
      agentGaii: ctx.agentGaii,
      nodeId: ctx.nodeId,
      nodeUrl: ctx.nodeUrl,
      generatedAt: new Date().toISOString(),
    };

    const bundle: BundleContent = { metadata, files };
    bundle.metadata.version = computeBundleVersion(bundle);
    return bundle;
  }

  private renderSkillMd(ctx: BundleContext): string {
    const rulesBlock = ctx.directives.rules.length > 0
      ? ctx.directives.rules.map((r, i) => `${i + 1}. ${r.description}`).join('\n')
      : 'No specific rules configured.';

    return `---
name: aimeat-hermes
description: AIMEAT node integration for ${ctx.nodeId}
trigger: when user mentions AIMEAT, tasks, inbox, or this skill is invoked
---

## Identity
You are ${ctx.agentName} on AIMEAT node ${ctx.nodeUrl}
Your GAII: ${ctx.agentGaii}

## On First Run
Complete the Hello Integration checklist:
1. Report capabilities: PUT /v1/agents/me/capabilities
2. Read directives: GET /v1/agents/me/directives
3. Send test message: POST /v1/agents/me/messages
4. Register webhook: PUT /v1/agents/me/webhook
5. Report telemetry: POST /v1/agents/me/telemetry
6. Confirm each step: POST /v1/agents/me/onboarding/step/{step_id}

## On Every Wake
1. Check inbox: GET ${ctx.nodeUrl}/v1/agents/me/inbox?since={cursor}
2. Queued tasks without todos -> propose plan (PATCH with todos)
3. Active tasks -> execute next pending todo
4. Pending messages -> read and respond
5. Report capabilities if changed

## Directives
${rulesBlock}

## Events You May Receive (via webhook)
- task.queued -- Owner created a new task. Fetch and propose todos.
- task.approved -- Owner approved your plan. Start executing.
- task.updated -- Owner edited the task. Re-fetch and adjust.
- task.paused -- Owner paused the task. Stop work immediately.
- message.inbound -- Owner sent a message. Read and respond.
- directive.updated -- Directives changed. Re-fetch via GET /directives.
- onboarding.step -- Onboarding step needs attention.

## References
See references/ directory for detailed API documentation:
- api-overview.md -- Endpoints, auth, response format
- task-lifecycle.md -- Task states and flow
- message-protocol.md -- Messages, threads, slash commands
- telemetry-protocol.md -- Token usage reporting
- capability-report.md -- Declaring capabilities
- error-protocol.md -- Error handling and retry strategy
`;
  }

  private renderPollInbox(ctx: BundleContext): string {
    return `#!/bin/bash
# poll-inbox.sh -- Cron script for Tier 3 polling fallback
# Runs in no_agent mode (zero LLM cost). Only wakes the agent if new items exist.
#
# Install: copy to ~/.hermes/scripts/ and add to crontab:
#   */5 * * * * ~/.hermes/scripts/poll-inbox.sh

set -euo pipefail

NODE_URL="${ctx.nodeUrl}"
AGENT_NAME="${ctx.agentName}"
CURSOR_FILE="$HOME/.hermes/state/aimeat-cursor"

# Load auth token
TOKEN=$(hermes auth token 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "No auth token available, skipping poll"
  exit 0
fi

# Read cursor from previous poll
CURSOR=""
if [ -f "$CURSOR_FILE" ]; then
  CURSOR=$(cat "$CURSOR_FILE")
fi

# Build URL
if [ -n "$CURSOR" ]; then
  URL="$NODE_URL/v1/agents/$AGENT_NAME/inbox?since=$CURSOR"
else
  URL="$NODE_URL/v1/agents/$AGENT_NAME/inbox"
fi

# Poll inbox
RESPONSE=$(curl -s -w "\\n%{http_code}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Accept: application/json" \\
  "$URL")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "Inbox poll failed with HTTP $HTTP_CODE"
  exit 1
fi

# Save next cursor
NEXT_CURSOR=$(echo "$BODY" | jq -r '.data.next_cursor // empty')
if [ -n "$NEXT_CURSOR" ]; then
  mkdir -p "$(dirname "$CURSOR_FILE")"
  echo "$NEXT_CURSOR" > "$CURSOR_FILE"
fi

# Check if there are new items
TASK_COUNT=$(echo "$BODY" | jq '.data.queued_tasks | length')
MSG_COUNT=$(echo "$BODY" | jq '.data.pending_messages | length')

if [ "$TASK_COUNT" -gt 0 ] || [ "$MSG_COUNT" -gt 0 ]; then
  echo "New items: $TASK_COUNT tasks, $MSG_COUNT messages -- waking agent"
  hermes wake --reason "AIMEAT inbox: $TASK_COUNT tasks, $MSG_COUNT messages" 2>/dev/null || true
fi
`;
  }

  private renderPostTelemetry(ctx: BundleContext): string {
    return `#!/bin/bash
# post-telemetry.sh -- Hook script for automatic telemetry reporting
# Registered as Hermes post_llm_call hook. Fires after every LLM API call.
#
# Environment variables set by Hermes:
#   HERMES_TOKENS_IN, HERMES_TOKENS_OUT, HERMES_MODEL,
#   HERMES_DURATION_MS, HERMES_SESSION_ID

set -euo pipefail

NODE_URL="${ctx.nodeUrl}"
AGENT_NAME="${ctx.agentName}"

TOKEN=$(hermes auth token 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  exit 0
fi

curl -s -X POST \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"type\\": \\"llm_call\\",
    \\"tokens_in\\": \${HERMES_TOKENS_IN:-0},
    \\"tokens_out\\": \${HERMES_TOKENS_OUT:-0},
    \\"model\\": \\"\${HERMES_MODEL:-unknown}\\",
    \\"duration_ms\\": \${HERMES_DURATION_MS:-0},
    \\"session_id\\": \\"\${HERMES_SESSION_ID:-}\\",
    \\"timestamp\\": \\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"
  }" \\
  "$NODE_URL/v1/agents/$AGENT_NAME/telemetry" > /dev/null 2>&1 || true
`;
  }

  private renderTestConnection(ctx: BundleContext): string {
    return `#!/bin/bash
# test-connection.sh -- Healthcheck script
# Verifies auth token works and inbox endpoint is reachable.
#
# Usage: ./test-connection.sh

set -euo pipefail

NODE_URL="${ctx.nodeUrl}"
AGENT_NAME="${ctx.agentName}"

TOKEN=$(hermes auth token 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "FAIL: No auth token available"
  echo "Run: hermes auth login"
  exit 1
fi

echo "Testing connection to $NODE_URL..."

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \\
  -H "Authorization: Bearer $TOKEN" \\
  "$NODE_URL/v1/agents/$AGENT_NAME/inbox")

if [ "$HTTP_CODE" = "200" ]; then
  echo "OK: Connection successful (HTTP 200)"
  exit 0
elif [ "$HTTP_CODE" = "401" ]; then
  echo "FAIL: Authentication failed (HTTP 401)"
  echo "Token may have expired. Run: hermes auth login"
  exit 1
elif [ "$HTTP_CODE" = "404" ]; then
  echo "FAIL: Agent not found (HTTP 404)"
  echo "Agent '$AGENT_NAME' may not exist on this node."
  exit 1
else
  echo "FAIL: Unexpected response (HTTP $HTTP_CODE)"
  exit 1
fi
`;
  }

  private renderWebhookRoute(ctx: BundleContext): string {
    return `# webhook-route.yaml -- Hermes webhook route configuration
# Copy this file to your Hermes config directory.
#
# This configures Hermes to accept incoming webhook events from AIMEAT
# and wake the agent when relevant events arrive.

route:
  path: /webhooks/aimeat
  method: POST
  handler: wake_agent
  validation:
    signature_header: X-AIMEAT-Signature
    algorithm: hmac-sha256
  events:
    - task.queued
    - task.approved
    - task.updated
    - task.paused
    - message.inbound
    - directive.updated
    - onboarding.step
`;
  }

  private renderHooksYaml(ctx: BundleContext): string {
    return `# hooks.yaml -- Hermes hook registration
# Copy this file to your Hermes config directory.
#
# Registers post_llm_call hook for automatic telemetry reporting.

hooks:
  post_llm_call:
    - script: scripts/post-telemetry.sh
      description: Report token usage to AIMEAT node
      enabled: true
`;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/skill-bundle/hermes-adapter.ts
git commit -m "feat(skill-bundle): add Hermes runtime adapter with SKILL.md, scripts, and config"
```

---

## Task 4: Generic Runtime Adapter

**Files:**
- Create: `aimeat/src/services/skill-bundle/generic-adapter.ts`

The generic fallback includes only references and a minimal SKILL.md with no runtime-specific config. Used for unsupported runtimes.

- [ ] **Step 1: Create the generic adapter**

Create `aimeat/src/services/skill-bundle/generic-adapter.ts`:

```typescript
/**
 * @file generic-adapter.ts
 * @description Generic fallback runtime adapter for skill bundle generation.
 *   Produces aimeat-agent bundle with minimal SKILL.md + references only.
 *   Used for runtimes without a dedicated adapter.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

import { computeBundleVersion } from './generator.js';
import type { RuntimeAdapter, BundleContext, BundleFile, BundleContent } from './types.js';

export class GenericAdapter implements RuntimeAdapter {
  readonly runtime = 'generic';
  readonly bundleName = 'aimeat-agent';

  generate(ctx: BundleContext, references: BundleFile[]): BundleContent {
    const files: BundleFile[] = [
      { path: 'SKILL.md', content: this.renderSkillMd(ctx) },
      ...references,
    ];

    const metadata = {
      bundleName: this.bundleName,
      runtime: this.runtime,
      version: '',
      agentName: ctx.agentName,
      agentGaii: ctx.agentGaii,
      nodeId: ctx.nodeId,
      nodeUrl: ctx.nodeUrl,
      generatedAt: new Date().toISOString(),
    };

    const bundle: BundleContent = { metadata, files };
    bundle.metadata.version = computeBundleVersion(bundle);
    return bundle;
  }

  private renderSkillMd(ctx: BundleContext): string {
    const rulesBlock = ctx.directives.rules.length > 0
      ? ctx.directives.rules.map((r, i) => `${i + 1}. ${r.description}`).join('\n')
      : 'No specific rules configured.';

    return `# AIMEAT Agent Integration

## Identity
- Agent: ${ctx.agentName}
- GAII: ${ctx.agentGaii}
- Node: ${ctx.nodeUrl} (${ctx.nodeId})

## Quick Start
1. Authenticate with your Bearer token
2. Check inbox: GET ${ctx.nodeUrl}/v1/agents/me/inbox
3. Propose todos for queued tasks: PATCH /v1/agents/me/tasks/{id}
4. Wait for owner approval before executing
5. Report progress via task events
6. Complete tasks when done

## Directives
${rulesBlock}

## Setup (Manual)
This is a generic skill bundle. You will need to manually configure:
- Polling: set up a cron job or scheduled task to poll the inbox endpoint
- Telemetry: POST to /v1/agents/me/telemetry after each LLM call
- Webhook (optional): PUT /v1/agents/me/webhook to register a push endpoint

See the references/ directory for full API documentation.

## References
- references/api-overview.md -- Endpoints, auth, response format
- references/task-lifecycle.md -- Task states and flow
- references/message-protocol.md -- Messages, threads, slash commands
- references/telemetry-protocol.md -- Token usage reporting
- references/capability-report.md -- Declaring capabilities
- references/error-protocol.md -- Error handling and retry strategy
`;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/skill-bundle/generic-adapter.ts
git commit -m "feat(skill-bundle): add generic fallback adapter (references only)"
```

---

## Task 5: Skill Bundle REST Endpoint

**Files:**
- Create: `aimeat/src/routes/agent-skill-bundle.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

Two endpoints: GET to download the ZIP bundle, GET /version for lightweight version check.

- [ ] **Step 1: Create the route file**

Create `aimeat/src/routes/agent-skill-bundle.ts`:

```typescript
/**
 * @file agent-skill-bundle.ts
 * @description REST endpoints for skill bundle download and version check.
 *   Agents download runtime-specific skill bundles as ZIP files, and check
 *   for updates via a lightweight version endpoint.
 * @structure
 *   - GET /v1/agents/:name/skill-bundle          -- Download ZIP bundle
 *   - GET /v1/agents/:name/skill-bundle/version   -- Version check (lightweight)
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

import { Router } from 'express';
import archiver from 'archiver';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { generateBundle } from '../services/skill-bundle/generator.js';
import { HermesAdapter } from '../services/skill-bundle/hermes-adapter.js';
import { GenericAdapter } from '../services/skill-bundle/generic-adapter.js';
import type { RuntimeAdapter, BundleContext } from '../services/skill-bundle/types.js';

const ADAPTERS: Record<string, RuntimeAdapter> = {
  hermes: new HermesAdapter(),
  generic: new GenericAdapter(),
};

export function agentSkillBundleRouter(config: AimeatConfig, storage: Storage): Router {
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

  async function buildContext(agentName: string, agentGaii: string, storage: Storage): Promise<BundleContext> {
    const agent = await storage.getAgent(agentGaii);

    const ownerName = agentGaii.split('#')[1]?.split('@')[0] ?? '';
    const ownerGhii = `${ownerName}@${config.nodeId}`;

    // Load three-layer directives
    const systemRules = (config.agentSystemPrinciples ?? []).map((text, idx) => ({
      id: `system-${idx + 1}`,
      description: text,
      source: 'system',
    }));
    const ownerDefaults = await storage.getOwnerAgentDefaults(ownerGhii);
    const ownerRules = (ownerDefaults?.rules ?? []).map(r => ({ ...r, source: 'owner' }));
    const agentDirectives = await storage.getAgentDirectives(agentGaii);
    const agentRules = (agentDirectives?.rules ?? []).map(r => ({ ...r, source: 'agent' }));

    return {
      agentName,
      agentGaii,
      nodeId: config.nodeId,
      nodeUrl: config.baseUrl,
      directives: {
        purpose: agentDirectives?.purpose,
        rules: [...systemRules, ...ownerRules, ...agentRules],
        memoryAreas: agentDirectives?.memoryAreas,
        resources: agentDirectives?.resources,
      },
      capabilities: {
        technical: agent?.technicalCapabilities,
        domain: agent?.domainCapabilities,
      },
      webhookUrl: agent?.webhookUrl,
    };
  }

  /* -- GET /v1/agents/:name/skill-bundle -- Download ZIP bundle -- */
  router.get('/v1/agents/:name/skill-bundle', requireAuth(), async (req, res) => {
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

    const runtimeParam = (req.query.runtime as string)?.toLowerCase() ?? 'generic';
    const adapter = ADAPTERS[runtimeParam] ?? ADAPTERS.generic;

    const ctx = await buildContext(agentName, agentGaii, storage);
    const bundle = generateBundle(ctx, adapter);

    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${bundle.metadata.bundleName}.zip"`,
        'Content-Length': String(buffer.length),
        'X-Bundle-Version': bundle.metadata.version,
        'X-Bundle-Runtime': bundle.metadata.runtime,
      });
      res.send(buffer);
    });
    archive.on('error', (err) => {
      res.status(500).json(error(config.nodeId, 'ZIP_ERROR', `Failed to generate bundle: ${err.message}`));
    });

    for (const file of bundle.files) {
      archive.append(file.content, { name: `${bundle.metadata.bundleName}/${file.path}` });
    }

    await archive.finalize();
  });

  /* -- GET /v1/agents/:name/skill-bundle/version -- Lightweight version check -- */
  router.get('/v1/agents/:name/skill-bundle/version', requireAuth(), async (req, res) => {
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

    const runtimeParam = (req.query.runtime as string)?.toLowerCase() ?? 'generic';
    const adapter = ADAPTERS[runtimeParam] ?? ADAPTERS.generic;

    const ctx = await buildContext(agentName, agentGaii, storage);
    const bundle = generateBundle(ctx, adapter);

    res.json(success(config.nodeId, {
      version: bundle.metadata.version,
      runtime: bundle.metadata.runtime,
      bundle_name: bundle.metadata.bundleName,
      generated_at: bundle.metadata.generatedAt,
    }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in routes-loader.ts**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add the import and mount call. Add the import near the other agent route imports:

```typescript
import { agentSkillBundleRouter } from '../routes/agent-skill-bundle.js';
```

And mount it before `agentsRouter` (to avoid `:name` param conflicts), near the other agent-specific routes:

```typescript
app.use(agentSkillBundleRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/agent-skill-bundle.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(skill-bundle): add REST endpoints for bundle download and version check"
```

---

## Task 6: E2E Tests

**Files:**
- Create: `test/agent-skill-bundle.ts`

Tests cover both endpoints, both runtimes, auth checks, and ZIP content validation.

- [ ] **Step 1: Create the E2E test file**

Create `test/agent-skill-bundle.ts`. Follow the existing test pattern from `test/agent-webhook.ts` (or any existing agent test). The test file should:

```typescript
/**
 * @file agent-skill-bundle.ts
 * @description E2E tests for skill bundle download and version check endpoints.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import yauzl from 'yauzl';
import { TestHarness } from './helpers/harness.js';

describe('Agent Skill Bundle', () => {
  let harness: TestHarness;
  let ownerToken: string;
  let agentToken: string;
  const agentName = 'bundle-test-agent';

  before(async () => {
    harness = await TestHarness.create();
    ownerToken = await harness.registerOwner('bundleowner');
    agentToken = await harness.connectAgent('bundleowner', agentName);
  });

  after(async () => {
    await harness.cleanup();
  });

  describe('GET /v1/agents/:name/skill-bundle', () => {
    it('returns a ZIP file with hermes runtime', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/zip');
      assert.ok(res.headers.get('x-bundle-version'));
      assert.equal(res.headers.get('x-bundle-runtime'), 'hermes');
      assert.ok(res.headers.get('content-disposition')?.includes('aimeat-hermes.zip'));

      const buffer = Buffer.from(await res.arrayBuffer());
      const entries = await listZipEntries(buffer);
      assert.ok(entries.includes('aimeat-hermes/SKILL.md'));
      assert.ok(entries.includes('aimeat-hermes/references/api-overview.md'));
      assert.ok(entries.includes('aimeat-hermes/references/task-lifecycle.md'));
      assert.ok(entries.includes('aimeat-hermes/references/message-protocol.md'));
      assert.ok(entries.includes('aimeat-hermes/references/telemetry-protocol.md'));
      assert.ok(entries.includes('aimeat-hermes/references/capability-report.md'));
      assert.ok(entries.includes('aimeat-hermes/references/error-protocol.md'));
      assert.ok(entries.includes('aimeat-hermes/scripts/poll-inbox.sh'));
      assert.ok(entries.includes('aimeat-hermes/scripts/post-telemetry.sh'));
      assert.ok(entries.includes('aimeat-hermes/scripts/test-connection.sh'));
      assert.ok(entries.includes('aimeat-hermes/config/webhook-route.yaml'));
      assert.ok(entries.includes('aimeat-hermes/config/hooks.yaml'));
    });

    it('returns generic bundle when runtime is omitted', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-bundle-runtime'), 'generic');
      assert.ok(res.headers.get('content-disposition')?.includes('aimeat-agent.zip'));

      const buffer = Buffer.from(await res.arrayBuffer());
      const entries = await listZipEntries(buffer);
      assert.ok(entries.includes('aimeat-agent/SKILL.md'));
      assert.ok(entries.includes('aimeat-agent/references/api-overview.md'));
      // Generic bundle has no scripts/ or config/
      assert.ok(!entries.some(e => e.includes('/scripts/')));
      assert.ok(!entries.some(e => e.includes('/config/')));
    });

    it('returns generic bundle for unknown runtime', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle?runtime=unknown-platform`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-bundle-runtime'), 'generic');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await harness.fetch('/v1/agents/no-such-agent/skill-bundle?runtime=hermes', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 404);
    });

    it('returns 403 for unauthorized agent', async () => {
      const otherOwnerToken = await harness.registerOwner('otherowner');
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
      });
      assert.equal(res.status, 403);
    });

    it('agent can download its own bundle', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/zip');
    });

    it('ZIP contains agent-specific GAII in SKILL.md', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      const skillMd = await readZipEntry(buffer, 'aimeat-hermes/SKILL.md');
      assert.ok(skillMd.includes(agentName));
      assert.ok(skillMd.includes('#'));
    });
  });

  describe('GET /v1/agents/:name/skill-bundle/version', () => {
    it('returns version info without downloading ZIP', async () => {
      const res = await harness.fetch(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.ok);
      assert.ok(body.data.version);
      assert.equal(body.data.runtime, 'hermes');
      assert.equal(body.data.bundle_name, 'aimeat-hermes');
      assert.ok(body.data.generated_at);
    });

    it('version is stable for same agent config', async () => {
      const res1 = await harness.fetch(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const body1 = await res1.json();

      const res2 = await harness.fetch(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const body2 = await res2.json();

      assert.equal(body1.data.version, body2.data.version);
    });

    it('hermes and generic have different versions', async () => {
      const res1 = await harness.fetch(`/v1/agents/${agentName}/skill-bundle/version?runtime=hermes`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const body1 = await res1.json();

      const res2 = await harness.fetch(`/v1/agents/${agentName}/skill-bundle/version`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const body2 = await res2.json();

      assert.notEqual(body1.data.version, body2.data.version);
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await harness.fetch('/v1/agents/no-such-agent/skill-bundle/version', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 404);
    });
  });
});

// Helpers for ZIP inspection

function listZipEntries(buffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const entries: string[] = [];
      zipfile!.readEntry();
      zipfile!.on('entry', (entry) => {
        entries.push(entry.fileName);
        zipfile!.readEntry();
      });
      zipfile!.on('end', () => resolve(entries));
      zipfile!.on('error', reject);
    });
  });
}

function readZipEntry(buffer: Buffer, targetPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile!.readEntry();
      zipfile!.on('entry', (entry) => {
        if (entry.fileName === targetPath) {
          zipfile!.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) return reject(streamErr);
            const chunks: Buffer[] = [];
            readStream!.on('data', (chunk: Buffer) => chunks.push(chunk));
            readStream!.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          });
        } else {
          zipfile!.readEntry();
        }
      });
      zipfile!.on('end', () => reject(new Error(`Entry ${targetPath} not found`)));
      zipfile!.on('error', reject);
    });
  });
}
```

**Important:** Adjust the test setup based on the actual test harness pattern in the project. Read `test/helpers/harness.ts` (or the equivalent test setup file) before implementing to match the exact helper API. The tests above show the intent and assertions; the harness calls may need minor adjustments.

- [ ] **Step 2: Run the test to verify it fails (no test harness issue)**

Run: `pnpm test:e2e -- agent-skill-bundle`
Expected: Tests run but some may fail if Plan 1 hasn't been implemented yet (webhook fields missing). The skill bundle tests should pass independently if the route is mounted correctly.

- [ ] **Step 3: Fix any test issues and re-run**

Run: `pnpm test:e2e -- agent-skill-bundle`
Expected: PASS (all skill bundle tests green)

- [ ] **Step 4: Commit**

```bash
git add test/agent-skill-bundle.ts
git commit -m "test(skill-bundle): add E2E tests for bundle download and version check"
```

---

## Task 7: OpenAPI + i18n Sync

**Files:**
- Modify: `aimeat/openapi.yaml`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add skill-bundle endpoints to openapi.yaml**

Add to the paths section:

```yaml
  /v1/agents/{name}/skill-bundle:
    get:
      summary: Download skill bundle ZIP
      description: >
        Download a runtime-specific skill bundle as a ZIP file. The bundle contains
        reference documentation, SKILL.md manifest, and runtime-specific scripts/config.
      tags:
        - Agent Integration
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
          description: Agent name
        - name: runtime
          in: query
          required: false
          schema:
            type: string
            enum: [hermes, generic]
            default: generic
          description: Target runtime platform
      responses:
        '200':
          description: Skill bundle ZIP file
          headers:
            X-Bundle-Version:
              schema:
                type: string
              description: Bundle content hash version
            X-Bundle-Runtime:
              schema:
                type: string
              description: Runtime adapter used
          content:
            application/zip:
              schema:
                type: string
                format: binary
        '403':
          description: Access denied
        '404':
          description: Agent not found

  /v1/agents/{name}/skill-bundle/version:
    get:
      summary: Check skill bundle version
      description: >
        Lightweight version check without downloading the full bundle.
        Returns current version hash and runtime metadata.
      tags:
        - Agent Integration
      security:
        - bearerAuth: []
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
          description: Agent name
        - name: runtime
          in: query
          required: false
          schema:
            type: string
            enum: [hermes, generic]
            default: generic
          description: Target runtime platform
      responses:
        '200':
          description: Bundle version info
          content:
            application/json:
              schema:
                type: object
                properties:
                  version:
                    type: string
                  runtime:
                    type: string
                  bundle_name:
                    type: string
                  generated_at:
                    type: string
                    format: date-time
        '403':
          description: Access denied
        '404':
          description: Agent not found
```

- [ ] **Step 2: Add i18n keys to en.json**

Add under the appropriate section (or create an `"agentSkillBundle"` section):

```json
"agentSkillBundle": {
  "title": "Skill Bundle",
  "downloadLabel": "Download skill bundle",
  "versionLabel": "Version",
  "runtimeLabel": "Runtime",
  "hermesRuntime": "Hermes (OpenClaw)",
  "genericRuntime": "Generic",
  "installCommand": "Install command",
  "copyCommand": "Copy",
  "downloadZip": "Download ZIP",
  "copyCurl": "Copy curl command",
  "upToDate": "Up to date",
  "updateAvailable": "Update available",
  "reinstall": "Re-install",
  "lastGenerated": "Last generated",
  "notInstalled": "Not installed"
}
```

- [ ] **Step 3: Add i18n keys to fi.json**

```json
"agentSkillBundle": {
  "title": "Taitopaketti",
  "downloadLabel": "Lataa taitopaketti",
  "versionLabel": "Versio",
  "runtimeLabel": "Ajoympäristö",
  "hermesRuntime": "Hermes (OpenClaw)",
  "genericRuntime": "Yleinen",
  "installCommand": "Asennuskomento",
  "copyCommand": "Kopioi",
  "downloadZip": "Lataa ZIP",
  "copyCurl": "Kopioi curl-komento",
  "upToDate": "Ajan tasalla",
  "updateAvailable": "Päivitys saatavilla",
  "reinstall": "Asenna uudelleen",
  "lastGenerated": "Viimeksi luotu",
  "notInstalled": "Ei asennettu"
}
```

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/openapi.yaml aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "docs(skill-bundle): add OpenAPI spec and i18n keys for skill bundle endpoints"
```

---

## Task 8: Run Full E2E Tests

**Files:** None (validation only)

- [ ] **Step 1: Run E2E tests on both backends**

Run: `pnpm test:e2e:mongodb`
Expected: PASS (0 failures)

Run: `pnpm test:e2e:sqlite`
Expected: PASS (0 failures)

- [ ] **Step 2: Fix any failures**

If tests fail in areas affected by the skill bundle changes, fix them before proceeding.

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(skill-bundle): address E2E test failures"
```
