/**
 * @file app-tools-owner-scope.test.ts
 * @description An app tool belongs to the OWNER, whichever principal published it.
 *
 *   Two of the three publish surfaces wrote to `/v1/memory` without `owner_scope`, so an AGENT's
 *   manifest landed under the agent's GAII (`concierge#bob@node`) while every reader looks it up
 *   under the owner's GHII (`bob@node`). The publish answered 200 and the tool was invisible to
 *   everyone — the publishing agent included. Measured 2026-09-02 against a live node: the invoke
 *   door said `APP_TOOLS_NOT_FOUND: App "isobob/s6demo.html" declares no public tool manifest` for
 *   a manifest that had just been written successfully.
 *
 *   This is the `resolveIdentity` rule inverted. Routes that store by identity resolve the
 *   principal; an app tool is not the principal's, it is the account's.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tools-owner-scope.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/cli/connect/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function recordingClient(sent: Sent[]) {
    const ok = { ok: true, data: {} } as never;
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve(ok); };
    return {
        get: (p: string) => push('GET', p),
        post: (p: string, b?: unknown) => push('POST', p, b),
        put: (p: string, b?: unknown) => push('PUT', p, b),
        patch: (p: string, b?: unknown) => push('PATCH', p, b),
        delete: (p: string) => push('DELETE', p),
    };
}

async function run(name: string, input: JsonObject): Promise<Sent[]> {
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`${name} is not on the CLI dispatch table`);
    const sent: Sent[] = [];
    const ctx = {
        client: recordingClient(sent),
        config: { agent: 'concierge', owner: 'bob', node_url: 'http://node.test' },
        agentPath: 'concierge',
    };
    await (tool as { handler: (c: never, i: JsonObject) => Promise<unknown> }).handler(ctx as never, input);
    return sent;
}

describe('publishing an app tool manifest', () => {
    it('writes it into the OWNER\'s namespace, not the caller\'s', async () => {
        const sent = await run('aimeat_app_tools_publish', {
            app_id: 's6demo.html',
            tools: [{ name: 'echo', description: 'echoes' }],
        });
        const write = sent.find(s => s.method === 'POST' && s.path === '/v1/memory');
        expect(write, 'the manifest should be written to /v1/memory').toBeDefined();
        const body = write!.body as Record<string, unknown>;
        expect(body.key).toBe('apps.s6demo.html.tools');
        // The line whose absence made every published manifest invisible.
        expect(body.owner_scope).toBe(true);
        expect(body.visibility).toBe('public');
    });

    it('and reading one asks for a specific owner rather than the caller', async () => {
        // The read side was already right; pinned so the two halves cannot drift apart again.
        const sent = await run('aimeat_app_tools_get', { app_id: 's6demo.html', owner: 'bob@node.test' });
        const read = sent.find(s => s.method === 'GET');
        expect(read, 'the manifest should be read back').toBeDefined();
        expect(read!.path).toContain('apps.s6demo.html.tools');
        expect(read!.path).toContain('bob');
    });

    it('and a BARE owner name is refused rather than silently answered with your own', async () => {
        // Already true, and worth holding: asking about someone else's app and getting your own
        // back is the worst shape of wrong answer, because nothing says the question changed.
        const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_app_tools_get')!;
        const res = await (tool as { handler: (c: never, i: JsonObject) => Promise<unknown> })
            .handler({ client: recordingClient([]), config: {}, agentPath: 'p' } as never,
                { app_id: 's6demo.html', owner: 'bob' }) as { ok?: boolean; error?: { code?: string } };
        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe('INVALID_INPUT');
    });
});
