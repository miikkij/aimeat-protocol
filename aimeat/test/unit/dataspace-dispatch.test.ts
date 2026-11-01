/**
 * @file test/unit/dataspace-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `aimeat_dataspace` puts on the wire from the CLI dispatch, the door a fleet daemon
 *   and the connector MCP call (plan doc-mvwxcas3dom3, D8.3).
 *
 *   WHY IT IS ITS OWN FILE. cli-tool-param-forwarding.test.ts probes one parameter at a time with
 *   `action` held at one branch (decline), and this tool's parameters belong to one action each: `state`
 *   and `waiting` to list, `auto_agree` and `package` to settings. One probe run cannot exercise them
 *   all, so they are listed there as conditional and measured here, per action.
 * @usage cd aimeat && pnpm exec vitest run test/unit/dataspace-dispatch.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function run(input: JsonObject): Promise<Sent[]> {
    const sent: Sent[] = [];
    const ok = { ok: true, data: {} } as never;
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve(ok); };
    const ctx = {
        client: {
            get: (p: string) => push('GET', p),
            post: (p: string, b?: unknown) => push('POST', p, b),
            put: (p: string, b?: unknown) => push('PUT', p, b),
            patch: (p: string, b?: unknown) => push('PATCH', p, b),
            delete: (p: string) => push('DELETE', p),
        },
        config: { agent: 'probe', owner: 'prober', node_url: 'http://node.test' },
        agentPath: 'probe',
    };
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_dataspace');
    if (!tool) throw new Error('aimeat_dataspace is not in the CLI dispatch table');
    return Promise.resolve(tool.handler(ctx as never, input)).then(() => sent);
}

const PID = 'urn:aimeat:dsp:cn:YWxpY2U:0123456789abcdef0123456789abcdef';

describe('aimeat_dataspace reaches the node from /local/call', () => {
    it('list carries the state and the waiting filter', async () => {
        const sent = await run({ action: 'list', state: 'REQUESTED', waiting: true });
        expect(sent).toEqual([{ method: 'GET', path: '/v1/dataspace/negotiations?state=REQUESTED&waiting=true' }]);
    });
    it('get, approve and decline name the negotiation; decline carries the reason', async () => {
        expect((await run({ action: 'get', provider_pid: PID }))[0]).toEqual({ method: 'GET', path: `/v1/dataspace/negotiations/${encodeURIComponent(PID)}` });
        expect((await run({ action: 'approve', provider_pid: PID }))[0]!.path).toBe(`/v1/dataspace/negotiations/${encodeURIComponent(PID)}/approve`);
        const d = (await run({ action: 'decline', provider_pid: PID, reason: 'The project ended.' }))[0]!;
        expect(d.method).toBe('POST');
        expect(d.body).toEqual({ reason: 'The project ended.' });
    });
    it('settings reads, and with a package sets auto_agree, null included', async () => {
        expect(await run({ action: 'settings' })).toEqual([{ method: 'GET', path: '/v1/dataspace/settings' }]);
        expect((await run({ action: 'settings', package: 'budget', auto_agree: true }))[0]).toEqual({ method: 'PUT', path: '/v1/dataspace/settings', body: { package: 'budget', auto_agree: true } });
        expect((await run({ action: 'settings', package: 'budget' }))[0]!.body).toEqual({ package: 'budget', auto_agree: null });
    });
});
