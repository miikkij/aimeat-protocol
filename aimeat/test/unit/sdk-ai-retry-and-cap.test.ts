/**
 * @file test/unit/sdk-ai-retry-and-cap.test.ts
 * @description Two things AIMEAT.ai did that an app could not see:
 *   - completeJson() retried a non-JSON answer once and answered with the retry's usage alone, so a
 *     retried answer looked half its price. Its usage is now the sum of both calls, with `attempts`
 *     and `first_usage`; the error after two misses carries the sum too.
 *   - complete() sent `max_tokens` as given, and a cap copied from an example cut answers without a
 *     sign. It is left out of the request now, the console says so once, and `allowCap: true` sends
 *     it as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-ai-retry-and-cap.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6: ai/completejson-retry-hides-cost, no-max-tokens).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { path: string; body: any };
const calls: Call[] = [];
let answers: Array<{ content: string; usage: any }> = [];

beforeEach(() => {
    calls.length = 0;
    answers = [];
    const session = {
        fetch: async (path: string, opts: { body?: string } = {}) => {
            calls.push({ path, body: opts.body ? JSON.parse(opts.body) : null });
            const next = answers.shift() ?? { content: '{"ok":true}', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
            return { ok: true, data: { content: next.content, model: 'm', usage: next.usage, budget: null } };
        },
    };
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '', innerHTML: '' });
    (globalThis as any).document = (globalThis as any).document ?? {
        documentElement: { lang: 'en', ...el() }, head: el(), body: el(),
        getElementById: () => null, querySelector: () => null, createElement: el,
        addEventListener() {}, dispatchEvent() {},
    };
    (globalThis as any).location = (globalThis as any).location ?? { origin: 'https://app.test', href: 'https://app.test/', hostname: 'app.test', search: '', hash: '' };
    (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
});

async function lib() {
    await import('../../src/static/sdk-libs/ai/index.js');
    return (globalThis as any).window.AIMEAT.ai;
}

describe('completeJson() counts both calls when it retried', () => {
    it('a retried answer carries the sum of both usages, attempts 2 and the first call\'s own usage', async () => {
        const ai = await lib();
        answers = [
            { content: 'Sure! Here it is: {"title":', usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.002 } },
            { content: '{"title":"Kept"}', usage: { prompt_tokens: 120, completion_tokens: 10, total_tokens: 130, cost: 0.001 } },
        ];
        const r = await ai.completeJson({ app_id: 'retry-1', prompt: 'Name it' });
        expect(r.parsed).toEqual({ title: 'Kept' });
        expect(r.attempts).toBe(2);
        expect(r.usage).toEqual({ prompt_tokens: 220, completion_tokens: 50, total_tokens: 270, cost: 0.003 });
        expect(r.first_usage.total_tokens).toBe(140);
    });

    it('two misses throw with the summed usage on the error', async () => {
        const ai = await lib();
        answers = [
            { content: 'not json', usage: { total_tokens: 10 } },
            { content: 'still not json', usage: { total_tokens: 15 } },
        ];
        const err = await ai.completeJson({ app_id: 'retry-2', prompt: 'Name it twice' }).catch((e: any) => e);
        expect(err.code).toBe('JSON_PARSE_FAILED');
        expect(err.usage).toEqual({ total_tokens: 25 });
        expect(err.attempts).toBe(2);
    });

    it('a first answer that parses is one call, with its own usage and attempts 1', async () => {
        const ai = await lib();
        answers = [{ content: '{"title":"First"}', usage: { total_tokens: 7 } }];
        const r = await ai.completeJson({ app_id: 'retry-3', prompt: 'Once' });
        expect(calls.filter(c => c.path === '/v1/ai/complete')).toHaveLength(1);
        expect(r.usage).toEqual({ total_tokens: 7 });
        expect(r.attempts).toBe(1);
    });
});

describe('complete() sends max_tokens only when the app says it means it', () => {
    it('max_tokens alone is left out of the request, and the console says why once', async () => {
        const ai = await lib();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await ai.complete({ app_id: 'cap-1', prompt: 'Summarise this', max_tokens: 256 });
        await ai.complete({ app_id: 'cap-1', prompt: 'Summarise that', max_tokens: 256 });
        expect(calls.map(c => c.body.max_tokens)).toEqual([undefined, undefined]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('allowCap: true');
        warn.mockRestore();
    });

    it('allowCap: true sends the cap as before', async () => {
        const ai = await lib();
        await ai.complete({ app_id: 'cap-2', prompt: 'One word', max_tokens: 5, allowCap: true });
        expect(calls[0].body.max_tokens).toBe(5);
    });

    it('a call without max_tokens sends none and warns nothing', async () => {
        const ai = await lib();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await ai.complete({ app_id: 'cap-3', prompt: 'Plain' });
        expect('max_tokens' in calls[0].body && calls[0].body.max_tokens !== undefined).toBe(false);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
