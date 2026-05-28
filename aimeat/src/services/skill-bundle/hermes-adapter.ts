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
 *   v1.1.0 -- 2026-05-28 -- Clarify connected agent identity and Hello Integration MCP flow
 *   v1.1.1 -- 2026-05-28 -- Include task TODO completion in Hello Integration guidance
 *   v1.1.2 -- 2026-05-28 -- State that Hello Integration is required first-run onboarding
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
If you are the connected AI agent using this runtime, ${ctx.agentName} is your assigned AIMEAT agent name.

Hello Integration is AIMEAT's required first-run onboarding handshake for every newly connected agent. Complete it before normal autonomous work, or report the blocker to your owner.

## On First Run
1. Complete Hello Integration with AIMEAT MCP tools before normal autonomous work: call aimeat_handbook_get, aimeat_onboarding_status, aimeat_onboarding_identify_platform, aimeat_onboarding_confirm_skill_installed, aimeat_agent_capabilities_report, aimeat_onboarding_confirm_directives_read, aimeat_message_send, aimeat_agent_telemetry_report, aimeat_task_list, aimeat_task_propose_todos, aimeat_task_event, aimeat_task_todo, and aimeat_task_complete.
2. Install the watchdog cron job (this delivers AIMEAT messages to you automatically):
   \`\`\`
   cp scripts/poll-inbox.sh ~/.hermes/scripts/
   chmod +x ~/.hermes/scripts/poll-inbox.sh
   (crontab -l 2>/dev/null; echo "*/5 * * * * ~/.hermes/scripts/poll-inbox.sh") | crontab -
   \`\`\`
3. Install the telemetry hook:
   \`\`\`
   cp config/hooks.yaml ~/.hermes/config/
   hermes reload_skills
   \`\`\`
4. Register your commands and config in AIMEAT memory (see "After Setup" section in references)

## On Every Wake
1. Check inbox: GET ${ctx.nodeUrl}/v1/agents/${ctx.agentName}/inbox?since={cursor}
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

## After Onboarding: Register Commands and Config

These steps are required after completing Hello Integration.

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
  "script": "~/.hermes/aimeat_watchdog.sh",
  "poll_interval": "60s",
  "platform": "hermes-agent"
}, "visibility": "owner" }
\`\`\`

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
