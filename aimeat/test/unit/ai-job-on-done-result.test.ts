/**
 * @file test/unit/ai-job-on-done-result.test.ts
 * @description The on_done input carries a finished job's answer as `result` up to
 *   ON_DONE_RESULT_MAX_BYTES of UTF-8 JSON, and `result_too_large: true` past it, so the action reads
 *   a larger answer with ctx.ai.result instead (services/ai-jobs/on-done.ts). The bound is counted in
 *   bytes, not characters, because the input crosses into the sandbox as JSON text.
 * @usage pnpm test -- ai-job-on-done-result
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ON_DONE_RESULT_MAX_BYTES, onDoneResultFields } from '../../src/services/ai-jobs/on-done.js';

describe('the answer in the on_done input', () => {
    it('a text answer that fits is carried as result', () => {
        expect(onDoneResultFields('a short answer')).toEqual({ result: 'a short answer' });
    });

    it('an image record is carried whole', () => {
        const record = { storage_key: 'k', url: 'https://x', mime_type: 'image/png', model: 'm' };
        expect(onDoneResultFields(record)).toEqual({ result: record });
    });

    it('an answer exactly at the bound is carried; one byte over is flagged instead', () => {
        // JSON of a plain ASCII string is the string plus its two quotes.
        const atBound = 'x'.repeat(ON_DONE_RESULT_MAX_BYTES - 2);
        expect(onDoneResultFields(atBound)).toEqual({ result: atBound });
        expect(onDoneResultFields(atBound + 'x')).toEqual({ result_too_large: true });
    });

    it('the bound counts UTF-8 bytes: two-byte text is flagged at half the characters', () => {
        const finnish = 'ä'.repeat(Math.ceil(ON_DONE_RESULT_MAX_BYTES / 2));
        expect(onDoneResultFields(finnish)).toEqual({ result_too_large: true });
    });
});
