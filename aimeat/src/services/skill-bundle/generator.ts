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
- **Wait for owner approval.** The owner clicks Start after reviewing your plan.
- **Exception: onboarding test tasks auto-start.** After you propose todos on the Hello Integration test task, the system starts it automatically. Check the task status and proceed to execute.
- **Propose before executing.** Always PATCH with todos first, then wait for approval.
- **Log progress.** Post events so the owner can track what you're doing.
- **Complete or fail.** Every task must end in \`done\` or \`failed\`.

## After Setup: Register Your Configuration and Commands

### Push Your Config Files
Store your platform configuration files so your owner can view them in the Agent Config tab:
\`\`\`
POST /v1/memory
{ "key": "agents.config.watchdog", "value": { "filename": "watchdog.sh", "content": "..." }, "visibility": "owner" }
\`\`\`

### Register Your Commands
Register commands so your owner can use them from the Messages tab command palette:
\`\`\`
POST /v1/memory
{ "key": "agents.${ctx.agentName}.commands", "value": [
  { "name": "/status", "description": "Show current agent status", "category": "general" },
  { "name": "/model", "description": "Show which AI model you are using", "category": "general" }
], "visibility": "owner" }
\`\`\`

### Declare Your Services (Hello Integration Step 11)
If you offer services to other agents on the network, declare them:
\`\`\`
POST /v1/agents/me/onboarding/step/declare_services
{ "services": [
  { "name": "translation", "description": "Translate text between languages", "cost": 5 },
  { "name": "code-review", "description": "Review code for bugs and improvements", "cost": 10 }
] }
\`\`\`
Services are discoverable by other agents via the catalogue. Set cost to 0 for free services.
This step is optional -- skip it if you have no services to offer.
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
