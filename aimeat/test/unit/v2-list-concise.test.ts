/**
 * @file test/unit/v2-list-concise.test.ts
 * @description aimeat_v2_message_list and aimeat_v2_task_list give the concise view their catalog
 *   entry has promised since it was written (supportsResponseFormat, conciseFields), on the node MCP
 *   and on the connector MCP. Until 2026-10-05 neither surface took `response_format`, so the
 *   promise was in the catalog only; both register zodShapeFor(name) now (secaudit 2026-10, M3).
 * @usage pnpm exec vitest run test/unit/v2-list-concise.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M3).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AgentRegistry } from '../../src/cli/connect/agent-registry.js';
import { registerAgentV2MessagingTools as nodeMessaging } from '../../src/mcp/agent-v2-messaging.js';
import { registerAgentV2TaskTools as nodeTasks } from '../../src/mcp/agent-v2-tasks.js';
import { registerAgentV2MessagingTools as connMessaging } from '../../src/cli/connect/mcp/tools/agent-v2-messaging.js';
import { registerAgentV2TaskTools as connTasks } from '../../src/cli/connect/mcp/tools/agent-v2-tasks.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

/** A fake MCP server that keeps each tool's handler. */
function fakeMcp(): { mcp: never; handlers: Map<string, Handler> } {
    const handlers = new Map<string, Handler>();
    const mcp = { tool: (...args: unknown[]) => { handlers.set(args[0] as string, args[args.length - 1] as Handler); } };
    return { mcp: mcp as never, handlers };
}

const TASK = {
    taskId: 't-1', status: 'working', statusMessage: 'busy', contextId: 'c-1', createdBy: 'a#o@n', assignedTo: 'b#o@n',
    input: [], history: [], artifacts: [], createdAt: '2026-10-05T00:00:00Z', lastUpdatedAt: '2026-10-05T01:00:00Z',
};
const TURN = {
    messageId: 'm-1', role: 'user', from: 'a#o@n', to: 'b#o@n', parts: [{ kind: 'text', text: 'hello' }],
    contextId: 'c-1', createdAt: '2026-10-05T00:00:00Z',
};

const storage = {
    listAgentV2Tasks: async () => [TASK],
    listAgentV2Messages: async () => [TURN],
} as unknown as Storage;
const config = { nodeId: 'n' } as AimeatConfig;
const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0]!.text) as Record<string, Array<Record<string, unknown>>>;

describe('node MCP', () => {
    const { mcp, handlers } = fakeMcp();
    nodeMessaging(mcp, storage, config, () => 'a#o@n', () => 'o');
    nodeTasks(mcp, storage, config, () => 'a#o@n', () => 'o');

    it('task list: concise keeps the catalog fields, detailed keeps everything', async () => {
        const concise = parse(await handlers.get('aimeat_v2_task_list')!({ response_format: 'concise' }));
        expect(Object.keys(concise.tasks![0]!).sort()).toEqual(['assignedTo', 'createdBy', 'lastUpdatedAt', 'status', 'taskId']);
        const detailed = parse(await handlers.get('aimeat_v2_task_list')!({}));
        expect(detailed.tasks![0]).toHaveProperty('statusMessage', 'busy');
    });

    it('message list: concise keeps the catalog fields', async () => {
        const concise = parse(await handlers.get('aimeat_v2_message_list')!({ response_format: 'concise' }));
        expect(Object.keys(concise.messages![0]!).sort()).toEqual(['createdAt', 'from', 'messageId', 'role', 'to']);
    });
});

describe('connector MCP', () => {
    const sent: string[] = [];
    const client = {
        get: async (path: string) => {
            sent.push(path);
            return path.startsWith('/v1/agents/v2/tasks')
                ? { ok: true, data: { tasks: [{ ...TASK, a2a_state: 'working' }], count: 1 } }
                : { ok: true, data: { messages: [TURN], count: 1 } };
        },
    };
    const registry = { resolve: () => ({ client, agent: 'a', owner: 'o' }), list: () => [{ client, agent: 'a', owner: 'o' }], size: () => 1 } as unknown as AgentRegistry;
    const { mcp, handlers } = fakeMcp();
    connMessaging(mcp, registry);
    connTasks(mcp, registry);

    it('task list: concise is projected, and response_format does not travel to the node', async () => {
        const concise = parse(await handlers.get('aimeat_v2_task_list')!({ response_format: 'concise' }));
        expect(Object.keys(concise.tasks![0]!).sort()).toEqual(['assignedTo', 'createdBy', 'lastUpdatedAt', 'status', 'taskId']);
        expect(sent.at(-1)).not.toContain('response_format');
    });

    it('message list: concise is projected', async () => {
        const concise = parse(await handlers.get('aimeat_v2_message_list')!({ response_format: 'concise' }));
        expect(Object.keys(concise.messages![0]!).sort()).toEqual(['createdAt', 'from', 'messageId', 'role', 'to']);
        expect(sent.at(-1)).not.toContain('response_format');
    });
});
