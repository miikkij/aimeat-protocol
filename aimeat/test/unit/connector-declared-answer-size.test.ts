/**
 * @file test/unit/connector-declared-answer-size.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector MCP server (`aimeat connect serve`) declares the largest text result
 *   the client accepts on every tool it lists, in every surface role, as the node MCP declares the
 *   operator's limit (mcp/declared-answer-size.ts). Reads the list a client gets, over an in-memory
 *   transport.
 * @version-history
 *   2026-11-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildMcpServer } from '../../src/cli/connect/mcp/server.js';
import { buildRegistry } from '../../src/cli/connect/agent-registry.js';
import type { LoadedAgent } from '../../src/cli/connect/config.js';
import { RESULT_SIZE_META_KEY } from '../../src/mcp/declared-answer-size.js';
import { CLIENT_RESULT_CEILING_CHARS } from '../../src/models/answer-budget.js';

/** One connected agent: the server registers its resources for an agent, and none of this is called. */
const ALICE_BOT: LoadedAgent = {
  agent: 'bot', owner: 'alice', gaii: 'bot#alice@aimeat-local-001-dev', token: 'token-of-bot-alice',
  config: { agent: 'bot', owner: 'alice', node_url: 'http://127.0.0.1:9' } as LoadedAgent['config'],
};

async function declaredBy(role: 'all' | 'agent'): Promise<{ tools: number; sizes: unknown[] }> {
  const mcp = buildMcpServer(role, buildRegistry([ALICE_BOT]));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  const client = new Client({ name: 'declared-size-test', version: '1' });
  await client.connect(clientSide);
  const sizes = new Set<unknown>();
  let tools = 0;
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    for (const t of page.tools) { tools++; sizes.add((t._meta as Record<string, unknown> | undefined)?.[RESULT_SIZE_META_KEY]); }
    cursor = page.nextCursor;
  } while (cursor);
  await client.close();
  return { tools, sizes: [...sizes] };
}

describe('the connector MCP declares the answer size on every tool', () => {
  it('with every tool registered', async () => {
    const { tools, sizes } = await declaredBy('all');
    expect(tools).toBeGreaterThan(50);
    expect(sizes).toEqual([CLIENT_RESULT_CEILING_CHARS]);
  });

  it('on a surface that registers only its own tools', async () => {
    const { tools, sizes } = await declaredBy('agent');
    expect(tools).toBeGreaterThan(0);
    expect(sizes).toEqual([CLIENT_RESULT_CEILING_CHARS]);
  });
});
