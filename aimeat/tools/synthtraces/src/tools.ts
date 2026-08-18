/**
 * @file tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AIMEAT tool surface exposed to the agent model (Anthropic /
 *   OpenAI tool-use schema) plus the dispatcher that maps each tool call to a
 *   real AIMEAT action via the active AgentDriver (REST or MCP). This is the
 *   SynthTraces core: the model decides, the harness executes against a live
 *   node and records the result.
 * @structure AGENT_TOOLS, ToolContext, ToolOutcome, dispatchTool()
 * @usage import { AGENT_TOOLS, dispatchTool } from './tools.js';
 * @version-history
 *   v0.2.0 -- 2026-06-05 -- Dispatch via AgentDriver (transport-agnostic: REST or MCP)
 *   v0.1.0 -- 2026-06-05 -- Initial PoC tool surface (memory + task lifecycle + reply)
 */

import type { AgentDriver } from './driver.js';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolContext {
  driver: AgentDriver;
  taskId: string;
  threadId: string;
}

export interface ToolOutcome {
  result: string;
  ok: boolean;
  status: number;
  /** Channel that handled the call (set by hybrid driver; else selfplay fills driver.label). */
  via?: string;
  terminal?: 'completed' | 'failed';
  replied?: boolean;
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'aimeat_memory_write',
    description: 'Persist a key-value entry in your AIMEAT memory. Use for anything the owner asks you to remember.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Dot-separated key, e.g. "pref.music".' },
        value: { description: 'Any JSON value (string, number, object).' },
        visibility: { type: 'string', enum: ['private', 'public', 'shared'], description: 'Default private.' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'aimeat_memory_read',
    description: 'Read back a single memory entry by key.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'aimeat_memory_list',
    description: 'List your memory entries, optionally filtered by key prefix.',
    input_schema: { type: 'object', properties: { prefix: { type: 'string' } } },
  },
  {
    name: 'aimeat_task_event',
    description: 'Append a progress event to the current task timeline. Call this to narrate what you did.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['progress', 'memory_write', 'verification', 'message'] },
        message: { type: 'string' },
      },
      required: ['type', 'message'],
    },
  },
  {
    name: 'aimeat_reply_to_owner',
    description: 'Send a message to the owner — use to ask a clarifying question or report a result. The owner may reply.',
    input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'aimeat_complete_task',
    description: 'Mark the current task done. Call this only when the owner request is fully satisfied.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Short completion summary.' } },
      required: ['message'],
    },
  },
  {
    name: 'aimeat_fail_task',
    description: 'Mark the current task failed when you cannot complete it.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
];

export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { driver, taskId, threadId } = ctx;
  switch (name) {
    case 'aimeat_memory_write': {
      const r = await driver.memoryWrite({ key: String(input.key), value: input.value, visibility: input.visibility as string | undefined });
      return { ok: r.ok, status: r.status, via: r.via, result: r.ok ? `stored "${String(input.key)}"` : `error: ${r.message}` };
    }
    case 'aimeat_memory_read': {
      const r = await driver.memoryRead(String(input.key));
      return { ok: r.ok, status: r.status, via: r.via, result: r.ok ? `value: ${JSON.stringify(r.value)}` : `error: ${r.message}` };
    }
    case 'aimeat_memory_list': {
      const r = await driver.memoryList(input.prefix as string | undefined);
      return { ok: r.ok, status: r.status, via: r.via, result: r.ok ? `keys: ${JSON.stringify(r.keys)}` : `error: ${r.message}` };
    }
    case 'aimeat_task_event': {
      const r = await driver.taskEvent(taskId, { type: String(input.type), message: String(input.message) });
      return { ok: r.ok, status: r.status, via: r.via, result: r.ok ? 'event logged' : `error: ${r.message}` };
    }
    case 'aimeat_reply_to_owner': {
      const r = await driver.sendMessage({ content: String(input.content), threadId, taskId });
      return { ok: r.ok, status: r.status, via: r.via, replied: true, result: r.ok ? 'message sent to owner' : `error: ${r.message}` };
    }
    case 'aimeat_complete_task': {
      const r = await driver.completeTask(taskId, String(input.message ?? ''));
      return { ok: r.ok, status: r.status, via: r.via, terminal: 'completed', result: r.ok ? 'task completed' : `error: ${r.message}` };
    }
    case 'aimeat_fail_task': {
      const r = await driver.failTask(taskId, String(input.reason ?? ''));
      return { ok: r.ok, status: r.status, via: r.via, terminal: 'failed', result: r.ok ? 'task failed' : `error: ${r.message}` };
    }
    default:
      return { ok: false, status: 0, result: `unknown tool: ${name}` };
  }
}
