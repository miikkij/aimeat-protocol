/**
 * @file test/unit/task-event-tool-types.test.ts
 * @description aimeat_task_event takes the event types POST /v1/agents/:name/tasks/:id/event takes.
 *   Both read the task through services/agent/task-access.ts taskToActOn at the standard readiness
 *   level and append through recordTaskEvent (AgentTaskEventSchema); the tool's catalog enum lacked
 *   `revision_requested`, so an agent could record that event over REST and not over MCP. The tool is
 *   called over a real MCP client and server pair (InMemoryTransport) on an in-memory SQLite node,
 *   with the registration mcp/index.ts uses, and the stored event is read back.
 * @usage cd aimeat && pnpm exec vitest run test/unit/task-event-tool-types.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 1b follow-up).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentTaskRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { registerAgentTaskTools } from '../../src/mcp/agent-tasks.js';
import { AgentTaskEventSchema } from '../../src/models/agent-task-schemas.js';

const NODE = 'node-test';
const ALICE = `alice@${NODE}`;
const BOT = `bot#alice@${NODE}`;
const TASK_ID = '7b0c9f2e-1d1a-4a43-9a51-0f3b5f6d2c11';

let storage: Storage;
let client: Client;

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date().toISOString();
    await storage.createAgentTask({
        id: TASK_ID, agentGaii: BOT, ownerGaii: ALICE, title: 'Write the report', description: 'Write the report',
        scope: [], rules: [], verification: { userExpects: '', technicalChecks: [] }, resources: {}, todos: [],
        status: 'active', createdAt: now, updatedAt: now,
    } as AgentTaskRecord);

    const mcp = new McpServer({ name: 'aimeat-test', version: '0.0.0' });
    registerAgentTaskTools(mcp, storage, { nodeId: NODE } as AimeatConfig, () => BOT, () => {}, () => {}, ['*']);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverT);
    client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(clientT);
});

const textOf = (r: Awaited<ReturnType<Client['callTool']>>) => JSON.stringify(r.content);

describe('aimeat_task_event', () => {
    it('records revision_requested, which the REST route takes', async () => {
        expect(AgentTaskEventSchema.safeParse({ type: 'revision_requested', message: 'm' }).success).toBe(true);
        const r = await client.callTool({
            name: 'aimeat_task_event',
            arguments: { task_id: TASK_ID, type: 'revision_requested', message: 'The owner asked for a shorter summary' },
        });
        expect(r.isError, textOf(r)).toBeFalsy();
        const { events } = await storage.listTaskEvents(TASK_ID);
        expect(events.map(e => e.type)).toContain('revision_requested');
    });

    it('refuses a type the REST route refuses too', async () => {
        expect(AgentTaskEventSchema.safeParse({ type: 'log', message: 'm' }).success).toBe(false);
        const r = await client.callTool({ name: 'aimeat_task_event', arguments: { task_id: TASK_ID, type: 'log', message: 'm' } });
        expect(r.isError).toBe(true);
        const { events } = await storage.listTaskEvents(TASK_ID);
        expect(events.map(e => e.type)).not.toContain('log');
    });
});
