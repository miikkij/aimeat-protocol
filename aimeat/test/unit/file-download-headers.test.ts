/**
 * @file test/unit/file-download-headers.test.ts
 * @description The allowlist that decides whether a stored file may be rendered, and the four
 *   headers every download path sends (August 2026 audit H-26). The case that matters: a file's
 *   Content-Type comes from whoever uploaded it, and GET /v1/pub serves a public file to anyone
 *   from the apex origin, so uploaded text/html or image/svg+xml must come back as an attachment.
 * @structure One describe per exported function.
 * @usage cd aimeat && pnpm exec vitest run test/unit/file-download-headers.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, with the H-26 hardening.
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { isInlineSafeFileType, setStoredFileHeaders } from '../../src/utils/file-download-headers.js';

/** Minimal stand-in for the bits of an Express response these headers touch. */
function fakeRes(): Response & { headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    return {
        headers,
        setHeader(name: string, value: string | number) { headers[name] = String(value); },
    } as unknown as Response & { headers: Record<string, string> };
}

describe('isInlineSafeFileType', () => {
    it('renders the types a browser cannot run script from', () => {
        for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
            'text/plain', 'text/plain; charset=utf-8', 'audio/mpeg', 'video/mp4']) {
            expect(isInlineSafeFileType(t), t).toBe(true);
        }
    });

    it('refuses everything that can carry script, including an SVG calling itself an image', () => {
        for (const t of ['text/html', 'image/svg+xml', 'IMAGE/SVG+XML', 'application/xml', 'text/xml',
            'application/javascript', 'text/markdown', 'application/octet-stream', '', null, undefined]) {
            expect(isInlineSafeFileType(t), String(t)).toBe(false);
        }
    });
});

describe('setStoredFileHeaders', () => {
    it('marks an uploaded HTML page as an attachment and sandboxes it', () => {
        const res = fakeRes();
        setStoredFileHeaders(res, { key: 'notes/evil.html', mimeType: 'text/html', data: Buffer.from('<b>x</b>') });
        expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="evil\.html"/);
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'");
        expect(res.headers['Content-Security-Policy']).toContain('sandbox');
    });

    it('leaves an image inline, and keeps sandbox off so the image document still draws', () => {
        const res = fakeRes();
        setStoredFileHeaders(res, { key: 'pic.png', mimeType: 'image/png', data: Buffer.from([0x89, 0x50]) });
        expect(res.headers['Content-Disposition']).toMatch(/^inline; filename="pic\.png"/);
        expect(res.headers['Content-Type']).toBe('image/png');
        expect(res.headers['Content-Security-Policy']).not.toContain('sandbox');
        expect(res.headers['Content-Security-Policy']).toContain("img-src 'self'");
    });

    it('keeps the charset sniff that the text routes rely on', () => {
        const res = fakeRes();
        setStoredFileHeaders(res, { key: 'a.txt', mimeType: 'text/plain', data: Buffer.from('ääkköset', 'utf8') });
        expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    });

    it('carries a Finnish filename without putting a non-ASCII byte in the header', () => {
        const res = fakeRes();
        setStoredFileHeaders(res, { key: 'muistio-ääni.html', mimeType: 'text/html', data: Buffer.from('x') });
        const cd = res.headers['Content-Disposition'];
        // Node throws ERR_INVALID_CHAR on a non-ASCII header value, so the plain form is sanitised
        // and the real name travels in the RFC 5987 form every current browser prefers.
        expect(cd).toContain('filename="muistio-__ni.html"');
        expect(cd).toContain("filename*=UTF-8''muistio-%C3%A4%C3%A4ni.html");
        // eslint-disable-next-line no-control-regex -- the point of the assertion is the byte range
        expect(/^[\x20-\x7E]*$/.test(cd)).toBe(true);
    });

    it('falls back to a bare disposition when the key has no last segment', () => {
        const res = fakeRes();
        setStoredFileHeaders(res, { key: '', mimeType: 'application/octet-stream', data: Buffer.from('x') });
        expect(res.headers['Content-Disposition']).toBe('attachment');
    });
});
