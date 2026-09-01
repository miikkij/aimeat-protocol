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
 *   A SESSION HERE IS AN AGENT. The node MCP door authenticates against an agent record, so the
 *   principal handed to the operations carries `roles: ['agent']` — which is why an agent may
 *   register a delivery target for itself and not for a sibling. Registering one for somebody else
 *   is the account holder's move, and it is made on a surface where the account holder is present.
 *
 * @structure registerAgentV2MessagingTools(mcp, storage, config, getAgentGaii, getOwner)
 * @usage registerAgentV2MessagingTools(mcp, storage, config, () => agentGaii, () => owner);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
  sendTurn, listTurns, setPushTarget, listPushTargets, deletePushTarget,
  type Principal, type OpResult,
} from '../services/agent-v2-messaging-ops.js';

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

/** The parts array, as the tool declares it. Validated properly by the model layer behind the ops. */
const partsSchema = z.array(z.record(z.string(), z.unknown()))
  .describe('Ordered parts. Each is {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}.');

export function registerAgentV2MessagingTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  getOwner: () => string,
): void {
  const principal = (): Principal => ({ sub: getAgentGaii(), owner: getOwner(), roles: ['agent'] });

  mcp.tool(
    'aimeat_v2_message_send',
    descriptionFor('aimeat_v2_message_send'),
    {
      to: z.string().describe('The recipient principal on this account: an agent GAII, an ecosystem app, or the owner GHII.'),
      parts: partsSchema,
      role: z.enum(['user', 'agent']).optional().describe('"user" if you are asking, "agent" if you are answering. Default "user".'),
      context_id: z.string().optional().describe('The exchange this turn belongs to. Omit on the first turn.'),
      task_id: z.string().optional().describe('The task this turn belongs to, if there is one.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Carried along, never read by the node.'),
    },
    annotationsFor('aimeat_v2_message_send'),
    async (args) => reply(
      await sendTurn(storage, config, principal(), {
        to: args.to, parts: args.parts, role: args.role,
        contextId: args.context_id, taskId: args.task_id, metadata: args.metadata,
      }),
      (message) => ({ message }),
    ),
  );

  mcp.tool(
    'aimeat_v2_message_list',
    descriptionFor('aimeat_v2_message_list'),
    {
      context_id: z.string().optional().describe('One exchange.'),
      task_id: z.string().optional().describe('The turns of one task.'),
      to: z.string().optional().describe('Turns addressed to this principal.'),
      from: z.string().optional().describe('Turns sent by this principal.'),
      since: z.string().optional().describe('ISO timestamp, exclusive: turns created after it.'),
      limit: z.number().optional().describe('Max turns to return (default 50, max 200).'),
    },
    annotationsFor('aimeat_v2_message_list'),
    async (args) => reply(
      await listTurns(storage, principal(), args),
      (messages) => ({ messages, count: messages.length }),
    ),
  );

  mcp.tool(
    'aimeat_v2_push_set',
    descriptionFor('aimeat_v2_push_set'),
    {
      url: z.string().describe('The https address to POST a turn to.'),
      token: z.string().optional().describe('An opaque string echoed back inside every delivery.'),
      authentication: z.record(z.string(), z.unknown()).optional().describe('{ schemes: ["Bearer"], credentials: "…" }. The credentials are stored and sent, never returned.'),
      id: z.string().optional().describe('Replace this existing target. Must be one already registered on this account.'),
      principal: z.string().optional().describe('Whose deliveries these are. Defaults to you.'),
    },
    annotationsFor('aimeat_v2_push_set'),
    async (args) => reply(
      await setPushTarget(storage, config, principal(), args),
      (value) => ({ push_config: value.config, created: value.created }),
    ),
  );

  mcp.tool(
    'aimeat_v2_push_list',
    descriptionFor('aimeat_v2_push_list'),
    { principal: z.string().optional().describe('Account holder only: whose targets to list.') },
    annotationsFor('aimeat_v2_push_list'),
    async (args) => reply(
      await listPushTargets(storage, config, principal(), args.principal),
      (configs) => ({ push_configs: configs, count: configs.length }),
    ),
  );

  mcp.tool(
    'aimeat_v2_push_delete',
    descriptionFor('aimeat_v2_push_delete'),
    { id: z.string().describe('The target id, from aimeat_v2_push_list.') },
    annotationsFor('aimeat_v2_push_delete'),
    async (args) => reply(
      await deletePushTarget(storage, config, principal(), args.id),
      (id) => ({ deleted: id }),
    ),
  );
}
