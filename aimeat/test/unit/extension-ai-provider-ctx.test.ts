/**
 * @file test/unit/extension-ai-provider-ctx.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension running as an AI provider (System 2 plan V6), on the extension side:
 *   - ctx.fetch with `providerCall` (services/extension-ctx.ts): a listed host gets the owner's key
 *     header, the script's own copy of that header name is replaced, and the name is passed to
 *     safeFetch as sensitive; an unlisted host (a suffix, a longer name, a userinfo trick) is refused
 *     with `Fetch blocked:` before anything is sent; the key never reaches the script.
 *   - executeExtensionAction's `opts.signal` (services/extension-runtime.ts): a script awaiting a
 *     slow ctx.fetch rejects with `Extension run aborted` soon after the abort, and the fetch's own
 *     signal is aborted.
 *   - runExtensionActionAsSystem (services/extension-system-run.ts) passes both through, and still
 *     refuses another owner's extension.
 *   safeFetch is replaced by a recorder, the way outbound-read-cap.test.ts does it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-ai-provider-ctx.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — System 2 plan, V6: initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { SafeFetchInit } from '../../src/utils/url-validator.js';

type Call = { url: string; init: SafeFetchInit };
const calls: Call[] = [];
/** What the far side does with a call; the default answers at once. */
let farSide: (url: string, init: SafeFetchInit) => Promise<Response> = async () => new Response('{"ok":true}', { status: 200 });

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        safeFetch: vi.fn(async (url: string, init: SafeFetchInit = {}) => { calls.push({ url, init }); return farSide(url, init); }),
    };
});

const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { executeExtensionAction, EXTENSION_RUN_ABORTED } = await import('../../src/services/extension-runtime.js');
const { runExtensionActionAsSystem } = await import('../../src/services/extension-system-run.js');

const config = {
    nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const limits = { memoryMb: 64, timeoutMs: 10_000, maxApiCalls: 10 };
const KEY = 'sk-owner-provider-key-ZZ9';
const HOSTS = ['api.example-ai.com', 'eu.example-ai.com'];

const ctxWith = (providerCall?: Parameters<typeof buildExtensionCtx>[0]['providerCall']) => buildExtensionCtx({ capabilities: { network: true, ai: true, email: true, payments: true, declared: true },
    config, storage: {} as Storage, extMemoryOwner: 'ext:example-ai',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['operator'] }, extConfig: {}, logPrefix: '[ext:example-ai]',
    extension: { name: 'example-ai', owner: 'alice' },
    ...(providerCall ? { providerCall } : {}),
});

/** The headers safeFetch received, as a plain object. */
const sentHeaders = (c: Call) => Object.fromEntries(new Headers(c.init.headers as HeadersInit).entries());

beforeEach(() => {
    calls.length = 0;
    farSide = async () => new Response('{"ok":true}', { status: 200 });
});

describe('ctx.fetch in a provider run', () => {
    it('adds the key header to a listed host, replacing every case variant the script wrote, and marks it sensitive', async () => {
        const ctx = ctxWith({ hosts: HOSTS, inject: { name: 'x-api-key', value: KEY } });
        const res = await ctx.fetch('https://API.example-ai.com/v1/chat', {
            method: 'POST', body: '{}',
            headers: { 'X-Api-Key': 'script-own', 'X-API-KEY': 'script-other', 'content-type': 'application/json' },
        });
        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        const h = sentHeaders(calls[0]);
        expect(h['x-api-key']).toBe(KEY);
        expect(h['content-type']).toBe('application/json');
        expect(Object.keys(calls[0].init.headers as Record<string, string>).filter(k => k.toLowerCase() === 'x-api-key')).toEqual(['x-api-key']);
        expect(calls[0].init.sensitiveHeaders).toContain('x-api-key');
    });

    it('with the default header, the script cannot put its own Authorization beside the key', async () => {
        const ctx = ctxWith({ hosts: HOSTS, inject: { name: 'Authorization', value: `Bearer ${KEY}` } });
        await ctx.fetch('https://eu.example-ai.com/v1/embed', { headers: { authorization: 'Bearer script-own' } });
        expect(sentHeaders(calls[0]).authorization).toBe(`Bearer ${KEY}`);
        expect(calls[0].init.sensitiveHeaders).toContain('Authorization');
    });

    it.each([
        ['https://evil.example/steal', 'evil.example'],
        ['https://evil.api.example-ai.com/v1', 'evil.api.example-ai.com'],
        ['https://api.example-ai.com.evil.example/v1', 'api.example-ai.com.evil.example'],
        ['https://api.example-ai.com@evil.example/v1', 'evil.example'],
        ['https://example-ai.com/v1', 'example-ai.com'],
    ])('refuses %s before anything is sent', async (url, host) => {
        const ctx = ctxWith({ hosts: HOSTS, inject: { name: 'x-api-key', value: KEY } });
        const err = await ctx.fetch(url).then(() => null, (e: Error) => e);
        expect(err?.message ?? 'ctx.fetch answered').toMatch(/^Fetch blocked: /);
        expect(err?.message).toContain(`host ${host} `);
        expect(err?.message).toContain('api.example-ai.com, eu.example-ai.com');
        expect(err?.message).not.toContain(KEY);
        expect(calls).toHaveLength(0);
    });

    it('never sends the key over plain http, except to localhost on this machine', async () => {
        const ctx = ctxWith({ hosts: [...HOSTS, 'localhost'], inject: { name: 'x-api-key', value: KEY } });
        await expect(ctx.fetch('http://api.example-ai.com/v1/chat')).rejects.toThrow(/^Fetch blocked: the owner's key is sent only over https/);
        expect(calls).toHaveLength(0);
        await ctx.fetch('http://localhost:8080/v1/chat');
        expect(sentHeaders(calls[0])['x-api-key']).toBe(KEY);
        // Without a key to carry, a listed http host is reached as before.
        await ctxWith({ hosts: HOSTS }).fetch('http://api.example-ai.com/v1/health');
        expect(calls).toHaveLength(2);
    });

    it('refuses an address that does not parse', async () => {
        const ctx = ctxWith({ hosts: HOSTS });
        await expect(ctx.fetch('not a url')).rejects.toThrow(/^Fetch blocked: this address is not one of the hosts/);
        expect(calls).toHaveLength(0);
    });

    it('without inject, a listed host gets the script headers unchanged and nothing extra is sensitive', async () => {
        const ctx = ctxWith({ hosts: HOSTS });
        await ctx.fetch('https://api.example-ai.com/v1', { headers: { 'x-trace': '1' } });
        expect(calls[0].init.headers).toEqual({ 'x-trace': '1' });
        expect(calls[0].init.sensitiveHeaders).toEqual([]);
    });

    it('without providerCall, ctx.fetch is not limited to any host list', async () => {
        await ctxWith().fetch('https://feed.example/rss');
        expect(calls).toHaveLength(1);
        expect(calls[0].init.sensitiveHeaders).toEqual([]);
    });

    it('the key never reaches the script: not in ctx, not in the response it receives', async () => {
        farSide = async () => new Response('answer', { status: 200, headers: { 'x-far': 'y' } });
        const script = `export default async function (ctx) {
            const res = await ctx.fetch('https://api.example-ai.com/v1', { headers: { 'x-api-key': 'guess' } });
            return { ctx: JSON.stringify(ctx), res };
        }`;
        const out = await executeExtensionAction(script,
            ctxWith({ hosts: HOSTS, inject: { name: 'x-api-key', value: KEY } }), {}, limits);
        expect(sentHeaders(calls[0])['x-api-key']).toBe(KEY);
        expect(JSON.stringify(out)).not.toContain(KEY);
        expect((out.res as { text: string }).text).toBe('answer');
    });
});

describe('executeExtensionAction with a signal', () => {
    it('a script awaiting a slow ctx.fetch rejects with "Extension run aborted" soon after the abort', async () => {
        farSide = hangUntilAborted;
        const controller = new AbortController();
        const script = `export default async function (ctx) { await ctx.fetch('https://api.example-ai.com/slow'); return { done: true }; }`;
        const started = Date.now();
        setTimeout(() => controller.abort(), 150);
        await expect(executeExtensionAction(script, ctxWith(), {}, limits, { signal: controller.signal }))
            .rejects.toThrow(EXTENSION_RUN_ABORTED);
        expect(EXTENSION_RUN_ABORTED).toBe('Extension run aborted');
        expect(Date.now() - started).toBeLessThan(2000);
        expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    });

    it('a script that catches the aborted fetch and keeps going still rejects', async () => {
        farSide = hangUntilAborted;
        const controller = new AbortController();
        const script = `export default async function (ctx) {
            try { await ctx.fetch('https://api.example-ai.com/slow'); } catch (e) { /* keeps going */ }
            let n = 0; for (;;) { n++; }
        }`;
        setTimeout(() => controller.abort(), 100);
        await expect(executeExtensionAction(script, ctxWith(), {}, limits, { signal: controller.signal }))
            .rejects.toThrow(EXTENSION_RUN_ABORTED);
    });

    it('a signal aborted before the run rejects without starting it', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(executeExtensionAction('export default async function () { return {}; }', ctxWith(), {}, limits,
            { signal: controller.signal })).rejects.toThrow(EXTENSION_RUN_ABORTED);
    });

    it('a signal that never aborts changes nothing', async () => {
        const out = await executeExtensionAction(
            `export default async function (ctx) { const r = await ctx.fetch('https://api.example-ai.com/x'); return { status: r.status }; }`,
            ctxWith(), {}, limits, { signal: new AbortController().signal });
        expect(out).toEqual({ status: 200 });
    });
});

describe('runExtensionActionAsSystem as a provider', () => {
    const SCRIPT = `export default async function (ctx, input) {
        const r = await ctx.fetch(input.url, { method: 'POST', body: '{}' });
        return { text: r.text };
    }`;
    const storageFor = (installedBy: string) => ({
        getExtension: async () => ({
            name: 'example-ai', status: 'active', installedBy, config: {}, limits,
            actions: [{ id: 'ai.text', scriptContent: SCRIPT }],
        }),
    }) as unknown as Storage;
    const args = (url: string, extra: Record<string, unknown> = {}) => ({
        extensionName: 'example-ai', actionId: 'ai.text', callerGaii: 'alice@node-1', ownerName: 'alice',
        storageOwnerGhii: 'alice@node-1', logLabel: 'ai-provider', producerKind: 'extension' as const,
        input: { url }, ...extra,
    });

    it('passes providerCall to ctx.fetch: the key goes to a listed host, and another host is refused', async () => {
        const providerCall = { hosts: HOSTS, inject: { name: 'x-api-key', value: KEY } };
        const out = await runExtensionActionAsSystem({ storage: storageFor('alice'), config },
            args('https://api.example-ai.com/v1', { providerCall }));
        expect(out.result).toEqual({ text: '{"ok":true}' });
        expect(sentHeaders(calls[0])['x-api-key']).toBe(KEY);
        await expect(runExtensionActionAsSystem({ storage: storageFor('alice'), config },
            args('https://evil.example/v1', { providerCall }))).rejects.toThrow(/^Fetch blocked: host evil\.example /);
        expect(calls).toHaveLength(1);
    });

    it('passes the signal to the sandbox', async () => {
        farSide = hangUntilAborted;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);
        await expect(runExtensionActionAsSystem({ storage: storageFor('alice'), config },
            args('https://api.example-ai.com/v1', { signal: controller.signal }))).rejects.toThrow(EXTENSION_RUN_ABORTED);
    });

    it("refuses another owner's extension before anything runs", async () => {
        await expect(runExtensionActionAsSystem({ storage: storageFor('mallory'), config },
            args('https://api.example-ai.com/v1', { providerCall: { hosts: HOSTS, inject: { name: 'x-api-key', value: KEY } } })))
            .rejects.toThrow(/belongs to another owner/);
        expect(calls).toHaveLength(0);
    });
});

/** A far side that answers only when its signal aborts, then rejects the way fetch does. */
async function hangUntilAborted(_url: string, init: SafeFetchInit): Promise<Response> {
    return new Promise<Response>((_, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('The operation was aborted')), { once: true });
    });
}
