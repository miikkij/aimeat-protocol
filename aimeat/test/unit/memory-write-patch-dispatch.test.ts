/**
 * @file test/unit/memory-write-patch-dispatch.test.ts
 * @description aimeat_memory_write with `patch` on the CLI dispatch (what a fleet daemon and the
 *   connector MCP call): it goes to PATCH /v1/memory/:key with every parameter it publishes, under
 *   the route's names, and value-or-patch is decided as on the node MCP (utils/memory-write-mode.ts).
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { memoryWriteMode } from '../../src/utils/memory-write-mode.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function client(sent: Sent[]) {
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve({ ok: true, data: {} } as never); };
    return { get: (p: string) => push('GET', p), post: (p: string, b?: unknown) => push('POST', p, b), put: (p: string, b?: unknown) => push('PUT', p, b), patch: (p: string, b?: unknown) => push('PATCH', p, b), delete: (p: string) => push('DELETE', p) };
}

const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_memory_write')!;
async function run(input: JsonObject): Promise<{ sent: Sent[]; error?: string }> {
    const sent: Sent[] = [];
    try {
        await tool.handler({ client: client(sent), config: { agent: 'a', owner: 'o', node_url: 'http://n' }, agentPath: 'a' } as never, input);
        return { sent };
    } catch (e) {
        return { sent, error: String((e as Error).message) };
    }
}

describe('aimeat_memory_write patch on the CLI dispatch', () => {
    it('sends a patch to PATCH /v1/memory/:key with every parameter it carries', async () => {
        const { sent, error } = await run({
            key: 'context.trip x', patch: { core: 'new', lifecycle: { shapedAt: 't' } },
            visibility: 'owner', tags: ['a'], ttl_hours: 5, owner_scope: true, expected_version: 7,
        });
        expect(error).toBeUndefined();
        expect(sent).toEqual([{ method: 'PATCH', path: '/v1/memory/context.trip%20x', body: {
            patch: { core: 'new', lifecycle: { shapedAt: 't' } }, visibility: 'owner', tags: ['a'], ttl_hours: 5, owner_scope: true, if_version: 7,
        } }]);
    });

    it('leaves out what was not given, so the record keeps its visibility and tags', async () => {
        const { sent } = await run({ key: 'k', patch: { a: 1 } });
        expect(sent).toEqual([{ method: 'PATCH', path: '/v1/memory/k', body: { patch: { a: 1 } } }]);
    });

    it('passes a patch that is not an object to the route, which refuses it, rather than writing it as a value', async () => {
        const { sent } = await run({ key: 'k', patch: ['x'] });
        expect(sent[0]?.method).toBe('PATCH');
    });

    it('refuses value and patch together, neither, and a patch with group_id or a provenance declaration, before sending anything', async () => {
        for (const input of [
            { key: 'k', value: 1, patch: { a: 1 } },
            { key: 'k' },
            { key: 'k', patch: { a: 1 }, group_id: 'g' },
            { key: 'k', patch: { a: 1 }, ai_provenance: { level: 'ai-generated' } },
            { key: 'k', patch: { a: 1 }, ai_provenance_id: 'p' },
        ] as JsonObject[]) {
            const { sent, error } = await run(input);
            expect(sent, JSON.stringify(input)).toEqual([]);
            expect(error, JSON.stringify(input)).toMatch(/^INVALID_INPUT: /);
        }
    });

    it('a whole value still goes to POST /v1/memory', async () => {
        const { sent } = await run({ key: 'k', value: { a: 1 }, visibility: 'owner' });
        expect(sent).toEqual([{ method: 'POST', path: '/v1/memory', body: { key: 'k', value: { a: 1 }, visibility: 'owner' } }]);
    });
});

describe('memoryWriteMode', () => {
    it('counts an explicit null value as given, so a null write is not mistaken for a patch', () => {
        expect(memoryWriteMode({ value: null })).toEqual({ mode: 'value' });
        expect(memoryWriteMode({ value: false })).toEqual({ mode: 'value' });
        expect(memoryWriteMode({ patch: {} })).toEqual({ mode: 'patch' });
    });
});
