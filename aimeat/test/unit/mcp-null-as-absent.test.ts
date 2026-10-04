/**
 * @file mcp-null-as-absent.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A null sent for an optional field that refuses null reads as the field left out
 *   (src/mcp/null-as-absent.ts), and a null on a field that accepts null is kept.
 *
 *   Found by crewfive, 2026-10-03: CrewAI sends every optional field it was not given as null, nested
 *   ones included, and the node refused "expected string, received null at todos[0].description".
 *   Each case runs over a real MCP client and server pair, so the SDK's own input check is the one
 *   under test, and the control server without the helper shows the refusal it replaces.
 * @usage pnpm exec vitest run test/unit/mcp-null-as-absent.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { treatNullAsAbsent } from '../../src/mcp/null-as-absent.js';

async function serverWith(repair: boolean) {
  const mcp = new McpServer({ name: 'null-as-absent-test', version: '1.0.0' });
  if (repair) treatNullAsAbsent(mcp);
  const received: unknown[] = [];
  mcp.tool('propose', {
    task_id: z.string(),
    note: z.string().optional(),
    // A field where null means "clear", like task_start or CORS origins.
    clear: z.string().nullable().optional(),
    todos: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      estimate_minutes: z.number().optional(),
    })),
  }, async (args) => {
    received.push(args);
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverT);
  const client = new Client({ name: 'probe', version: '1.0.0' });
  await client.connect(clientT);
  const call = (args: Record<string, unknown>) => client.callTool({ name: 'propose', arguments: args });
  return { call, received };
}

const crewArgs = {
  task_id: 't-1', note: null,
  todos: [{ title: 'Read', description: null, estimate_minutes: null }, { title: 'Write', description: 'x' }],
};

describe('a null on an optional field', () => {
  it('is refused by the SDK on its own (the control)', async () => {
    const { call, received } = await serverWith(false);
    const r = await call(crewArgs);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/Input validation error/);
    expect(received).toHaveLength(0);
  });

  it('reads as left out, at the top level and inside a list item', async () => {
    const { call, received } = await serverWith(true);
    const r = await call(crewArgs);
    expect(r.isError).toBeFalsy();
    expect(received).toEqual([{ task_id: 't-1', todos: [{ title: 'Read' }, { title: 'Write', description: 'x' }] }]);
  });

  it('is kept where the field accepts null', async () => {
    const { call, received } = await serverWith(true);
    const r = await call({ task_id: 't-1', clear: null, todos: [{ title: 'A', description: null }] });
    expect(r.isError).toBeFalsy();
    expect(received).toEqual([{ task_id: 't-1', clear: null, todos: [{ title: 'A' }] }]);
  });

  it('on a required field is still refused, with the original error', async () => {
    const { call, received } = await serverWith(true);
    const r = await call({ task_id: 't-1', todos: [{ title: null, description: null }] });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/Input validation error/);
    expect(received).toHaveLength(0);
  });
});
