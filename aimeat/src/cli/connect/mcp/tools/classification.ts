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
 *   v1.2.0 — 2026-09-30 — exception_list and exception_set with exception_action and until;
 *     audit_action takes exception.
 *   v1.1.0 — 2026-09-29 — The explorer and switch_set actions, with pending, cursor and mode; owner
 *     on get, set and review.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, envelopeResult, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import {
  AUDIT_ACTIONS, CLASSIFICATION_ACTIONS, classificationTools, EXCEPTION_ACTION_VALUES,
} from '../../../../tool-catalog/definitions/classification.js';
import { classificationCall } from '../../../../tool-dispatch/classification-call.js';

/** A parameter's description, from the catalog entry every surface publishes. */
const d = (field: string): string => classificationTools[0]?.input?.[field]?.description ?? field;

export function registerClassificationTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_classification', descriptionFor('aimeat_classification'), {
    agent_name: agentNameSchema,
    action: z.enum(CLASSIFICATION_ACTIONS).describe(d('action')),
    keys: z.array(z.string()).max(500).optional().describe(d('keys')),
    prefix: z.string().optional().describe(d('prefix')),
    since: z.string().optional().describe(d('since')),
    audit_action: z.enum(AUDIT_ACTIONS).optional().describe(d('audit_action')),
    exception_action: z.enum(EXCEPTION_ACTION_VALUES).optional().describe(d('exception_action')),
    until: z.string().optional().describe(d('until')),
    limit: z.number().int().min(1).max(1000).optional().describe(d('limit')),
    pending: z.boolean().optional().describe(d('pending')),
    cursor: z.string().optional().describe(d('cursor')),
    mode: z.enum(['off', 'owner', 'all']).optional().describe(d('mode')),
    kind: z.enum(['memory', 'file', 'row']).optional().describe(d('kind')),
    key: z.string().optional().describe(d('key')),
    organism_id: z.string().optional().describe(d('organism_id')),
    ws: z.string().optional().describe(d('ws')),
    space: z.string().optional().describe(d('space')),
    row_id: z.string().optional().describe(d('row_id')),
    owner: z.string().optional().describe(d('owner')),
    label: z.string().optional().describe(d('label')),
    justification: z.string().optional().describe(d('justification')),
    human_said: z.string().optional().describe(d('human_said')),
    confidence: z.number().min(0).max(1).optional().describe(d('confidence')),
    reason: z.string().optional().describe(d('reason')),
    decision: z.enum(['accept', 'reject']).optional().describe(d('decision')),
    level: z.enum(['node', 'owner', 'organism']).optional().describe(d('level')),
    policy: z.record(z.string(), z.unknown()).optional().describe(d('policy')),
  }, annotationsFor('aimeat_classification'), async ({ agent_name, ...args }) => {
    const { client } = pickAgent(registry, agent_name);
    return envelopeResult(await classificationCall(client, args));
  });
}
