/**
 * @file test/unit/markdown-negotiation.test.ts
 * @description The headers sendMarkdown() puts on a negotiated markdown answer. The one that matters
 *   here is `X-Content-Type-Options: nosniff`: the sibling sendPlainText() in middleware/plain-text.ts
 *   has always set it, and this helper did not (A7-3). The node sets the header on every response
 *   through a middleware too, so an end-to-end request cannot tell the two apart; the helper's own
 *   promise is what is asserted, so it holds on any response that reaches it.
 * @structure One describe for sendMarkdown().
 * @usage cd aimeat && pnpm exec vitest run test/unit/markdown-negotiation.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (A7-3).
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { sendMarkdown } from '../../src/services/markdown-negotiation.js';

/** Minimal stand-in for the parts of an Express response sendMarkdown touches. */
function fakeRes() {
    const headers: Record<string, string> = {};
    let body: unknown;
    const res = {
        headers,
        get body() { return body; },
        vary(field: string) { headers.Vary = field; return res; },
        set(name: string, value: string) { headers[name] = String(value); return res; },
        setHeader(name: string, value: string | number) { headers[name] = String(value); return res; },
        type(value: string) { headers['Content-Type'] = value; return res; },
        send(value: unknown) { body = value; return res; },
    };
    return res;
}

describe('sendMarkdown', () => {
    it('declares markdown and tells the browser not to guess another type', () => {
        const res = fakeRes();
        sendMarkdown(res as unknown as Response, '# Title\n', '<h1>Title</h1>');
        expect(res.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.body).toBe('# Title\n');
    });

    it('keeps the convention headers', () => {
        const res = fakeRes();
        sendMarkdown(res as unknown as Response, 'abcd', '<p>abcdefgh</p>');
        expect(res.headers.Vary).toBe('Accept');
        expect(res.headers['x-markdown-tokens']).toBe('1');
        expect(res.headers['x-original-tokens']).toBe('4');
    });
});
