/**
 * @file test/unit/work-dispatch-object-input.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_action_execute and aimeat_work_deliver on the CLI dispatch (what a fleet daemon
 *   and the connector MCP call): `input` and `output` reach POST /v1/work/request and /deliver as
 *   given, so the route decides and a value that is not an object is refused there with a message
 *   that names the field. The dispatch dropped a non-object input in silence, and the node then
 *   answered that input was missing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/work-dispatch-object-input.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function client(sent: Sent[]) {
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve({ ok: true, data: {} } as never); };
    return { get: (p: string) => push('GET', p), post: (p: string, b?: unknown) => push('POST', p, b), put: (p: string, b?: unknown) => push('PUT', p, b), patch: (p: string, b?: unknown) => push('PATCH', p, b), delete: (p: string) => push('DELETE', p) };
}

async function run(name: string, input: JsonObject): Promise<Sent[]> {
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === name)!;
    const sent: Sent[] = [];
    await tool.handler({ client: client(sent), config: { agent: 'a', owner: 'o', node_url: 'http://n' }, agentPath: 'a' } as never, input);
    return sent;
}

describe('aimeat_action_execute on the CLI dispatch', () => {
    it('sends an object input as given', async () => {
        const sent = await run('aimeat_action_execute', { action_id: 'translate', provider_gaii: 'bot#bob@n', input: { text: 'hi' } });
        expect(sent).toEqual([{ method: 'POST', path: '/v1/work/request', body: { action_id: 'translate', input: { text: 'hi' }, provider_gaii: 'bot#bob@n' } }]);
    });

    it('sends a string, an array, a number or null input to the route, which refuses it, instead of dropping it', async () => {
        for (const input of ['translate this', ['a'], 3, null]) {
            const sent = await run('aimeat_action_execute', { action_id: 'translate', provider_gaii: 'bot#bob@n', input });
            expect(sent[0]?.path).toBe('/v1/work/request');
            expect((sent[0]?.body as JsonObject).input).toEqual(input);
        }
    });

    it('leaves input out when it was not given, so the route answers that it is required', async () => {
        const sent = await run('aimeat_action_execute', { action_id: 'translate', provider_gaii: 'bot#bob@n' });
        expect('input' in (sent[0]?.body as JsonObject)).toBe(false);
    });
});

describe('aimeat_work_deliver on the CLI dispatch', () => {
    it('sends the output as given, object or not, so the route decides', async () => {
        for (const output of [{ text: 'done' }, 'done']) {
            const sent = await run('aimeat_work_deliver', { tracking_code: 'tc-1', output });
            expect(sent).toEqual([{ method: 'POST', path: '/v1/work/tc-1/deliver', body: { output } }]);
        }
    });
});
