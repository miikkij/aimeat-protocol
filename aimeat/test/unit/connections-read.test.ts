/**
 * @file test/unit/connections-read.test.ts
 * @description The read direction on a connection: what it allows, and the five things it refuses
 *   before a request ever leaves this node. The refusals are the point. A read path that reaches a
 *   provider before checking anything is an open proxy standing behind somebody's Google account.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOutboundProviders, findProvider } from '../../src/services/connections/providers.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    connectionsEnabled: true,
    connectGoogleClientId: 'test-client',
    connectGoogleClientSecret: 'test-secret',
    connectLinkedinClientId: '', connectLinkedinClientSecret: '',
    connectXClientId: '', connectXClientSecret: '',
    connectFakeBaseUrl: '',
} as unknown as AimeatConfig;

const gmail = () => findProvider(buildOutboundProviders(config), 'google-mail')!;
const READ = 'https://www.googleapis.com/auth/gmail.readonly';

describe('the Gmail connection', () => {
    it('is offered once the node holds a Google client', () => {
        expect(gmail()).toBeDefined();
        expect(gmail().enabled).toBe(true);
        expect(gmail().disabledReason).toBeNull();
    });

    it('is absent-but-bringable when the node holds no client, and says which one', () => {
        const bare = { ...config, connectGoogleClientId: '', connectGoogleClientSecret: '' } as AimeatConfig;
        const p = findProvider(buildOutboundProviders(bare), 'google-mail')!;
        expect(p.enabled).toBe(false);
        expect(p.disabledReason).toContain('AIMEAT_CONNECT_GOOGLE_CLIENT_ID');
    });

    it('asks for read and for nothing else, which is the whole consent screen', () => {
        expect(gmail().scopes).toEqual([READ]);
        // Google offers send, modify and delete. None of them are requested, so none can be misused.
        expect(gmail().scopes.join(' ')).not.toMatch(/send|modify|compose|\.delete/);
    });

    it('carries no publishing capability, so no surface offers it a post box', () => {
        expect(gmail().capabilities).toEqual(['read-mail']);
    });
});

describe('the URLs the node builds', () => {
    it('builds a message list with a capped limit', () => {
        const u = new URL(gmail().resources!.messages.url({ limit: 5 }, null));
        expect(u.host).toBe('gmail.googleapis.com');
        expect(u.pathname).toBe('/gmail/v1/users/me/messages');
        expect(u.searchParams.get('maxResults')).toBe('5');
    });

    it('takes a silly count as a small one rather than failing on it', () => {
        const limit = (v: unknown) => new URL(gmail().resources!.messages.url({ limit: v }, null)).searchParams.get('maxResults');
        expect(limit(99999)).toBe('100');
        expect(limit(-3)).toBe('25');
        expect(limit('banana')).toBe('25');
        expect(limit(undefined)).toBe('25');
    });

    it('carries a search through, because that is how a mailbox is asked a question', () => {
        const u = new URL(gmail().resources!.messages.url({ query: 'from:lasku@example.com has:attachment' }, null));
        expect(u.searchParams.get('q')).toBe('from:lasku@example.com has:attachment');
    });

    it('refuses a message id that is not one, because the id goes into the PATH', () => {
        const bad = ['../../../admin', 'a/b', 'x?y=1', 'https://evil.example', ''];
        for (const id of bad) {
            expect(() => gmail().resources!.message.url({ id }, null)).toThrow();
        }
    });

    it('accepts a real message id and keeps it inside the intended path', () => {
        const u = new URL(gmail().resources!.message.url({ id: '18f2c9a0b1d4e5f6' }, null));
        expect(u.host).toBe('gmail.googleapis.com');
        expect(u.pathname).toBe('/gmail/v1/users/me/messages/18f2c9a0b1d4e5f6');
        expect(u.searchParams.get('format')).toBe('full');
    });

    it('takes only the two formats it means, whatever is asked for', () => {
        const fmt = (v: unknown) => new URL(gmail().resources!.message.url({ id: 'abc', format: v }, null)).searchParams.get('format');
        expect(fmt('raw')).toBe('raw');
        expect(fmt('full')).toBe('full');
        expect(fmt('metadata')).toBe('full');
        expect(fmt({ evil: true })).toBe('full');
    });
});

describe('reading through a connection', () => {
    const connection = {
        id: 'conn-1', principal: 'alice@node-1', provider: 'google-mail',
        instance: null, scopes: [READ], status: 'active', credential: 'sealed', expiresAt: null,
    };

    const ctxWith = (conn: unknown, fresh = true) => ({
        config, providers: buildOutboundProviders(config), key: Buffer.alloc(32),
        storage: {
            getConnection: async () => conn,
            setConnectionStatus: async () => undefined,
        },
        _fresh: fresh,
    });

    beforeEach(() => { vi.resetModules(); });

    /** The read service, with its credential and network dependencies replaced. */
    async function load(freshResult: unknown, fetchImpl?: typeof globalThis.fetch) {
        vi.doMock('../../src/services/connections/refresh.js', () => ({
            ensureFreshCredential: async () => freshResult,
        }));
        if (fetchImpl) vi.stubGlobal('fetch', fetchImpl);
        return (await import('../../src/services/connections/read.js')).readResource;
    }

    it('spends the token and returns what came back, never the token', async () => {
        const seen: { url?: string; auth?: string } = {};
        const readResource = await load(
            { ok: true, credential: { accessToken: 'ya29.secret' }, connection },
            (async (url: string, init: RequestInit) => {
                seen.url = String(url);
                seen.auth = new Headers(init.headers).get('Authorization') ?? undefined;
                return new Response(JSON.stringify({ messages: [{ id: 'abc' }] }), { status: 200 });
            }) as unknown as typeof globalThis.fetch,
        );

        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'messages', { limit: 3 });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.data).toEqual({ messages: [{ id: 'abc' }] });
        expect(seen.auth).toBe('Bearer ya29.secret');
        expect(JSON.stringify(out)).not.toContain('ya29.secret');
    });

    it('refuses a resource the provider never declared, and names the ones it did', async () => {
        const readResource = await load({ ok: true, credential: { accessToken: 't' }, connection });
        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'delete-everything', {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('NO_SUCH_RESOURCE');
        expect(out.message).toContain('messages');
    });

    it('refuses when the connection was never granted the permission, before asking Google', async () => {
        let called = false;
        const readResource = await load(
            { ok: true, credential: { accessToken: 't' }, connection: { ...connection, scopes: [] } },
            (async () => { called = true; return new Response('{}', { status: 200 }); }) as unknown as typeof globalThis.fetch,
        );
        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'messages', {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('MISSING_PERMISSION');
        expect(called).toBe(false);
    });

    it('turns a bad parameter into the sentence that says what to send', async () => {
        const readResource = await load({ ok: true, credential: { accessToken: 't' }, connection });
        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'message', { id: '../../admin' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('BAD_PARAMETERS');
    });

    it('says reconnect when the stored permission is gone, rather than reporting a fault', async () => {
        const readResource = await load({ ok: false, code: 'REVOKED', reason: 'this connection was revoked' });
        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'messages', {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('REVOKED');
        expect(out.message).toMatch(/connect the account again/i);
    });

    it('does not blame the person when the provider refuses', async () => {
        const readResource = await load(
            { ok: true, credential: { accessToken: 't' }, connection },
            (async () => new Response('{"error":"insufficient"}', { status: 403 })) as unknown as typeof globalThis.fetch,
        );
        const out = await readResource(ctxWith(connection) as never, 'conn-1', 'messages', {});
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('REFUSED_BY_PROVIDER');
        expect(out.status).toBe(403);
    });
});
