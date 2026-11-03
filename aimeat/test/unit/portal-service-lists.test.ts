/**
 * @file test/unit/portal-service-lists.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two portal calls behind the Services screens, run against a stubbed fetch:
 *   "My services" asks for the owner's own services by the provider filter the node reads, and an
 *   agent's Unpublish carries the session's token. Before 2026-11-04 the first sent `owner`, which
 *   GET /v1/catalogue ignores, so the tab listed the whole catalogue; the second sent the session's
 *   `token`, which the session does not have, so every press answered 401.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, items A5 and A6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { session } = vi.hoisted(() => ({ session: { jwt: 'session-jwt', owner: 'alice', ghii: 'alice@node-1' } as Record<string, unknown> }));
vi.mock('/js/services/auth.js', () => ({ getSession: () => session }));
import { listMyServices } from '../../public/js/services/catalogue.js';
import * as agentServices from '../../public/js/services/agent-services.js';

const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
    send = vi.fn().mockImplementation(async () => ok({ actions: [{ id: 's1', provider_gaii: 'alice@node-1' }], deleted: true }));
    vi.stubGlobal('fetch', send);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('My services', () => {
    it('asks for the owner\'s own services by the exact provider filter GET /v1/actions reads', async () => {
        const list = await listMyServices('alice@node-1');
        const url = new URL(String(send.mock.calls[0][0]), 'http://node');
        expect(url.pathname).toBe('/v1/actions');
        expect(url.searchParams.get('provider')).toBe('alice@node-1');
        expect(list).toEqual([{ id: 's1', provider_gaii: 'alice@node-1' }]);
    });
});

describe('Unpublish on an agent\'s Services tab', () => {
    it('sends DELETE with the session token and names the agent as the provider', async () => {
        const unpublish = (agentServices as Record<string, unknown>).unpublishAgentService as
            ((id: string, provider: string) => Promise<unknown>) | undefined;
        expect(typeof unpublish).toBe('function');
        await unpublish!('action-1', 'bot#alice@node-1');
        const [path, opts] = send.mock.calls[0];
        const url = new URL(String(path), 'http://node');
        expect(url.pathname).toBe('/v1/actions/action-1');
        expect(url.searchParams.get('provider')).toBe('bot#alice@node-1');
        expect(opts.method).toBe('DELETE');
        expect(new Headers(opts.headers).get('Authorization')).toBe('Bearer session-jwt');
    });
});
