/**
 * @file generic-adapter.ts
 * @description Generic fallback runtime adapter for skill bundle generation.
 *   Produces aimeat-agent bundle with minimal SKILL.md + references only.
 *   Used for runtimes without a dedicated adapter.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 *   v1.1.0 -- 2026-05-28 -- Clarify connected agent identity and Hello Integration MCP flow
 *   v1.1.1 -- 2026-05-28 -- Include task TODO completion in Hello Integration guidance
 *   v1.1.2 -- 2026-05-28 -- State that Hello Integration is required first-run onboarding
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

If you are the connected AI agent using this runtime, ${ctx.agentName} is your assigned AIMEAT agent name.

Hello Integration is AIMEAT's required first-run onboarding handshake for every newly connected agent. Complete it before normal autonomous work, or report the blocker to your owner.

## Quick Start
1. Use the AIMEAT MCP tools exposed by the connector.
2. Read the handbook with aimeat_handbook_get.
3. Check Hello Integration with aimeat_onboarding_status.
4. Confirm platform and skill installation with aimeat_onboarding_identify_platform and aimeat_onboarding_confirm_skill_installed.
5. Report capabilities with aimeat_agent_capabilities_report.
6. Confirm directives, send a test message, report telemetry, list tasks, propose TODOs for "Onboarding verification", mark the active test task TODOs done, then complete the task.

If using direct HTTPS instead of MCP, agent-scoped endpoints use your agent name, for example ${ctx.nodeUrl}/v1/agents/${ctx.agentName}/inbox.

## Directives
${rulesBlock}

## Setup (Manual)
This is a generic skill bundle. You will need to manually configure:
- Polling: set up a cron job or scheduled task to poll the inbox endpoint
- Telemetry: POST to /v1/agents/${ctx.agentName}/telemetry after each LLM call
- Webhook (optional): PUT /v1/agents/${ctx.agentName}/webhook to register a push endpoint

See the references/ directory for full API documentation.

## After Onboarding: Register Commands and Config

These steps are required after completing Hello Integration. They make your capabilities visible in the owner's dashboard.

### Register Commands (owner sees these in Messages tab)
\`\`\`
POST ${ctx.nodeUrl}/v1/memory
{ "key": "agents.${ctx.agentName}.commands", "value": [
  { "name": "/status", "description": "Show current agent status", "category": "general" },
  { "name": "/inbox", "description": "Check inbox for tasks and messages", "category": "tasks" }
], "visibility": "owner" }
\`\`\`
The value MUST be a flat array of { name, description, category }. Each name starts with /.

### Push Config Files (owner sees these in Agent Config tab)
\`\`\`
POST ${ctx.nodeUrl}/v1/memory
{ "key": "agents.config.watchdog", "value": {
  "script": "path/to/your/watchdog",
  "poll_interval": "60s",
  "platform": "your-platform"
}, "visibility": "owner" }
\`\`\`

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
