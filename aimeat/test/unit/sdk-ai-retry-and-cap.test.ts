/**
 * @file test/unit/sdk-ai-retry-and-cap.test.ts
 * @description Two things AIMEAT.ai did that an app could not see:
 *   - completeJson() retried a non-JSON answer once and answered with the retry's usage alone, so a
 *     retried answer looked half its price. Its usage is now the sum of both calls, with `attempts`
 *     and `first_usage`; the error after two misses carries the sum too.
 *   - complete() sends `max_tokens` as given, and a cap copied from an example cut answers that an
 *     app then showed as whole. An answer the call's own cap cut now says so: `truncated: true` (also
 *     when the route said only finish_reason 'length'), `capped_at` and a `warning` naming
 *     max_tokens; completeJson()'s error on such an answer says the cap cut the JSON.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-ai-retry-and-cap.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6: ai/completejson-retry-hides-cost, no-max-tokens).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { path: string; body: any };
const calls: Call[] = [];
let answers: Array<{ content: string; usage: any; finish_reason?: string; truncated?: boolean }> = [];

beforeEach(() => {
    calls.length = 0;
    answers = [];
    const session = {
        fetch: async (path: string, opts: { body?: string } = {}) => {
            calls.push({ path, body: opts.body ? JSON.parse(opts.body) : null });
            const next = answers.shift() ?? { content: '{"ok":true}', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
            return { ok: true, data: {
                content: next.content, model: 'm', usage: next.usage, budget: null,
                ...(next.finish_reason ? { finish_reason: next.finish_reason } : {}),
                ...(next.truncated !== undefined ? { truncated: next.truncated } : {}),
            } };
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

describe('an answer the call\'s own max_tokens cut says so', () => {
    it('the cap is sent as given, and a cut answer carries truncated, capped_at and a warning naming max_tokens', async () => {
        const ai = await lib();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        answers = [{ content: 'The first half of', usage: {}, finish_reason: 'length' }];
        const r = await ai.complete({ app_id: 'cap-1', prompt: 'Summarise this', max_tokens: 256 });
        expect(calls[0].body.max_tokens).toBe(256);
        expect(r.truncated).toBe(true);
        expect(r.capped_at).toBe(256);
        expect(r.warning).toContain('max_tokens 256');
        expect(String(warn.mock.calls[0][0])).toContain('max_tokens 256');
        warn.mockRestore();
    });

    it('a whole answer under a cap, and a cut answer with no cap of the call\'s own, are left as the route gave them', async () => {
        const ai = await lib();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        answers = [
            { content: 'Short and whole.', usage: {}, finish_reason: 'stop', truncated: false },
            { content: 'Cut by the owner\'s limit', usage: {}, finish_reason: 'length', truncated: true },
        ];
        const whole = await ai.complete({ app_id: 'cap-2', prompt: 'One word', max_tokens: 5 });
        expect(whole.truncated).toBe(false);
        expect(whole.warning).toBeUndefined();
        const cut = await ai.complete({ app_id: 'cap-2', prompt: 'Long' });
        expect(cut.truncated).toBe(true);
        expect(cut.capped_at).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('completeJson\'s error on JSON the cap cut says the cap cut it', async () => {
        const ai = await lib();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        answers = [
            { content: '{"items":["a","b",', usage: { total_tokens: 8 }, finish_reason: 'length' },
            { content: '{"items":["a",', usage: { total_tokens: 8 }, finish_reason: 'length' },
        ];
        const err = await ai.completeJson({ app_id: 'cap-3', prompt: 'List them', max_tokens: 8 }).catch((e: any) => e);
        expect(err.code).toBe('JSON_PARSE_FAILED');
        expect(err.message).toContain('cut at max_tokens 8');
        expect(err.truncated).toBe(true);
        warn.mockRestore();
    });
});
