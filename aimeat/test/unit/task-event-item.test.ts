/**
 * @file test/unit/task-event-item.test.ts
 * @description A memory_write or app_publish task event names what it changed: recordTaskEvent
 *   (through aimeat_task_event, the path an agent takes) stores `details.item` with the record's key
 *   or the app's filename and the title the node reads itself, from the task's agent and owner
 *   only. Every field the agent sent stays; an `item` it sends is replaced; a key of another owner
 *   gets no title. An in-memory SQLite node and a real MCP client and server pair.
 * @usage cd aimeat && pnpm exec vitest run test/unit/task-event-item.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-27 -- Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentTaskRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { registerAgentTaskTools } from '../../src/mcp/agent-tasks.js';
import { titleOfValue } from '../../src/services/agent/task-event-item.js';

const NODE = 'node-test';
const ALICE = `alice@${NODE}`;
const BOT = `bot#alice@${NODE}`;
const CAROL = `carol@${NODE}`;
const TASK_ID = '2f6c1d0a-8b3e-4c1f-9a7d-5e2b1c0d9f44';
const now = new Date().toISOString();

let storage: Storage;
let client: Client;

const memory = (ownerGaii: string, key: string, value: unknown, visibility = 'private') => storage.setMemory({
    key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
} as never);

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    await storage.createAgentTask({
        id: TASK_ID, agentGaii: BOT, ownerGaii: ALICE, title: 'Sort the suppliers', description: 'Sort the suppliers',
        scope: [], rules: [], verification: { userExpects: '', technicalChecks: [] }, resources: {}, todos: [],
        status: 'active', createdAt: now, updatedAt: now,
    } as AgentTaskRecord);
    await memory(BOT, 'research.wool', { title: 'Wool suppliers in the Nordics', count: 4 });
    await memory(ALICE, 'notes.meeting', '# Meeting with Carol\n\nPrices agreed.', 'public');
    await memory(ALICE, 'notes.private', { title: 'Alice only' });
    await memory(CAROL, 'notes.secret', { title: 'Carol only' });
    const data = Buffer.from('<html></html>');
    await storage.createApp({
        ownerGaii: ALICE, ownerName: 'alice', filename: 'price-list.html', versionNumber: 1,
        manifest: { name: 'price-list', description: 'd', version: '1.0.0', author: 'alice', category: 'tool', tags: [] } as never,
        mimeType: 'text/html', size: data.length, data, createdAt: now,
    } as never);
    const mcp = new McpServer({ name: 'aimeat-test', version: '0.0.0' });
    registerAgentTaskTools(mcp, storage, { nodeId: NODE } as AimeatConfig, () => BOT, () => {}, () => {}, ['*']);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverT);
    client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(clientT);
});

const textOf = (r: Awaited<ReturnType<Client['callTool']>>) => JSON.stringify(r.content);

/** Post one event and read back the stored one with that message. */
async function post(type: string, message: string, details?: Record<string, unknown>) {
    const r = await client.callTool({ name: 'aimeat_task_event', arguments: { task_id: TASK_ID, type, message, ...(details ? { details } : {}) } });
    expect(r.isError, textOf(r)).toBeFalsy();
    const { events } = await storage.listTaskEvents(TASK_ID);
    return events.find((e) => e.message === message);
}

describe('task event item', () => {
    it('names the record an agent wrote by the title the node reads, keeping the agent fields', async () => {
        const ev = await post('memory_write', 'saved the list', { key: 'research.wool', rows: 4, item: { title: 'forged' } });
        expect(ev?.details?.rows).toBe(4);
        expect(ev?.details?.key).toBe('research.wool');
        expect(ev?.details?.item).toEqual({ kind: 'memory', key: 'research.wool', title: 'Wool suppliers in the Nordics' });
    });

    it("reads the owner's record the agent may read, a text by its first line", async () => {
        const ev = await post('memory_write', 'wrote the minutes', { key: 'notes.meeting' });
        expect(ev?.details?.item).toEqual({ kind: 'memory', key: 'notes.meeting', title: 'Meeting with Carol' });
    });

    // The key is the agent's own word and the event is readable to the agent: an owner's record the
    // agent may not read gives no title, or naming a key would read its title past the read check.
    it("gives no title for an owner's record the agent may not read", async () => {
        const ev = await post('memory_write', 'named a private key', { key: 'notes.private' });
        expect(ev?.details?.item).toEqual({ kind: 'memory', key: 'notes.private' });
    });

    it("gives no title for another owner's key", async () => {
        const ev = await post('memory_write', 'tried another key', { key: 'notes.secret' });
        expect(ev?.details?.item).toEqual({ kind: 'memory', key: 'notes.secret' });
    });

    it('names a published app by its name, from its filename or its name', async () => {
        const a = await post('app_publish', 'published by name', { app: 'price-list' });
        expect(a?.details?.item).toEqual({ kind: 'app', app: 'price-list.html', title: 'price-list' });
    });

    it('adds nothing to an event that names nothing, or to another type', async () => {
        const plain = await post('memory_write', 'no key given');
        expect(plain?.details).toBeUndefined();
        const progress = await post('progress', 'halfway', { key: 'research.wool' });
        expect(progress?.details).toEqual({ key: 'research.wool' });
    });

    it('titleOfValue takes the first title-like field or a first line', () => {
        expect(titleOfValue({ name: 'A name', title: '' })).toBe('A name');
        expect(titleOfValue('\n## Heading\nbody')).toBe('Heading');
        expect(titleOfValue([1, 2])).toBeNull();
        expect(titleOfValue({ count: 1 })).toBeNull();
    });
});
