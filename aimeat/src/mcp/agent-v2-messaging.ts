/**
 * @file src/mcp/agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five Agent v2 messaging tools on the node's MCP surface.
 *
 *   EVERY ONE OF THEM CALLS services/agent-v2-messaging-ops.ts, the same functions the REST doors
 *   call. Nothing here reaches storage, resolves a recipient or decides who may do what: this file
 *   declares parameters and turns an answer into text, which is what the protocol makes it own.
 *
 *   A SESSION HERE IS AN AGENT. The node MCP endpoint authenticates against an agent record, so the
 *   principal handed to the operations is the session caller with the agent role, which is why an agent may
 *   register a delivery target for itself and not for a sibling. Registering one for somebody else
 *   is the account holder's move, and it is made on a surface where the account holder is present.
 *
 * @structure registerAgentV2MessagingTools(mcp, storage, config, getAgentGaii, getOwner, caller?)
 * @usage registerAgentV2MessagingTools(mcp, storage, config, () => agentGaii, () => owner, caller);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — aimeat_v2_message_list takes response_format and gives the catalog's concise view
 *     (secaudit 2026-10, M3).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, shapeResponse } from '../tool-catalog/shape.js';
import {
  sendTurn, listTurns, setPushTarget, listPushTargets, deletePushTarget,
  type Principal, type OpResult,
} from '../services/agent-v2-messaging-ops.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { agentSessionCaller, type CallerContext } from '../services/caller-context.js';

/** One answer, as MCP content. A refusal keeps its code, so a model can tell the kinds apart. */
function reply<T>(out: OpResult<T>, shape: (value: T) => unknown) {
  if (!out.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code: out.code, message: out.message, details: out.details }, null, 2) }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(shape(out.value), null, 2) }] };
}

export function registerAgentV2MessagingTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  getOwner: () => string,
  /** The session's caller (services/caller-context.ts). register-all.ts passes it; a caller that does
   *  not (test/unit/v2-list-concise.test.ts) gets the same agent built from the arguments above. */
  caller: () => CallerContext = () => agentSessionCaller(getAgentGaii(), getOwner(), [], config.nodeId, storage),
): void {
  const principal = (): Principal => caller().auth;

  mcp.registerTool(
    'aimeat_v2_message_send',
    {
        description: descriptionFor('aimeat_v2_message_send'),
        inputSchema: zodShapeFor('aimeat_v2_message_send'),
        annotations: annotationsFor('aimeat_v2_message_send'),
    },
    async (args) => reply(
      await sendTurn(storage, config, principal(), {
        to: args.to, parts: args.parts, role: args.role,
        contextId: args.context_id, taskId: args.task_id, metadata: args.metadata,
      }),
      (message) => ({ message }),
    ),
  );

  mcp.registerTool(
    'aimeat_v2_message_list',
    {
        description: descriptionFor('aimeat_v2_message_list'),
        inputSchema: zodShapeFor('aimeat_v2_message_list'),
        annotations: annotationsFor('aimeat_v2_message_list'),
    },
    async ({ response_format, ...args }) => reply(
      await listTurns(storage, principal(), args),
      // The catalog's concise view: each turn's id, role, from, to and time.
      (messages) => shapeResponse('aimeat_v2_message_list', response_format, { messages, count: messages.length }),
    ),
  );

  mcp.registerTool(
    'aimeat_v2_push_set',
    {
        description: descriptionFor('aimeat_v2_push_set'),
        inputSchema: zodShapeFor('aimeat_v2_push_set'),
        annotations: annotationsFor('aimeat_v2_push_set'),
    },
    async (args) => reply(
      await setPushTarget(storage, config, principal(), args),
      (value) => ({ push_config: value.config, created: value.created }),
    ),
  );

  mcp.registerTool(
    'aimeat_v2_push_list',
    {
        description: descriptionFor('aimeat_v2_push_list'),
        inputSchema: zodShapeFor('aimeat_v2_push_list'),
        annotations: annotationsFor('aimeat_v2_push_list'),
    },
    async (args) => reply(
      await listPushTargets(storage, config, principal(), args.principal),
      (configs) => ({ push_configs: configs, count: configs.length }),
    ),
  );

  mcp.registerTool(
    'aimeat_v2_push_delete',
    {
        description: descriptionFor('aimeat_v2_push_delete'),
        inputSchema: zodShapeFor('aimeat_v2_push_delete'),
        annotations: annotationsFor('aimeat_v2_push_delete'),
    },
    async (args) => reply(
      await deletePushTarget(storage, config, principal(), args.id),
      (id) => ({ deleted: id }),
    ),
  );
}
