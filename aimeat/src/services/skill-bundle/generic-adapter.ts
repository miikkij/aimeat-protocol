/**
 * @file generic-adapter.ts
 * @description Generic fallback runtime adapter for skill bundle generation.
 *   Produces aimeat-agent bundle with minimal SKILL.md + references only.
 *   Used for runtimes without a dedicated adapter (e.g. crewai, langgraph,
 *   autogen, hand-rolled MCP-capable agents).
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 *   v1.1.0 -- 2026-05-28 -- Clarify connected agent identity and Hello Integration MCP flow
 *   v1.1.1 -- 2026-05-28 -- Include task TODO completion in Hello Integration guidance
 *   v1.1.2 -- 2026-05-28 -- State that Hello Integration is required first-run onboarding
 *   v1.1.3 -- 2026-05-28 -- Clarify post-onboarding setup publishes actual commands, config, and knowledge artifacts
 *   v1.1.4 -- 2026-05-28 -- Add shared owner-memory tag guidance
 *   v1.2.0 -- 2026-05-29 -- Add Anthropic Agent-Skill style YAML frontmatter
 *     (name/description/trigger) so frameworks that natively load SKILL.md as a
 *     skill (CrewAI >= 1.14 via discover_skills(), Claude Agent Skills, future
 *     LangGraph/AutoGen adapters) can register the bundle as a first-class
 *     skill rather than reading it as free-form text. Bundle content below the
 *     frontmatter is unchanged; existing LLM-driven flows that parse the body
 *     are unaffected. The hermes-adapter has shipped with frontmatter since
 *     v1.0.0 and proved the format is non-breaking for downstream consumers.
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

    // Frontmatter is required for frameworks that auto-discover skills (CrewAI's
    // discover_skills(), Anthropic Agent Skills). CrewAI's strict validation:
    //   - REQUIRED: name (str), description (str)
    //   - OPTIONAL: license, compatibility, metadata (dict), allowed_tools (list)
    //   - DIRECTORY name MUST equal frontmatter `name` -- CrewAI rejects with
    //     "Directory name X does not match skill name Y"
    //
    // Because the bundle is downloaded into ~/.aimeat/agents/<agent_name>/, we
    // set `name` to <agent_name> so the directory-vs-name check passes. Each
    // agent's bundle is therefore its OWN distinct Skill in CrewAI -- e.g. a
    // demo-crew Skill, a company-crew Skill, etc. This is actually useful:
    // crews with multiple AIMEAT identities (rare but legal) get distinct skill
    // namespaces.
    //
    // `trigger` and `tags` are AIMEAT/Anthropic conventions that CrewAI does
    // NOT understand as top-level keys (it just ignores them harmlessly).
    // Stuffed into `metadata: {...}` they survive into the loaded Skill object
    // as inspectable data, AND they remain present as YAML so an LLM reading
    // the raw SKILL.md still sees them.
    return `---
name: ${ctx.agentName}
description: AIMEAT node integration for agent ${ctx.agentName} on ${ctx.nodeUrl} -- identity, shared memory, task lifecycle, capabilities catalog, federation. Activate when the agent needs to call any AIMEAT tool, check onboarding status, write to memory, contribute knowledge, complete tasks, or coordinate with other agents.
metadata:
  trigger: when the agent needs to call any AIMEAT tool, check onboarding status, write to memory, contribute knowledge, complete tasks, or coordinate with other agents on the AIMEAT node
  tags: "aimeat, agent-orchestration, mcp"
  aimeat_node_id: ${ctx.nodeId}
  aimeat_node_url: ${ctx.nodeUrl}
  aimeat_agent_gaii: ${ctx.agentGaii}
  aimeat_runtime: generic
---

# AIMEAT Agent Integration

## Identity
- Agent: ${ctx.agentName}
- GAII: ${ctx.agentGaii}
- Node: ${ctx.nodeUrl} (${ctx.nodeId})

If you are the connected AI agent using this runtime, ${ctx.agentName} is your assigned AIMEAT agent name.

Hello Integration is AIMEAT's required first-run onboarding handshake for every newly connected agent. Complete it before normal autonomous work, or report the blocker to your owner.

## Quick Start
1. Use the AIMEAT MCP tools exposed by the connector.
2. Read the handbook with aimeat_handbook_get.
3. Check Hello Integration with aimeat_onboarding_status.
4. Confirm platform and skill installation with aimeat_onboarding_identify_platform and aimeat_onboarding_confirm_skill_installed.
5. Report capabilities with aimeat_agent_capabilities_report.
6. Confirm directives, send a test message, report telemetry, list tasks, propose TODOs for "Onboarding verification", mark the active test task TODOs done, then complete the task.
7. Publish post-onboarding setup: your actual owner-facing command catalogue, real runtime/config artifacts, and any knowledge packages or uploaded artifacts you produced.

If using direct HTTPS instead of MCP, agent-scoped endpoints use your agent name, for example ${ctx.nodeUrl}/v1/agents/${ctx.agentName}/inbox.

## Hello Integration -- exact parameter values

The following step parameters MUST be exact for the server to accept the step. Do NOT substitute, simplify, or default these values.

### identify_platform + confirm_skill_installed -- platform name

The \`platform\` parameter is the name of YOUR runtime/framework, NOT the AIMEAT skill bundle's adapter name. Examples: \`crewai\`, \`langgraph\`, \`autogen\`, \`hermes\`, \`claude\`, \`cursor\`. The metadata field \`aimeat_runtime: generic\` in this SKILL.md's frontmatter refers to which AIMEAT bundle generated this file (generic = fallback adapter); it is NOT the value you pass to \`platform\`.

Use the SAME platform string in both calls:
\`\`\`
aimeat_onboarding_identify_platform({ platform: "<your-runtime>", platform_version: "<version-string>" })
aimeat_onboarding_confirm_skill_installed({ platform: "<your-runtime>", version: "v2" })
\`\`\`

If you genuinely have no framework (raw shell script, hand-rolled HTTPS), use \`"generic"\` for both -- but that is the rare case, not the default.

### publish_config -- memory key MUST include the agent name segment

Write the config to memory key \`agents.config.${ctx.agentName}.runtime\` (literal -- substitute your runtime details into the VALUE, not the key). Do NOT use \`agents.config.runtime\` or any other variant: the publish_config validator checks for that exact key.

\`\`\`
aimeat_memory_write({
  key: "agents.config.${ctx.agentName}.runtime",
  value: { runtime: "<your-runtime>", version: "<runtime-version>", ...extra },
  visibility: "owner"
})
\`\`\`

## Calling conventions

- **Trust per-step API responses.** When \`aimeat_onboarding_*\` returns \`{ ok: true, ... }\` or a step body with \`status: passed\`, that step IS now passed on the server. Do NOT call \`aimeat_onboarding_status\` immediately to "confirm" -- a fresh status snapshot may briefly still show pending due to eventual consistency, and re-running the step wastes tool calls. Use your original status snapshot to find the next pending step.
- **Omit optional parameters instead of passing null.** MCP schema validation rejects explicit null.
- **For \`agent_name\` parameters, always pass \`${ctx.agentName}\`.** Never guess.
- **On \`STEP_NOT_IN_FLOW\` or \`INVALID_STEP\` for an onboarding step:** treat as no-op (your agent's reduced flow doesn't include that step) and continue to the next pending step.

## Directives
${rulesBlock}

## Setup (Manual)
This is a generic skill bundle. You will need to manually configure:
- Polling: set up a cron job or scheduled task to poll the inbox endpoint
- Telemetry: POST to /v1/agents/${ctx.agentName}/telemetry after each LLM call
- Webhook (optional): PUT /v1/agents/${ctx.agentName}/webhook to register a push endpoint

See the references/ directory for full API documentation.

## After Onboarding: Publish Real Commands, Config, and Knowledge

These steps are required after completing Hello Integration. They make your capabilities visible in the owner's dashboard. Do not copy sample commands or config; publish what this runtime actually supports.

### Register Commands (owner sees these in Messages tab)
Introspect your runtime, skills, plugins, and built-in command handling. Register every stable slash command the owner can send to you in AIMEAT Messages. This is your command catalogue, not the AIMEAT MCP tool list.
\`\`\`
POST ${ctx.nodeUrl}/v1/memory
{ "key": "agents.${ctx.agentName}.commands", "value": [
  { "name": "/<actual-command>", "description": "<what this command makes the agent do>", "category": "<category>" }
], "visibility": "owner" }
\`\`\`
The value MUST be a flat array of { name, description, category }. Each name starts with /.
When the owner sends a slash-prefixed message, treat it as a command and answer with the promised information or action result.

### Push Config Files (owner sees these in Agent Config tab)
Publish actual config files, hooks, routes, connector descriptors, or runtime setup snippets under \`agents.config.*\`. If you only use \`aimeat connect serve\` and have no extra config, publish a truthful descriptor for that connector; do not invent a watchdog file.
\`\`\`
POST ${ctx.nodeUrl}/v1/memory
{ "key": "agents.config.<name>", "value": {
  "filename": "<actual-file-or-descriptor>",
  "content": "<actual config or descriptor>",
  "platform": "your-platform"
}, "visibility": "owner" }
\`\`\`

### Use Shared Tag Memory When Assigned
If the owner assigns shared tags in the Data Access tab, those tags are collaboration labels for same-owner agents. Use \`agents.tag.<tag>.*\` keys for shared project state, handoff notes, queues, and team context. Write shared entries with \`visibility: "owner"\` and \`tags: ["<tag>"]\`, then list the area with \`owner_scope=true\`, \`prefix=agents.tag.<tag>.\`, and the same tag filter. Do not store private agent-local secrets in shared tag memory.

### Publish Knowledge Artifacts
If setup or work produced structured research, documentation, datasets, or reusable knowledge, create a real knowledge package instead of a placeholder memory key. Follow \`/llms.txt\`: use \`POST /v1/knowledge/import\` for new packages, \`aimeat_knowledge_contribute\` for entries in existing packages, and \`aimeat_storage_upload\` for large source files or attachments. Report the package ID and manifest key to the owner.

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
