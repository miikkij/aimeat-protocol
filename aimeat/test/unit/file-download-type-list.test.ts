/**
 * @file test/unit/file-download-type-list.test.ts
 * @description A stored Content-Type that is not one MIME type (a comma-separated list, a value
 *   with no subtype, a stray character) is served as an attachment with the sandbox policy and the
 *   type application/octet-stream, so the inline decision and the header a browser acts on come
 *   from the same reading. A clean single type is served as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/file-download-type-list.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, list-valued stored Content-Type).
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { isInlineSafeFileType, setStoredFileHeaders } from '../../src/utils/file-download-headers.js';

function fakeRes(): Response & { headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    return {
        headers,
        setHeader(name: string, value: string | number) { headers[name] = String(value); },
    } as unknown as Response & { headers: Record<string, string> };
}

const notOneType = ['image/png, text/html', 'image/png,text/html', 'video/mp4 , text/html; charset=utf-8', 'image/', 'image', 'image/png text/html'];

describe('a stored type that is not one MIME type', () => {
    for (const t of notOneType) {
        it(`${JSON.stringify(t)} is not inline-safe`, () => { expect(isInlineSafeFileType(t)).toBe(false); });
        it(`${JSON.stringify(t)} is served as an octet-stream attachment`, () => {
            const res = fakeRes();
            setStoredFileHeaders(res, { key: 'u/f.png', mimeType: t, data: Buffer.from('<h1>x</h1>') });
            expect(res.headers['Content-Disposition']).toMatch(/^attachment/);
            expect(res.headers['Content-Security-Policy']).toContain('sandbox');
            expect(res.headers['Content-Type']).toBe('application/octet-stream');
        });
    }
});

describe('a clean single type is served as before', () => {
    for (const [t, inline] of [['image/png', true], ['video/mp4', true], ['application/pdf', true], ['text/plain', true], ['text/plain; charset=utf-8', true], ['application/zip', false]] as const) {
        it(`${t}`, () => {
            const res = fakeRes();
            setStoredFileHeaders(res, { key: 'u/f', mimeType: t, data: Buffer.from([0x89, 0x50]) });
            expect(res.headers['Content-Disposition'].startsWith(inline ? 'inline' : 'attachment')).toBe(true);
            expect(res.headers['Content-Type'].split(';')[0]).toBe(t.split(';')[0]);
        });
    }
});
