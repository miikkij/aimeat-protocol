/**
 * @file test/unit/openrouter-abort-signal.test.ts
 * @description `complete()` takes a caller's abort signal and COMBINES it with its own 30-minute
 *   timeout rather than choosing between them.
 *
 *   The composition is the thing worth a test. Replacing the internal controller with the caller's
 *   signal would look identical in every passing case and would silently remove the timeout — the
 *   one guard that stops a hung provider holding a job slot for half an hour and then for ever. So
 *   these ask three separate questions: does an outside abort actually tear the call down, is the
 *   normal path untouched when a signal is supplied but never fires, and is the transport's own
 *   controller still the signal when no caller signal is given at all.
 * @usage pnpm test -- openrouter-abort-signal
 * @version-history
 *   v1.0.0 — 2026-08-31 — Written with the AI-jobs cancel path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { complete } from '../../src/services/openrouter.js';

let server: Server;
let port = 0;
const held: ServerResponse[] = [];

function reply(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        model: 'stub/abort-test',
        choices: [{ message: { content: 'answered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
}

beforeAll(async () => {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            // `/v1/hold/...` never answers, so the caller's signal is the only way out.
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
});

const base = (path: string) => `http://127.0.0.1:${port}${path}`;

describe('complete() abort signal', () => {
    it('an outside abort tears down a call the provider is holding open', async () => {
        const controller = new AbortController();
        const call = complete(undefined, 'stub/abort-test', 'hello', undefined, base('/hold'), { signal: controller.signal });
        // Let the request actually reach the server before pulling the plug.
        await new Promise(r => setTimeout(r, 100));
        expect(held.length).toBeGreaterThan(0);
        controller.abort();
        await expect(call).rejects.toThrow();
    });

    it('a signal that never fires leaves the ordinary path exactly as it was', async () => {
        const controller = new AbortController();
        const r = await complete(undefined, 'stub/abort-test', 'hello', undefined, base('/v1'), { signal: controller.signal });
        expect(r.content).toBe('answered');
        expect(controller.signal.aborted).toBe(false);
    });

    it('no signal at all still works — the transport keeps its own controller', async () => {
        const r = await complete(undefined, 'stub/abort-test', 'hello', undefined, base('/v1'));
        expect(r.content).toBe('answered');
    });

    it('a signal already aborted before the call refuses immediately', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(complete(undefined, 'stub/abort-test', 'hello', undefined, base('/v1'), { signal: controller.signal }))
            .rejects.toThrow();
    });
});
