/**
 * @file test/unit/outbound-read-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One ceiling for what this node reads of an answer from a service a person chose to
 *   call, and the three reads that share it (OUTBOUND_READ_MAX_BYTES in utils/read-capped.ts, 4 MB):
 *     - an extension's ctx.fetch (services/extension-ctx.ts), which every road into the sandbox
 *       takes from one builder;
 *     - a decision provider's answer (services/decide/systemone-client.ts);
 *     - a read from a connected account (services/connections/read.ts), which had the ceiling first.
 *   Each far side serves a stream ten times the ceiling with no Content-Length, and the test counts
 *   how much of it was read. An answer of exactly the ceiling still arrives whole. The same shape as
 *   peer-body-size-cap and package-pull-size-cap (secaudit 2026-09, N3).
 * @structure
 *   - the ceiling: one exported number, 4 MB
 *   - ctx.fetch: stops at the ceiling and throws RESPONSE_TOO_LARGE, naming the host it called and
 *     nothing else of the address; exactly the ceiling decodes whole with its charset; what a script
 *     sees, caught and uncaught; the scheduled road's error
 *   - living-hooks: TOO_LARGE for an answer over its own 1 MB and for one past the 4 MB ceiling, on
 *     read and on send, through the scripts the node ships and the real context builder
 *   - callSystemOne: stops at the ceiling with JEV_TOO_LARGE and no retry; exactly the ceiling parses
 *   - readResource: exactly the same ceiling is read, one byte past it is TOO_LARGE
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-read-cap.test.ts
 * @version-history
 *   v1.2.0 — 2026-09-26 — ctx.fetch's RESPONSE_TOO_LARGE names the host it called, and never the
 *     userinfo, the path, the query or the fragment (secaudit 2026-09, N3).
 *   v1.1.0 — 2026-09-26 — living-hooks answers one code, TOO_LARGE, for an answer that is too large
 *     whatever its size, on read and on send (secaudit 2026-09, N3).
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, N3).
 */
import { describe, it, expect, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { LIVING_HOOKS } from '../../src/data/builtin-extensions/living-hooks.js';
import type { SystemOneRequest } from '../../src/services/decide/systemone-client.js';

const CHUNK = 64 * 1024;
/** The ceiling the three reads share, written out here rather than taken from the code under test. */
const CAP = 4 * 1024 * 1024;
/** The chunk that crosses the ceiling is the last one worth reading. */
const CHUNKS_TO_CROSS = CAP / CHUNK + 1;
/** Ten times the ceiling. */
const TEN_TIMES = (CAP / CHUNK) * 10;

/** A stream of `totalChunks` chunks of one byte value, counting what was pulled and whether it was cancelled. */
function farStream(totalChunks: number, fill = 0x61) {
    const state = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (state.pulled >= totalChunks) { controller.close(); return; }
            state.pulled++;
            controller.enqueue(new Uint8Array(CHUNK).fill(fill));
        },
        cancel() { state.cancelled = true; },
    }, { highWaterMark: 0 });
    return { stream, state };
}

/** A JSON text padded with spaces to exactly `bytes` bytes, which JSON.parse still reads. */
const padded = (json: string, bytes: number) => json + ' '.repeat(bytes - Buffer.byteLength(json));

/** What the far side answers next. No Content-Length on purpose: it is the header a far side leaves out. */
let answer: () => Response = () => new Response('');

const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const connection = {
    id: 'conn-1', principal: 'alice@node-1', provider: 'google-mail',
    instance: null, scopes: [READ_SCOPE], status: 'active', credential: 'sealed', expiresAt: null,
};

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return { ...actual, safeFetch: vi.fn(async () => answer()) };
});
vi.mock('../../src/services/connections/refresh.js', () => ({
    ensureFreshCredential: async () => ({ ok: true, credential: { accessToken: 't' }, connection }),
}));

const { OUTBOUND_READ_MAX_BYTES } = await import('../../src/utils/read-capped.js');
const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { executeExtensionAction } = await import('../../src/services/extension-runtime.js');
const { runExtensionActionAsSystem } = await import('../../src/services/extension-system-run.js');
const { callSystemOne, SystemOneError } = await import('../../src/services/decide/systemone-client.js');
const { readResource } = await import('../../src/services/connections/read.js');
const { buildOutboundProviders } = await import('../../src/services/connections/providers.js');

const config = {
    nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const limits = { memoryMb: 64, timeoutMs: 10_000, maxApiCalls: 10 };
const URL_BIG = 'https://feed.example/big';

const extensionCtx = () => buildExtensionCtx({
    config, storage: {} as Storage, extMemoryOwner: 'ext:probe',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:probe]',
});

/** A script that hands back what ctx.fetch threw, the way living-hooks reads it. */
const SCRIPT_CATCHES = `export default async function (ctx) {
    try { await ctx.fetch('${URL_BIG}'); return { failed: null }; }
    catch (err) { return { failed: err && err.message ? err.message : String(err) }; }
}`;
/** A script that lets the throw through, which is what a road reports as the action's failure. */
const SCRIPT_LETS_IT_THROUGH = `export default async function (ctx) {
    const res = await ctx.fetch('${URL_BIG}');
    return { length: res.text.length };
}`;

describe('one ceiling for an answer from outside', () => {
    it('is one exported number, 4 MB', () => {
        expect(OUTBOUND_READ_MAX_BYTES).toBe(CAP);
    });
});

describe("an extension's ctx.fetch", () => {
    it('stops reading at 4 MB, cancels the rest, and throws RESPONSE_TOO_LARGE naming the limit', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200, headers: { 'content-type': 'text/plain' } });
        const failure = await extensionCtx().fetch(URL_BIG).then(() => null, (err: Error) => err);
        expect(far.state.pulled, `read ${far.state.pulled} of ${TEN_TIMES} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(far.state.cancelled).toBe(true);
        expect(failure?.message ?? 'ctx.fetch answered').toMatch(/^RESPONSE_TOO_LARGE: /);
        expect(failure?.message).toContain('4 MB');
    });

    // A script that calls several services has to learn which one answered too much. The host says
    // that; the userinfo, the path, the query and the fragment can each carry a key, so none of them
    // may appear in a message that reaches a log, a run record or a person's screen.
    it('names the host it called, and never the userinfo, the path, the query or the fragment', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        const url = 'https://zz-user:zz-pass@API.Example.com:8443/v2/zz-path/?api_key=zz-key&page=1#zz-frag';
        const failure = await extensionCtx().fetch(url).then(() => null, (err: Error) => err);
        expect(failure?.message ?? 'ctx.fetch answered')
            .toMatch(/^RESPONSE_TOO_LARGE: The answer from api\.example\.com:8443 is larger than 4 MB, /);
        expect(failure?.message).not.toContain('zz-');
        expect(failure?.message).not.toContain('/v2');
        expect(failure?.message).not.toContain('api_key');
        expect(far.state.cancelled).toBe(true);
    });

    it('hands back an answer of exactly 4 MB whole, decoded with the charset it declares', async () => {
        // 0xE4 is "ä" in Latin-1 and no UTF-8 sequence, so the declared charset has to be honoured.
        const far = farStream(CAP / CHUNK, 0xe4);
        answer = () => new Response(far.stream, { status: 200, headers: { 'content-type': 'text/plain; charset=iso-8859-1' } });
        const res = await extensionCtx().fetch(URL_BIG);
        expect(res.ok).toBe(true);
        expect(res.text.length).toBe(CAP);
        expect(/^ä+$/.test(res.text)).toBe(true);
    });

    it('a script that catches the throw reads the code first, as it reads SECRET_UNKNOWN', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        const out = await executeExtensionAction(SCRIPT_CATCHES, extensionCtx(), {}, limits);
        expect(far.state.pulled, `read ${far.state.pulled} of ${TEN_TIMES} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(String(out.failed)).toMatch(/^RESPONSE_TOO_LARGE: /);
    });

    // The request road answers this as EXTENSION_ERROR `Action "…" failed: <message>` and the MCP road
    // as the same text, both around the message asserted here.
    it('a script that lets it through fails the action with that message', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        await expect(executeExtensionAction(SCRIPT_LETS_IT_THROUGH, extensionCtx(), {}, limits))
            .rejects.toThrow(/^RESPONSE_TOO_LARGE: /);
    });

    // The scheduler records this message as the run's error and tells the owner.
    it('the scheduled road fails the run with the same message', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        const storage = {
            getExtension: async () => ({
                name: 'probe', status: 'active', installedBy: 'alice', config: {}, limits,
                actions: [{ id: 'pull', scriptContent: SCRIPT_LETS_IT_THROUGH }],
            }),
        } as unknown as Storage;
        await expect(runExtensionActionAsSystem({ storage, config }, {
            extensionName: 'probe', actionId: 'pull', callerGaii: 'scheduler@node-1', ownerName: 'alice',
            storageOwnerGhii: 'alice@node-1', logLabel: 'scheduler', producerKind: 'extension',
        })).rejects.toThrow(/^RESPONSE_TOO_LARGE: /);
        expect(far.state.pulled).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(far.state.cancelled).toBe(true);
    });
});

// The extension the node ships to read an outside value into a living document. A read over its own
// 1 MB ceiling is TOO_LARGE, and so is any answer past the 4 MB the node reads, on read and on send:
// one code for an answer that was too large, whatever its size.
describe('living-hooks, the extension the node ships', () => {
    type Refusal = { error?: { code?: string; message?: string } };
    const hooksConfig = loadConfig().config;
    const run = (action: 'read' | 'send', input: Record<string, unknown>) => executeExtensionAction(
        LIVING_HOOKS.scripts[`${action}.js`],
        buildExtensionCtx({
            config: hooksConfig, storage: new SqliteStorage(':memory:') as never, extMemoryOwner: 'ext:living-hooks',
            caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['owner'] },
            extConfig: { allow_hosts: ['feed.example'] }, logPrefix: '[ext:living-hooks]',
        }),
        input, limits,
    ) as Promise<Refusal>;

    it('read: an answer over its own 1 MB is TOO_LARGE', async () => {
        answer = () => new Response(farStream(32).stream, { status: 200 });
        const out = await run('read', { url: URL_BIG, raw: true });
        expect(out.error?.code).toBe('TOO_LARGE');
    });

    it('read: an answer past the 4 MB the node reads is TOO_LARGE as well, and says 4 MB', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        const out = await run('read', { url: URL_BIG, raw: true });
        expect(out.error?.code).toBe('TOO_LARGE');
        expect(out.error?.message).toContain('4 MB');
        expect(far.state.cancelled).toBe(true);
    });

    it('send: a receiver that answers past 4 MB is TOO_LARGE, and says 4 MB', async () => {
        const far = farStream(TEN_TIMES);
        answer = () => new Response(far.stream, { status: 200 });
        const out = await run('send', { url: 'https://feed.example/hook', body: { state: 'on' } });
        expect(out.error?.code).toBe('TOO_LARGE');
        expect(out.error?.message).toContain('4 MB');
        expect(far.state.cancelled).toBe(true);
    });
});

describe("a decision provider's answer", () => {
    const request: SystemOneRequest = { model: 'm-1', state: 'x', questions: { go: { type: 'noul', instructions: 'Go?' } } };
    const url = 'https://decide.example/v1/systemone';

    it('stops reading at 4 MB, cancels the rest, and fails with JEV_TOO_LARGE without a retry', async () => {
        const far = farStream(TEN_TIMES);
        let calls = 0;
        const fetchImpl = async () => { calls++; return new Response(far.stream, { status: 200, headers: { 'content-type': 'application/json' } }); };
        const failure = await callSystemOne({ url, key: 'k-1', request, providerName: 'Laya', fetchImpl, sleep: async () => {} })
            .then(() => null, (err: unknown) => err);
        expect(far.state.pulled, `read ${far.state.pulled} of ${TEN_TIMES} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(far.state.cancelled).toBe(true);
        expect(failure).toBeInstanceOf(SystemOneError);
        const e = failure as InstanceType<typeof SystemOneError>;
        expect(e.code).toBe('JEV_TOO_LARGE');
        expect(e.retryable).toBe(false);
        expect(e.message).toContain('Laya');
        expect(e.message).toContain('4 MB');
        expect(calls).toBe(1);
    });

    it('reads an answer of exactly 4 MB whole', async () => {
        const body = padded(JSON.stringify({ model: 'm-1', answers: { go: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 5 } }), CAP);
        const fetchImpl = async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        const res = await callSystemOne({ url, key: 'k-1', request, fetchImpl });
        expect(res.answers.go.noul).toBe(0.9);
    });
});

describe('a read from a connected account', () => {
    const connConfig = {
        connectionsEnabled: true, connectGoogleClientId: 'test-client', connectGoogleClientSecret: 'test-secret',
        connectLinkedinClientId: '', connectLinkedinClientSecret: '', connectXClientId: '', connectXClientSecret: '',
        connectFakeBaseUrl: '',
    } as unknown as AimeatConfig;
    const ctx = () => ({ config: connConfig, providers: buildOutboundProviders(connConfig), key: Buffer.alloc(32), storage: {} }) as never;
    const json = JSON.stringify({ messages: [{ id: 'abc' }] });

    it('reads an answer of exactly the same ceiling, and refuses one byte more as TOO_LARGE', async () => {
        answer = () => new Response(padded(json, CAP), { status: 200 });
        const at = await readResource(ctx(), 'conn-1', 'messages', {});
        expect(at.ok).toBe(true);

        answer = () => new Response(padded(json, CAP + 1), { status: 200 });
        const over = await readResource(ctx(), 'conn-1', 'messages', {});
        expect(over.ok).toBe(false);
        if (over.ok) return;
        expect(over.code).toBe('TOO_LARGE');
        expect(over.message).toContain('4 MB');
    });
});
