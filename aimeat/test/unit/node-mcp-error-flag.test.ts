/**
 * @file node-mcp-error-flag.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When the work behind a NODE MCP tool fails, does the tool say so?
 *
 *   The sibling suite asks this of the connector's surface, where the answer was 144 return sites
 *   out of 163 relaying a refusal as a success. This one asks it of the node's own surface, where
 *   the shape is different: these tools do the work themselves against storage and services, and a
 *   tool the agent's scopes exclude is never registered at all. So the question is not "was a
 *   refusal relayed" but "did a failure reach the caller".
 *
 *   MEASURED, NOT REASONED. This suite exists because the claim "the node surface has the same
 *   defect" was made from a shared helper's NAME and was wrong — 265 of the 266 tools that reached
 *   a broken storage flagged it. The one that did not was `aimeat_notify`: `notify()` swallows a
 *   storage failure BY DESIGN so the action that triggered a notification still succeeds, which is
 *   right for the four call sites where notifying is a side effect, and `createPrincipalNotification`
 *   then returned the literal `created: true`. The tool's own try/catch was correct and unreachable.
 * @structure One probe: every tool invoked against a storage whose every method throws.
 * @usage pnpm exec vitest run test/unit/node-mcp-error-flag.test.ts
 * @version-history
 *   v1.0.0 -- 2026-09-07 -- Written with the notify fix it guards.
 */
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { registerAllServerTools } from '../../src/mcp/register-all.js';

/** One plausible value per declared field, from the tool's own published JSON Schema. */
function probeValue(schema: Record<string, unknown>, depth = 0): unknown {
  if (depth > 3) return 'probe';
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return probeValue(schema.anyOf[0] as Record<string, unknown>, depth + 1);
  switch (schema.type) {
    case 'string': return 'probe';
    case 'number': case 'integer': return 1;
    case 'boolean': return true;
    case 'array': return [probeValue((schema.items ?? { type: 'string' }) as Record<string, unknown>, depth + 1)];
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const req = new Set((schema.required as string[] | undefined) ?? []);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) if (req.has(k)) out[k] = probeValue(v, depth + 1);
      return out;
    }
    default: return 'probe';
  }
}

describe('the node MCP says when the work behind a tool failed', () => {
  it('flags every tool that reached a broken storage', async () => {
    let storageCalls = 0;
    // Every method throws. Not a mock of one failure mode — the question is only whether a thrown
    // failure reaches the caller, and a Proxy asks it of all of them without naming any.
    const throwingStorage = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return () => { storageCalls++; throw new Error(`storage refused: ${String(prop)}`); };
      },
    }) as unknown as Storage;

    const noop = () => {};
    const mcp = new McpServer({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerAllServerTools(mcp, {
      storage: throwingStorage,
      // Every optional feature on and every scope held, for the same reason the schema audit does
      // it: this asks what the SURFACE does, not what one node has turned on for one agent.
      config: {
        nodeId: 'probe-node', baseUrl: 'http://localhost', mcpEnforceScopes: true,
        commerceEnabled: true, portfolioEnabled: true,
      } as unknown as AimeatConfig,
      agentGaii: () => 'probebot#owner@probe-node',
      owner: () => 'owner',
      scopes: ['*'],
      peers: new Map(),
      getToken: () => undefined,
      emitResourceUpdated: noop,
      emitResourceListChanged: noop,
    });

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'probe', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);

    const silent: string[] = [];
    const flagged: string[] = [];
    const neverTouched: string[] = [];
    try {
      const listed = await client.listTools();
      expect(listed.tools.length).toBeGreaterThan(250);

      for (const tool of listed.tools) {
        const schema = (tool.inputSchema ?? {}) as Record<string, unknown>;
        const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        const required = new Set((schema.required as string[] | undefined) ?? []);
        const args: Record<string, unknown> = {};
        for (const [name, s] of Object.entries(props)) if (required.has(name)) args[name] = probeValue(s);

        const before = storageCalls;
        let r: { isError?: unknown };
        try { r = await client.callTool({ name: tool.name, arguments: args }) as { isError?: unknown }; }
        catch { flagged.push(tool.name); continue; }   // a throw the SDK turned into an error is an answer

        // A tool that never reached storage refused the probe's arguments first, which is its job.
        // It is not measured by this run and it is not counted as a pass either.
        if (storageCalls === before) { neverTouched.push(tool.name); continue; }
        if (r?.isError === true) flagged.push(tool.name);
        else silent.push(tool.name);
      }

      expect(silent, 'tools that reached a BROKEN storage and answered without isError').toEqual([]);
      // An empty `silent` means nothing if the probe drove nothing: most of the surface has to have
      // actually reached storage, or this suite passes by not asking.
      expect(flagged.length, `only ${flagged.length} of ${listed.tools.length} tools reached storage; the probe is not driving the surface`)
        .toBeGreaterThan(listed.tools.length * 0.6);
    } finally {
      await client.close();
      await mcp.close();
    }
  }, 120_000);
});
