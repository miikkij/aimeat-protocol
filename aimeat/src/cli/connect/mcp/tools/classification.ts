/**
 * @file src/cli/connect/mcp/tools/classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_classification on the connector MCP server (TARGET-082 V5): the same input as
 *   the node's tool (src/mcp/classification.ts), sent to /v1/classification/* by
 *   classificationCall(), which the CLI dispatch calls too. The scope checks, the AI rules and the
 *   policy review all happen in the node's services; nothing here decides anything.
 * @structure registerClassificationTools(mcp, registry)
 * @usage registered from cli/connect/mcp/tools/index.ts
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-09-30 — exception_list and exception_set with exception_action and until;
 *     audit_action takes exception.
 *   v1.1.0 — 2026-09-29 — The explorer and switch_set actions, with pending, cursor and mode; owner
 *     on get, set and review.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, envelopeResult, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { classificationCall } from '../../../../tool-dispatch/classification-call.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerClassificationTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_classification', descriptionFor('aimeat_classification'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_classification') }, annotationsFor('aimeat_classification'), async ({ agent_name, ...args }) => {
    const { client } = pickAgent(registry, agent_name);
    return envelopeResult(await classificationCall(client, args));
  });
}
