/**
 * @file mcp-tasks-extension.test.ts
 * @description The time half of the MCP Tasks extension (mcp/tasks-extension.ts), on a real SDK
 *   McpServer and a real SQLite storage: a call still running after config.mcpTaskAfterMs answers
 *   with a task handle while the call goes on, and the record turns `completed` with the result when
 *   it ends; a call that ends first answers with its own result and leaves no record; a client that
 *   does not declare the extension is never given a task; a cancel stops the late result from being
 *   kept. e2e-mcp-tasks proves the wire with the threshold at 0, where no call can end first.
 * @usage pnpm exec vitest run test/unit/mcp-tasks-extension.test.ts
 * @version-history
 *   2026-10-26 — Initial (wish-mcp-tasks-laajennus-pitkille-ty-kalukutsuille).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { installTasksExtension, TASKS_EXTENSION } from '../../src/mcp/tasks-extension.js';

const PRINCIPAL = 'bot#alice@test-node';
let storage: Storage;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A server with one tool that answers after `ms`, the extension installed at `afterMs`. */
function serverWith(afterMs: number) {
    const mcp = new McpServer({ name: 'unit', version: '1.0.0' });
    mcp.registerTool('wait', { inputSchema: { ms: z.number() } }, async ({ ms }) => {
        await sleep(ms);
        return { content: [{ type: 'text' as const, text: `waited ${ms}` }] };
    });
    installTasksExtension(mcp, { storage, config: { mcpTaskAfterMs: afterMs } as AimeatConfig, principal: PRINCIPAL });
    const handlers = (mcp.server as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<any>> })._requestHandlers;
    const call = handlers.get('tools/call')!;
    return { mcp, call };
}

/** The request context the SDK hands a handler, as far as these calls read it. */
const ctx = (capabilities: Record<string, unknown>) => ({
    mcpReq: { envelope: { 'io.modelcontextprotocol/clientCapabilities': capabilities }, requestState: () => undefined },
});
const declaring = ctx({ extensions: { [TASKS_EXTENSION]: {} } });
const plain = ctx({});
const request = (ms: number) => ({ method: 'tools/call', params: { name: 'wait', arguments: { ms } } });

async function record(taskId: string) {
    return (await storage.getMemory(PRINCIPAL, `mcp.tasks.${taskId}`))?.value as any;
}

beforeAll(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
});

describe('the MCP Tasks extension', () => {
    it('answers a call still running after the threshold with a task, and keeps the result when it ends', async () => {
        const { call } = serverWith(50);
        const answer = await call(request(400), declaring);
        expect(answer.resultType).toBe('task');
        expect(answer.status).toBe('working');
        expect((await record(answer.taskId)).status).toBe('working');
        await sleep(600);
        const done = await record(answer.taskId);
        expect(done.status).toBe('completed');
        expect(done.result.content[0].text).toBe('waited 400');
    });

    it('answers a call that ends first with its own result and writes no task', async () => {
        const { call } = serverWith(500);
        const before = (await storage.listMemory(PRINCIPAL, { prefix: 'mcp.tasks.' })).length;
        const answer = await call(request(5), declaring);
        expect(answer.resultType).not.toBe('task');
        expect(answer.content[0].text).toBe('waited 5');
        expect((await storage.listMemory(PRINCIPAL, { prefix: 'mcp.tasks.' })).length).toBe(before);
    });

    it('never gives a task to a client that does not declare the extension', async () => {
        const { call } = serverWith(0);
        const answer = await call(request(100), plain);
        expect(answer.resultType).not.toBe('task');
        expect(answer.content[0].text).toBe('waited 100');
    });

    it('keeps a cancelled task cancelled when the call ends later', async () => {
        const { call } = serverWith(0);
        const answer = await call(request(300), declaring);
        expect(answer.resultType).toBe('task');
        const key = `mcp.tasks.${answer.taskId}`;
        const rec = await storage.getMemory(PRINCIPAL, key);
        await storage.setMemory({ ...rec!, value: { ...(rec!.value as object), status: 'cancelled' }, version: rec!.version + 1 });
        await sleep(500);
        const after = await record(answer.taskId);
        expect(after.status).toBe('cancelled');
        expect(after.result).toBeUndefined();
    });
});
