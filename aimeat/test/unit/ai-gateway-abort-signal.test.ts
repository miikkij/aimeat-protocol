/**
 * @file test/unit/ai-gateway-abort-signal.test.ts
 * @description The gateway's text() takes a caller's abort signal and COMBINES it with its own
 *   30-minute timeout rather than choosing between them.
 *
 *   The composition is the thing worth a test. Replacing the internal timeout with the caller's
 *   signal would look identical in every passing case and would silently remove the timeout — the
 *   one guard that stops a hung provider holding a job slot for half an hour and then for ever. So
 *   these ask three separate questions: does an outside abort actually tear the call down, is the
 *   normal path untouched when a signal is supplied but never fires, and is the call's own timeout
 *   still the signal when no caller signal is given at all.
 * @usage pnpm test -- ai-gateway-abort-signal
 * @version-history
 *   v2.0.1 — 2026-09-28 — The held-call case waits until the request arrives instead of a fixed
 *     100 ms, which failed under the gate's load (the source was not broken; the test's timing was).
 *   v2.0.0 — 2026-09-28 — Moved from openrouter-abort-signal.test.ts with the behaviour it proves:
 *     the transport's complete() is gone and the gateway (services/ai/gateway.ts) does the same
 *     work. The four cases are unchanged; the call is text() on an OpenAI-compatible target.
 *   v1.0.0 — 2026-08-31 — Written with the AI-jobs cancel path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { text } from '../../src/services/ai/gateway.js';

let server: Server;
let port = 0;
const held: ServerResponse[] = [];
const privateEgressBefore = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;

function reply(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        id: 'chatcmpl-abort',
        model: 'stub/abort-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
}

beforeAll(async () => {
    // The stub is on loopback, which safeFetch admits only when private egress is allowed.
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    server = createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            // `/hold/...` never answers, so the caller's signal is the only way out.
            if ((req.url ?? '').startsWith('/hold')) { held.push(res); return; }
            reply(res);
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as { port: number }).port;
});

afterAll(async () => {
    for (const res of held) { try { res.destroy(); } catch { /* already gone */ } }
    await new Promise<void>(r => server.close(() => r()));
    if (privateEgressBefore === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = privateEgressBefore;
});

const ask = (path: string, signal?: AbortSignal) => text({
    target: { type: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}${path}`, key: undefined },
    model: 'stub/abort-test', prompt: 'hello', ...(signal ? { signal } : {}),
});

describe('text() abort signal', () => {
    it('an outside abort tears down a call the provider is holding open', async () => {
        const controller = new AbortController();
        const call = ask('/hold', controller.signal);
        // Let the request actually reach the server before aborting. Waited for, not timed: a fixed
        // 100 ms missed it under the load of `pnpm gate`, where the checks run side by side.
        for (let waited = 0; held.length === 0 && waited < 5000; waited += 20) await new Promise(r => setTimeout(r, 20));
        expect(held.length).toBeGreaterThan(0);
        controller.abort();
        await expect(call).rejects.toThrow();
    });

    it('a signal that never fires leaves the ordinary path exactly as it was', async () => {
        const controller = new AbortController();
        const r = await ask('/v1', controller.signal);
        expect(r.content).toBe('answered');
        expect(controller.signal.aborted).toBe(false);
    });

    it('no signal at all still works — the call keeps its own timeout', async () => {
        const r = await ask('/v1');
        expect(r.content).toBe('answered');
    });

    it('a signal already aborted before the call refuses immediately', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(ask('/v1', controller.signal)).rejects.toThrow();
    });
});
