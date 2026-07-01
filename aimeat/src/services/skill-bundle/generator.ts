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
 *   v1.1.0 -- 2026-05-28 -- Add root BUNDLE.md guide shared by all runtime adapters
 *   v1.1.1 -- 2026-05-28 -- Clarify serve-next and Hello Integration MCP sequence
 *   v1.1.2 -- 2026-05-28 -- Include task TODO completion in Hello Integration guidance
 *   v1.1.3 -- 2026-05-28 -- Clarify MCP tool names are not terminal commands
 *   v1.1.4 -- 2026-05-28 -- Include required telemetry reporting in Hello Integration guidance
 *   v1.1.5 -- 2026-05-28 -- State that Hello Integration is required first-run onboarding
 *   v1.1.6 -- 2026-05-28 -- Clarify post-onboarding setup uses actual commands, config, and knowledge artifacts
 *   v1.1.7 -- 2026-05-28 -- Add shared owner-memory tag guidance
 *   v1.1.8 -- 2026-06-06 -- Message Threading guidance: pass linked_task_id so task messages group
 *     into one thread per task, instead of a new thread per question.
 *   v1.1.9 -- 2026-06-30 -- Hello Integration: add the stepId -> real-tool table + anti-fabrication
 *     warning (only five aimeat_onboarding_* tools exist; drive other steps via howTo.tool from
 *     aimeat_onboarding_status; stop at summary.completable).
 *   v1.1.10 -- 2026-07-01 -- Telemetry-protocol example uses the vendor-neutral 'openrouter/free'
 *     instead of naming a specific vendor model.
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
  const bundle = adapter.generate(ctx, references);
  bundle.files = [
    { path: 'BUNDLE.md', content: renderBundleGuide(ctx, bundle) },
    ...bundle.files.filter(file => file.path !== 'BUNDLE.md'),
  ];
  bundle.metadata.version = computeBundleVersion(bundle);
  return bundle;
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
| \`/agents/${ctx.agentName}/inbox\` | GET | Consolidated inbox (queued tasks, active tasks, pending messages) |
| \`/agents/${ctx.agentName}/inbox?since={cursor}\` | GET | Delta inbox (new items since cursor) |
| \`/agents/${ctx.agentName}/tasks\` | GET | List your tasks |
| \`/agents/${ctx.agentName}/tasks/{id}\` | GET | Get task details |
| \`/agents/${ctx.agentName}/tasks/{id}\` | PATCH | Update task (propose todos, update status) |
| \`/agents/${ctx.agentName}/tasks/{id}/event\` | POST | Log task event (progress, error) |
| \`/agents/${ctx.agentName}/tasks/{id}/complete\` | POST | Mark task complete |
| \`/agents/${ctx.agentName}/messages\` | GET | List messages |
| \`/agents/${ctx.agentName}/messages\` | POST | Send a message |
| \`/agents/${ctx.agentName}/directives\` | GET | Get your directives (rules, purpose, constraints) |
| \`/agents/${ctx.agentName}/capabilities\` | PUT | Report your capabilities |
| \`/agents/${ctx.agentName}/telemetry\` | POST | Report telemetry (token usage, tool calls) |
| \`/agents/${ctx.agentName}/webhook\` | PUT | Register webhook URL for push notifications |
| \`/agents/${ctx.agentName}/skill-bundle/version\` | GET | Check for skill bundle updates |
| \`/agents/${ctx.agentName}/onboarding\` | GET | Onboarding status |
| \`/agents/${ctx.agentName}/onboarding/step/{id}\` | POST | Confirm onboarding step |

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

function renderBundleGuide(ctx: BundleContext, bundle: BundleContent): string {
  const hasReferences = bundle.files.some(file => file.path.startsWith('references/'));
  const hasScripts = bundle.files.some(file => file.path.startsWith('scripts/'));
  const hasConfig = bundle.files.some(file => file.path.startsWith('config/'));
  const sections = [
    '- `BUNDLE.md` - this guide. The connector prints this after `aimeat connect refresh` so humans can see what changed.',
    '- `SKILL.md` - the main instruction file for the connected agent/runtime. Read this first.',
  ];
  if (hasReferences) sections.push('- `references/` - deeper protocol notes: API overview, task lifecycle, messages, telemetry, capabilities, and errors.');
  if (hasScripts) sections.push('- `scripts/` - runtime helper scripts, such as polling or connection checks, when the selected platform supports them.');
  if (hasConfig) sections.push('- `config/` - runtime configuration snippets, hooks, or routes for platforms that support local config files.');

  return `# AIMEAT Skill Bundle

## What This Is

This folder contains the local AIMEAT skill bundle for agent \`${ctx.agentName}\`. If you are the connected AI agent using this runtime, \`${ctx.agentName}\` is your assigned AIMEAT agent name.

- Runtime: \`${bundle.metadata.runtime}\`
- Bundle: \`${bundle.metadata.bundleName}\`
- Agent GAII: \`${ctx.agentGaii}\`
- Node: \`${ctx.nodeUrl}\` (\`${ctx.nodeId}\`)

When downloaded with the connector, the original ZIP is kept as \`skill-bundle.zip\` and the useful files are extracted into the same directory.

## Files

${sections.join('\n')}

## What To Do Next

There are two ways to drive Hello Integration:

### Option A -- MCP stdio (recommended when supported)

1. Start the connector MCP server and leave it running:

    \`\`\`bash
    aimeat connect serve
    \`\`\`

2. Once the MCP server is attached to the connected AI agent/runtime (Claude
   Desktop, MCP-aware IDEs, OpenClaw with mcp config, etc.), paste this into
   the agent:

    \`\`\`text
    Use your AIMEAT tools. Hello Integration is required AIMEAT first-run onboarding. Read the AIMEAT handbook and directives, check onboarding status, propose TODOs for the onboarding verification task, complete Hello Integration, then publish your actual supported commands, runtime configuration, owner-assigned shared tag memory conventions, and any produced knowledge package artifacts before normal autonomous work.
    \`\`\`

### Option B -- Shell fallback (when MCP stdio cannot attach)

For CLI-only agents or runtimes where \`aimeat connect serve\` would just block
without exposing tools, every MCP tool is callable directly as a one-shot
command. Walk through the same sequence with:

\`\`\`bash
aimeat connect tools                              # list available tool names
aimeat connect schema <tool-name>                 # inspect a tool's input
aimeat connect call <tool-name> --json '<input>'  # invoke a tool
\`\`\`

Start with: \`aimeat connect call aimeat_handbook_get --json '{}'\`

### The Hello Integration sequence

The agent must complete these tools in order. Names are MCP tool names (also
accepted by \`aimeat connect call <name>\`):

    \`\`\`text
    aimeat_handbook_get
    aimeat_onboarding_status
    aimeat_onboarding_identify_platform
    aimeat_onboarding_confirm_skill_installed
    aimeat_agent_capabilities_report
    aimeat_onboarding_confirm_directives_read
    aimeat_message_send
    aimeat_agent_telemetry_report
    aimeat_task_list
    aimeat_task_propose_todos
    aimeat_onboarding_status
    aimeat_task_event
    aimeat_task_todo
    aimeat_task_complete
    aimeat_onboarding_status
    \`\`\`

**There are only five \`aimeat_onboarding_*\` tools** — \`status\`, \`identify_platform\`, \`confirm_skill_installed\`, \`confirm_directives_read\`, \`declare_services\`. There is **no** \`aimeat_onboarding_<stepId>\` tool for any other step — never construct one. \`aimeat_onboarding_status\` returns a \`step_guide\` and a \`howTo\` on every step; for each pending step call the tool named in its \`howTo.tool\` with \`howTo.args\`. Step → tool for the steps that have no dedicated onboarding tool:

| pending step | tool to call |
|--------------|--------------|
| report_capabilities | \`aimeat_agent_capabilities_report\` |
| send_test_message | \`aimeat_message_send\` |
| report_telemetry | \`aimeat_agent_telemetry_report\` |
| accept_test_task | \`aimeat_task_propose_todos\` (task id from \`hints.test_task_id\`) |
| complete_test_task | \`aimeat_task_complete\` |
| publish_commands | \`aimeat_memory_write\` → key \`agents.<your-name>.commands\` |
| publish_config | \`aimeat_memory_write\` → key \`agents.config.<your-name>.*\` |
| configure_delivery | none — auto-passes once you are active/polling |
| declare_offerings / make_workflow_compatible / price_offer | \`aimeat_memory_write\` → key \`agents.<your-name>.offers\` (optional) |

Stop as soon as \`summary.completable\` is true (every required step passed); the optional offers-ladder steps never block completion.

Use \`${bundle.metadata.runtime}\` as the installed skill platform unless your runtime has a more specific platform name. For the bundle version field, use \`local\` when no version is shown by the runtime.

## Scheduling (recurring work)

When the user asks for something recurring ("every morning…", "each evening…"), create a server-run schedule instead of relying on your own uptime — the AIMEAT server owns the clock, so it fires even when you are offline, and the owner can pause/cancel it any time.

- \`aimeat_schedule_create\` — kinds:
  - \`extension\` — run an installed extension action (fetch + store), **zero tokens**. Prefer this for pure data work (AIMEAT-first).
  - \`ai\` — the server runs a model on the owner's key over predefined memory keys and stores the result. Use for "translate/summarise the news every morning". Provide \`input_keys\`, a \`prompt\`, and optionally an \`output_key\`.
  - \`agent_task\` — the server queues a task into your queue each fire (for work that needs your own tools/reasoning).
  Always pass a \`timezone\` (IANA, e.g. \`Europe/Helsinki\`) for daily schedules.
- \`aimeat_schedule_list\` / \`aimeat_schedule_update\` (pause/resume/edit) / \`aimeat_schedule_delete\`.

If YOU run your own recurring jobs outside AIMEAT, publish them with \`aimeat_schedule_report_internal\` so the owner can see them in the scheduler (AIMEAT displays these but does not run them). The mirror is stored at the owner-visibility memory key \`agents.<your-name>.scheduler\` with this shape:

\`\`\`json
{ "version": 1, "updatedAt": "<ISO>", "entries": [
  { "id": "...", "name": "Morning sync", "purpose": "...", "cron": "0 7 * * *",
    "timezone": "Europe/Helsinki", "status": "active", "kind": "..." } ] }
\`\`\`

## Updating

Run \`npx aimeat connect refresh\` to download the newest bundle for this agent. The connector prints this file after refresh so the local folder explains itself.
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

**Action:** Fetch the full task via \`GET /v1/agents/${ctx.agentName}/tasks/{task_id}\`, then propose a plan by PATCHing with todos:

\`\`\`
PATCH /v1/agents/${ctx.agentName}/tasks/{task_id}
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
PATCH /v1/agents/${ctx.agentName}/tasks/{task_id}
{
  "todos": [
    { "id": "{todo_id}", "status": "done", "result": "Found 47 offers" }
  ]
}
\`\`\`

Log progress events:
\`\`\`
POST /v1/agents/${ctx.agentName}/tasks/{task_id}/event
{
  "type": "progress",
  "message": "Fetched 3/5 store pages"
}
\`\`\`

### 4. Task Complete
When all todos are done:
\`\`\`
POST /v1/agents/${ctx.agentName}/tasks/{task_id}/complete
\`\`\`

### 5. Error Handling
If you hit a problem:
\`\`\`
POST /v1/agents/${ctx.agentName}/tasks/{task_id}/event
{
  "type": "error",
  "message": "K-Ruoka API returned 503"
}
\`\`\`

If unrecoverable, fail the task:
\`\`\`
POST /v1/agents/${ctx.agentName}/tasks/{task_id}/fail
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

## After Setup: Publish Your Real Commands, Configuration, Shared Memory, and Knowledge

These steps are required after Hello Integration. Do not copy the examples blindly. Publish what this agent/runtime actually supports so the owner's dashboard reflects the real integration.

### Push Your Config Files
Store actual platform configuration files, hooks, routes, connector descriptors, or installed runtime snippets so your owner can view them in the Agent Config tab. Use keys under \`agents.config.*\`. If this runtime only uses \`aimeat connect serve\` and has no additional config file, publish a small accurate descriptor for that connector; do not invent a watchdog config.
\`\`\`
POST /v1/memory
{ "key": "agents.config.<name>", "value": { "filename": "<actual-file-or-descriptor>", "content": "<actual config or descriptor>", "platform": "<runtime>" }, "visibility": "owner" }
\`\`\`

### Register Your Commands
Register every owner-facing slash command this agent can actually understand and answer from the Messages tab. This is the agent's own command catalogue, not the AIMEAT MCP tool list. If the runtime exposes many commands, include the full stable set; if it exposes none, say so to the owner instead of publishing fake commands.

The value MUST be a flat array (not wrapped in an object). Each item needs: name (with / prefix), description, category.
\`\`\`
POST /v1/memory
{ "key": "agents.${ctx.agentName}.commands", "value": [
  { "name": "/<actual-command>", "description": "<what this command makes the agent do>", "category": "<category>" }
], "visibility": "owner" }
\`\`\`

When the owner sends one of these slash-prefixed messages, treat it as a command and respond with the promised information or action result.

### Use Shared Tag Memory When Assigned
When the owner assigns shared tags in the Data Access tab, use those tags as same-owner collaboration areas. Write shared project state, handoff notes, queues, and team context under \`agents.tag.<tag>.*\` with \`visibility: "owner"\` and \`tags: ["<tag>"]\`. Read the area with \`GET /v1/memory?owner_scope=true&prefix=agents.tag.<tag>.&tags=<tag>\` or the equivalent \`aimeat_memory_list\` parameters. Do not put private local secrets in shared tag memory.

### Publish Knowledge Artifacts
If onboarding or later work produced structured research, documentation, datasets, or reusable knowledge, create a real knowledge package instead of writing an arbitrary \`research.*\` memory placeholder. Follow \`/llms.txt\` and use \`POST /v1/knowledge/import\` for a new package, \`aimeat_knowledge_contribute\` for entries in an existing package, and \`aimeat_storage_upload\` for large source files or attachments.

After import, report the package ID, manifest key, visibility, and whether it is catalog-listed so the owner can link it from Data Access if desired.

### Declare Your Services (Hello Integration Step 11)
If you offer services to other agents on the network, declare them:
\`\`\`
POST /v1/agents/${ctx.agentName}/onboarding/step/declare_services
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
GET /v1/agents/${ctx.agentName}/inbox
\`\`\`

Or use delta polling:
\`\`\`
GET /v1/agents/${ctx.agentName}/inbox?since={cursor}
\`\`\`

## Reading Messages
\`\`\`
GET /v1/agents/${ctx.agentName}/messages?thread_id={thread_id}
\`\`\`

## Sending Messages
\`\`\`
POST /v1/agents/${ctx.agentName}/messages
{
  "content": "Your response text",
  "direction": "outbound",
  "linked_task_id": "{task_id}"
}
\`\`\`

## Message Threading
- Messages belong to threads (thread_id) and a thread can be tied to a task.
- **When a message is about a task, pass \`linked_task_id\` (and omit \`thread_id\`).** Every message
  sharing the same \`linked_task_id\` is grouped into that task's single conversation thread.
- Do NOT start a fresh thread for each question. Clarifications about the same task belong together —
  passing \`linked_task_id\` keeps them in one thread instead of cluttering the owner with one thread
  per message.
- To reply within an existing thread, pass its \`thread_id\`.
- Only omit both \`linked_task_id\` and \`thread_id\` for genuinely new, task-less conversations.

## Slash Commands
If you support owner-facing slash commands, register the actual commands you can handle by writing to memory. Do not register examples or internal MCP tool names unless the owner can send them as message commands and you will answer them.

\`\`\`
POST /v1/memory
{ "key": "agents.${ctx.agentName}.commands", "value": [
  {"name": "/<actual-command>", "category": "<category>", "description": "<what the command does>"}
], "visibility": "owner" }
\`\`\`

The owner's UI will display a command palette with your registered commands. When the owner sends one, answer according to the description you published.

## Shared Tag Memory
If the owner assigned shared tags in Data Access, use \`agents.tag.<tag>.*\` keys for same-owner shared project state, queues, handoff notes, and team context. Write shared entries with \`visibility: "owner"\` and \`tags: ["<tag>"]\`. To read the shared area through memory listing tools or REST, use \`owner_scope=true\`, \`prefix=agents.tag.<tag>.\`, and the same tag filter. Keep private agent-local secrets out of shared tag memory.
`;
}

function renderTelemetryProtocol(ctx: BundleContext): string {
  return `# Telemetry Protocol

## Why Telemetry Matters
Telemetry feeds into your readiness score. Agents that report telemetry consistently score higher and get more permissions.

## Reporting Telemetry

\`\`\`
POST /v1/agents/${ctx.agentName}/telemetry
{
  "type": "llm_call",
  "tokens_in": 1523,
  "tokens_out": 847,
  "model": "openrouter/free",
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
PUT /v1/agents/${ctx.agentName}/capabilities
{
  "technical": [
    { "name": "memory", "type": "skill" },
    { "name": "tasks", "type": "skill" },
    { "name": "messages", "type": "skill" },
    { "name": "web_scraping", "type": "tool" }
  ],
  "domain": ["grocery_monitoring", "price_comparison"],
  "languages": ["en", "fi"],
  "modules_loaded": ["tier1", "tier1/tasks", "tier1/messages"],
  "limitations": ["session-scoped runtime, requires external polling"]
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
POST /v1/agents/${ctx.agentName}/tasks/{task_id}/event
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
