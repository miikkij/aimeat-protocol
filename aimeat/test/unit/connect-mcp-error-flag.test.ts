/**
 * @file connect-mcp-error-flag.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When the node refuses a call, does the connector's MCP tool SAY it was refused?
 *
 *   `isError` is the only thing in an MCP result that means "this did not happen". Leave it off and
 *   a refusal arrives as a successful tool call whose text happens to say no -- and a model reading
 *   a successful call that came back with no rows draws the obvious conclusion, which is that there
 *   are no rows. That is how "you may not read this" becomes "your inbox is empty".
 *
 *   MEASURED, NOT READ. On 2026-09-06, against a live `aimeat connect serve` daemon on the tunnel
 *   with an agent narrowed to [memory:read, memory:write], `aimeat_dm_inbox` and `aimeat_dm_thread`
 *   answered a 403 SCOPE_DENIED with `isError: undefined`, while `aimeat_schedule_list` beside them
 *   set it. A count of the surface then put 144 of 163 return sites in the first group -- the flag
 *   was present exactly where somebody had happened to think of it.
 * @structure Every tool is REGISTERED and INVOKED, not scanned. The client is the real
 *   `AimeatClient` with a transport that refuses everything, so what is measured is the result the
 *   handler actually builds. A tool whose handler never reaches the client is recorded as
 *   `unmeasured` and must be listed in NEVER_CALLS_THE_NODE with a reason -- otherwise a tool that
 *   silently refuses its own arguments would pass this suite while measuring nothing, which is the
 *   hole cli-tool-param-forwarding.test.ts had to close in its own v1.1.0.
 * @usage pnpm exec vitest run test/unit/connect-mcp-error-flag.test.ts
 * @version-history
 *   v1.0.0 -- 2026-09-07 -- Written with the sweep it guards.
 */
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { AimeatClient, type Transport } from '../../src/cli/connect/api-client.js';
import { AgentRegistry } from '../../src/cli/connect/agent-registry.js';
import { registerAllTools } from '../../src/cli/connect/mcp/tools/index.js';

const AGENT = 'flagbot';
const OWNER = 'flagowner';
const NODE_ID = 'aimeat-local-001-dev';
const GAII = `${AGENT}#${OWNER}@${NODE_ID}`;

/** The node's real refusal, copied from a sandbox measurement on 2026-09-06. */
const REFUSAL = {
  ok: false,
  protocol: 'aimeat',
  version: 'v1',
  error: {
    code: 'SCOPE_DENIED',
    message: 'Scope "messages:read" required. Agent scopes: [memory:read, memory:write]',
  },
};

/**
 * Tools whose handler legitimately never reaches the node on this surface, so "the client was not
 * called" is the right answer for them rather than a dead door. Every entry carries the reason.
 */
const NEVER_CALLS_THE_NODE = new Map<string, string>([
  ['aimeat_iam_define', 'Pure local computation: levels + commands become an IAM block the caller pastes into an app. There is no route behind it.'],
  ['aimeat_knowledge_contribute', 'Answers with a refusal by design — see knowledgeContributeUnreachable().'],
]);

/**
 * Shaped arguments for tools that check the SHAPE of an optional parameter before calling, so a
 * generic "probe" string never gets them as far as the node. Without these they would sit in
 * REFUSES_A_GENERIC_PROBE untested; with them the node-refusal path is actually measured.
 */
const PROBE_SETUP: Record<string, Record<string, unknown>> = {
  aimeat_datapackage_export: { ref: 'pkg:someone/thing' },
  aimeat_datamap_get: { app: 'someone/thing.html' },
  aimeat_datamap_set: { app: 'someone/thing.html', data_map: { spec: 'aimeat.datamap/1' } },
  aimeat_skill_get: { name: 'probe' },
  aimeat_skill_publish: { skill_md: '---\nname: probe\ndescription: probe\n---\nbody\n' },
  aimeat_crew_try: { doc: { name: 'probe' }, prompt: 'probe' },
  aimeat_crew_publish: { doc: { name: 'probe' } },
  aimeat_workspace_create: { manifest: { objectTypes: [] } },
  aimeat_workspace_update: { name: 'probe' },
  aimeat_workspace_member_grant: { ws: 'ws-probe' },
  aimeat_workspace_member_revoke: { ws: 'ws-probe' },
  aimeat_workspace_transfer: { direction: 'export', ws: 'ws-probe' },
  aimeat_workspace_rows_delete: { row_id: 'row-probe' },
  aimeat_operator_ai_config: { daily_budget_usd: 1 },
  aimeat_operator_agent_configure: { mode: 'interactive' },
  aimeat_workspace_write: { space: 'note', id: 'probe', value: { title: 'probe', markdown: 'probe' } },
};

/**
 * Tools that refuse a generic probe before they call anything -- every one of them by checking an
 * optional parameter it was not given. They are NOT holes: each answers `isError: true`, and that
 * is asserted below rather than taken on trust, so nothing can hide here. What they are is
 * unmeasured for the node-refusal path, which makes this list debt: it may only shrink, and the way
 * to shrink it is a PROBE_SETUP entry that drives the tool as far as the node.
 */
const REFUSES_A_GENERIC_PROBE = new Set<string>([]);

/** Refuses everything, and counts what it was asked, so "nothing reached the node" is visible. */
class RefusingTransport implements Transport {
  calls = 0;
  async request(): Promise<{ status: number; body: unknown }> {
    this.calls++;
    return { status: 403, body: REFUSAL };
  }
}

/** One plausible value per declared field, from the tool's own published JSON Schema. */
function probeValue(schema: Record<string, unknown>, depth = 0): unknown {
  if (depth > 3) return 'probe';
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return probeValue(schema.anyOf[0] as Record<string, unknown>, depth + 1);
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

/** Arguments that satisfy every REQUIRED field, so the handler runs instead of zod refusing it. */
function probeArgs(tool: string, inputSchema: Record<string, unknown>): Record<string, unknown> {
  const props = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((inputSchema.required as string[] | undefined) ?? []);
  const args: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(props)) {
    // `agent_name` picks which loaded agent acts, and there is only one; but on a few tools it
    // names the TARGET agent instead and is required, and skipping it there means zod refuses the
    // call and the handler never runs.
    if (name === 'agent_name' && !required.has(name)) continue;
    if (required.has(name)) args[name] = probeValue(schema);
  }
  return { ...args, ...(PROBE_SETUP[tool] ?? {}) };
}

async function surface(): Promise<{ client: Client; transport: RefusingTransport; close: () => Promise<void> }> {
  const transport = new RefusingTransport();
  const api = new AimeatClient(`http://127.0.0.1:9`, 'narrow-token', { agent: AGENT, owner: OWNER });
  api.setTransport(transport);

  const registry = new AgentRegistry();
  registry.add({
    gaii: GAII, agent: AGENT, owner: OWNER, client: api,
    config: { node_url: 'http://127.0.0.1:9' },
  });

  const mcp = new McpServer({ name: 'connector', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerAllTools(mcp, registry);

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'flag-probe', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
  return { client, transport, close: async () => { await client.close(); await mcp.close(); } };
}

describe('the connector MCP says when a call was refused', () => {
  it('flags every tool the node refused, and reaches the node for all but the listed few', async () => {
    const { client, transport, close } = await surface();
    try {
      const listed = await client.listTools();
      expect(listed.tools.length).toBeGreaterThan(250);

      const missingFlag: string[] = [];
      const answeredOkHavingDoneNothing: string[] = [];
      const refusedProbe: string[] = [];
      const measured: string[] = [];
      const threw: string[] = [];

      for (const tool of listed.tools) {
        const before = transport.calls;
        let result: { isError?: unknown } | null = null;
        try {
          result = await client.callTool({
            name: tool.name,
            arguments: probeArgs(tool.name, (tool.inputSchema ?? {}) as Record<string, unknown>),
          }) as { isError?: unknown };
        } catch (err) {
          threw.push(`${tool.name}: ${(err as Error).message}`);
          continue;
        }
        if (transport.calls > before) {
          measured.push(tool.name);
          if (result?.isError !== true) missingFlag.push(tool.name);
          continue;
        }
        if (NEVER_CALLS_THE_NODE.has(tool.name)) continue;
        // Nothing reached the node. That is allowed only when the tool SAID it did nothing --
        // otherwise it is the very defect this suite exists for, one step earlier: a tool answering
        // ok having refused its own input.
        if (result?.isError !== true) answeredOkHavingDoneNothing.push(tool.name);
        else refusedProbe.push(tool.name);
      }

      expect(threw, 'tools that threw instead of answering').toEqual([]);
      expect(missingFlag, 'tools that reached a REFUSING node and answered without isError').toEqual([]);
      expect(answeredOkHavingDoneNothing, 'tools that called nothing and did not say so').toEqual([]);
      expect([...refusedProbe].sort(), 'tools this probe cannot drive as far as the node; add a PROBE_SETUP entry, or list them in REFUSES_A_GENERIC_PROBE')
        .toEqual([...REFUSES_A_GENERIC_PROBE].sort());

      // The suite has to be reaching most of the surface, or an empty `missingFlag` means nothing.
      expect(measured.length).toBeGreaterThan(listed.tools.length * 0.9);
    } finally {
      await close();
    }
  }, 120_000);

  it('does not flag a call the node accepted', async () => {
    // The other half of the gate: a flag that is always on says as little as one that is always off.
    const api = new AimeatClient('http://127.0.0.1:9', 'token', { agent: AGENT, owner: OWNER });
    api.setTransport({ async request() { return { status: 200, body: { ok: true, data: { items: [], total: 0 } } }; } });
    const registry = new AgentRegistry();
    registry.add({ gaii: GAII, agent: AGENT, owner: OWNER, client: api, config: { node_url: 'http://127.0.0.1:9' } });
    const mcp = new McpServer({ name: 'connector', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerAllTools(mcp, registry);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'ok-probe', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
    try {
      for (const name of ['aimeat_dm_inbox', 'aimeat_memory_list', 'aimeat_schedule_list', 'aimeat_agents_list']) {
        const r = await client.callTool({ name, arguments: {} }) as { isError?: unknown };
        expect(r.isError, `${name} flagged an accepted call as an error`).not.toBe(true);
      }
    } finally {
      await client.close();
      await mcp.close();
    }
  }, 60_000);
});
