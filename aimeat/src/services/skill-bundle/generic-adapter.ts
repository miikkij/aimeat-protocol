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
