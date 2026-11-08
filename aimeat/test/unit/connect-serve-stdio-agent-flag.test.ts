/**
 * @file test/unit/connect-serve-stdio-agent-flag.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect serve --agent X` in stdio mode serves agent X only.
 *
 *   THE CASE. A CrewAI liaison spawns `aimeat connect serve --agent <its agent>` (stdio_params in
 *   python/aimeat-crewai). runServe loaded every credential in the connector home and ignored the
 *   flag, so a tool call whose `agent_name` argument named another loaded agent was made with that
 *   agent's credential. With --agent, the stdio registry holds the named agent only, and a call that
 *   names another agent answers that it is not loaded, with nothing sent to the node.
 *
 *   THE USES KEPT. Without --agent (Claude Desktop's config, clients/claude.ts) every agent in the
 *   home stays selectable by agent_name; a call with no agent_name under --agent answers as that
 *   agent; --owner picks between two owners' agents of one name.
 *
 *   runServe itself is run: the credentials come from a mocked loadAllAgents, the stdio transport is
 *   replaced by a capture of the server factory, the pollers by a capture of the entries, and every
 *   agent's client gets a recording transport, so the test sees whose credential a call used.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-serve-stdio-agent-flag.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15, cli/connect/mcp/server.ts:runServe:stdio-agent-flag-ignored).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import type { LoadedAgent } from '../../src/cli/connect/config.js';
import type { RegisteredAgent } from '../../src/cli/connect/agent-registry.js';

const NODE = 'aimeat-local-001-dev';
const state = vi.hoisted(() => ({
    loaded: [] as unknown[],
    factory: null as null | (() => unknown),
    pollers: [] as unknown[],
}));

vi.mock('../../src/cli/connect/config.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/cli/connect/config.js')>();
    return {
        ...real,
        loadAllAgents: async () => state.loaded,
        loadAgentByName: async (agent: string, owner?: string) => {
            const m = (state.loaded as LoadedAgent[]).filter(a => a.agent === agent && (!owner || a.owner === owner));
            if (m.length > 1) throw new Error(`Agent "${agent}" exists under multiple owners (${m.map(x => x.owner).join(', ')}). Pass --owner to disambiguate.`);
            return m[0] ?? null;
        },
    };
});
vi.mock('@modelcontextprotocol/server/stdio', () => ({
    serveStdio: (factory: () => unknown) => { state.factory = factory; },
}));
vi.mock('../../src/cli/connect/mcp/poller.js', () => ({
    startPollerForAgent: (entry: unknown) => { state.pollers.push(entry); },
}));

const { runServe } = await import('../../src/cli/connect/mcp/server.js');

function agent(name: string, owner: string): LoadedAgent {
    return {
        agent: name, owner, gaii: `${name}#${owner}@${NODE}`, token: `token-of-${name}-${owner}`,
        config: { agent: name, owner, node_url: 'http://127.0.0.1:9' },
    };
}

/** Whose credential reached the node, one entry per request. */
let used: string[] = [];

async function serveAndConnect(flags: Record<string, string>): Promise<{ client: Client; close: () => Promise<void> }> {
    await runServe(flags);
    for (const entry of state.pollers as RegisteredAgent[]) {
        entry.client.setTransport({
            async request() {
                used.push(entry.gaii);
                return { status: 200, body: { ok: true, data: { key: 'k', items: [] } } };
            },
        });
    }
    expect(state.factory, 'runServe served stdio').not.toBeNull();
    const mcp = state.factory!() as McpServer;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'liaison', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
    return { client, close: async () => { await client.close(); await mcp.close(); } };
}

async function write(client: Client, agentName?: string): Promise<{ isError?: unknown; text: string }> {
    const args: Record<string, unknown> = { key: 'notes.one', value: 'hello' };
    if (agentName !== undefined) args.agent_name = agentName;
    const r = await client.callTool({ name: 'aimeat_memory_write', arguments: args }) as { isError?: unknown; content?: Array<{ text?: string }> };
    return { isError: r.isError, text: (r.content ?? []).map(c => c.text ?? '').join(' ') };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    state.loaded = [agent('alice-bot', 'alice'), agent('bob-bot', 'alice')];
    state.factory = null;
    state.pollers = [];
    used = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

describe('connect serve --agent in stdio mode', () => {
    it('a tool call naming another agent in the home is not made with that agent\'s credential', async () => {
        const { client, close } = await serveAndConnect({ agent: 'alice-bot' });
        try {
            const r = await write(client, 'bob-bot');
            expect(used).not.toContain(`bob-bot#alice@${NODE}`);
            expect(used).toEqual([]);
            expect(r.isError).toBe(true);
            expect(r.text).toMatch(/not loaded/);
        } finally { await close(); }
    });

    it('serves and polls for the named agent only', async () => {
        const { close } = await serveAndConnect({ agent: 'alice-bot' });
        try {
            expect((state.pollers as RegisteredAgent[]).map(p => p.gaii)).toEqual([`alice-bot#alice@${NODE}`]);
        } finally { await close(); }
    });

    it('a call with no agent_name answers as the --agent agent', async () => {
        const { client, close } = await serveAndConnect({ agent: 'alice-bot' });
        try {
            const r = await write(client);
            expect(r.isError).not.toBe(true);
            expect(used).toEqual([`alice-bot#alice@${NODE}`]);
        } finally { await close(); }
    });

    it('a call naming the --agent agent itself answers as it, by bare name or full identity', async () => {
        const { client, close } = await serveAndConnect({ agent: 'alice-bot' });
        try {
            await write(client, 'alice-bot');
            await write(client, `alice-bot#alice@${NODE}`);
            expect(used).toEqual([`alice-bot#alice@${NODE}`, `alice-bot#alice@${NODE}`]);
        } finally { await close(); }
    });

    it('--agent may be the full identity', async () => {
        const { client, close } = await serveAndConnect({ agent: `alice-bot#alice@${NODE}` });
        try {
            await write(client);
            expect(used).toEqual([`alice-bot#alice@${NODE}`]);
            expect((state.pollers as RegisteredAgent[]).length).toBe(1);
        } finally { await close(); }
    });

    it('--owner picks between two owners\' agents of one name', async () => {
        state.loaded = [agent('crew', 'alice'), agent('crew', 'bob')];
        const { client, close } = await serveAndConnect({ agent: 'crew', owner: 'bob' });
        try {
            await write(client);
            expect(used).toEqual([`crew#bob@${NODE}`]);
        } finally { await close(); }
    });

    it('an --agent the home does not hold stops the start and says where it looked', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
        try {
            await expect(runServe({ agent: 'carol-bot' })).rejects.toThrow('exit 1');
            const said = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
            expect(said).toMatch(/carol-bot/);
            expect(said).toMatch(/connector home/);
            expect(state.factory).toBeNull();
        } finally { exit.mockRestore(); }
    });
});

describe('connect serve without --agent (Claude Desktop\'s config) is unchanged', () => {
    it('every agent in the home is served and selectable by agent_name', async () => {
        const { client, close } = await serveAndConnect({});
        try {
            await write(client, 'alice-bot');
            await write(client, 'bob-bot');
            expect(used).toEqual([`alice-bot#alice@${NODE}`, `bob-bot#alice@${NODE}`]);
            expect((state.pollers as RegisteredAgent[]).length).toBe(2);
        } finally { await close(); }
    });
});
