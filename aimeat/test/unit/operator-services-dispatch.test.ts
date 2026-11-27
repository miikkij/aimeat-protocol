/**
 * @file test/unit/operator-services-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `aimeat_admin_service_access` puts on the wire from the CLI dispatch, the door a
 *   fleet daemon and the connector MCP call, for the operator's per-account switch.
 *
 *   WHY IT IS ITS OWN FILE. cli-tool-param-forwarding.test.ts probes one parameter at a time with
 *   `action` held at "accounts", and `account` and `reason` belong to account_off and account_on only.
 *   One probe run cannot exercise both branches, so they are listed there as conditional and measured
 *   here.
 * @usage cd aimeat && pnpm exec vitest run test/unit/operator-services-dispatch.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2).
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
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_admin_service_access');
    if (!tool) throw new Error('aimeat_admin_service_access is not in the CLI dispatch table');
    return Promise.resolve(tool.handler(ctx as never, input)).then(() => sent);
}

describe('aimeat_admin_service_access switches one account from /local/call', () => {
    it('account_off is a PUT with on: false and the reason', async () => {
        expect(await run({ action: 'account_off', service: 'desk-helper', account: 'alice', reason: 'Alice is on leave until spring.' })).toEqual([{
            method: 'PUT', path: '/v1/operator-services/desk-helper/accounts/alice', body: { on: false, reason: 'Alice is on leave until spring.' },
        }]);
    });
    it('account_on is a PUT with on: true and no reason when none is given', async () => {
        expect(await run({ action: 'account_on', service: 'desk-helper', account: 'alice' })).toEqual([{
            method: 'PUT', path: '/v1/operator-services/desk-helper/accounts/alice', body: { on: true },
        }]);
    });
    it('the account and the service are path-encoded', async () => {
        const [sent] = await run({ action: 'account_on', service: 'desk helper', account: 'a/b' });
        expect(sent!.path).toBe('/v1/operator-services/desk%20helper/accounts/a%2Fb');
    });
});
