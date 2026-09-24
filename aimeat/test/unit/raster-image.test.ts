/**
 * @file test/unit/raster-image.test.ts
 * @description What makes a stored file an app's icon or screenshot: its bytes are a PNG, a JPEG or a
 *   WebP image. The label a caller put on them is a claim; the signature is the test (A7-2). Also the
 *   serving side, setStoredImageHeaders(), which the icon and screenshot doors use and which refuses,
 *   setting nothing, for bytes that are not a picture.
 * @structure One describe per exported function.
 * @usage cd aimeat && pnpm exec vitest run test/unit/raster-image.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-24 — GIF and AVIF are pictures too. Screenshots were stored with any type until
 *     A7-2, and the catalogue's upload offers every image, so refusing them broke an ordinary upload.
 *   v1.0.0 — 2026-09-24 — Initial (A7-2).
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { rasterImageType, isRasterImageType, imageUploadType } from '../../src/utils/raster-image.js';
import { setStoredImageHeaders } from '../../src/utils/file-download-headers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1A, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(8)]);
const HTML = Buffer.from('<!doctype html><h1>not a picture</h1>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const GIF87 = Buffer.from('GIF87a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
/** An ISO-BMFF `ftyp` box naming the given brand: AVIF is `avif` (a still) or `avis` (a sequence). */
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x1C]), Buffer.from(`ftyp${brand}`), Buffer.alloc(16)]);
const AVIF = ftyp('avif');
const AVIS = ftyp('avis');
const HEIC = ftyp('heic');
const MP4 = ftyp('isom');
const WAVE = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1A, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);

/** Minimal stand-in for the bits of an Express response the header helper touches. */
function fakeRes(): Response & { headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    return {
        headers,
        setHeader(name: string, value: string | number) { headers[name] = String(value); },
    } as unknown as Response & { headers: Record<string, string> };
}

describe('rasterImageType', () => {
    it('names the pictures by their signature', () => {
        expect(rasterImageType(PNG)).toBe('image/png');
        expect(rasterImageType(JPEG)).toBe('image/jpeg');
        expect(rasterImageType(WEBP)).toBe('image/webp');
        expect(rasterImageType(GIF)).toBe('image/gif');
        expect(rasterImageType(GIF87)).toBe('image/gif');
        expect(rasterImageType(AVIF)).toBe('image/avif');
        expect(rasterImageType(AVIS)).toBe('image/avif');
    });

    it('names nothing else, whatever it is called', () => {
        for (const [name, bytes] of Object.entries({ HTML, SVG, WAVE, HEIC, MP4 })) {
            expect(rasterImageType(bytes), name).toBeNull();
        }
        expect(rasterImageType(Buffer.alloc(0))).toBeNull();
        expect(rasterImageType(PNG.subarray(0, 4))).toBeNull();
        expect(rasterImageType(null)).toBeNull();
        expect(rasterImageType(undefined)).toBeNull();
    });
});

describe('isRasterImageType', () => {
    it('accepts the picture labels, in any case, with parameters, and the common jpg spelling', () => {
        for (const t of ['image/png', 'IMAGE/PNG', 'image/jpeg', 'image/jpeg; q=1', 'image/jpg', 'image/webp', 'image/gif', 'image/avif']) {
            expect(isRasterImageType(t), t).toBe(true);
        }
    });

    it('refuses every other label, SVG first among them', () => {
        for (const t of ['image/svg+xml', 'text/html', 'image/heic', 'application/octet-stream', '', undefined, null, 42]) {
            expect(isRasterImageType(t), String(t)).toBe(false);
        }
    });
});

describe('imageUploadType', () => {
    it('stores what the bytes are, and an honest or missing label changes nothing', () => {
        expect(imageUploadType(PNG)).toBe('image/png');
        expect(imageUploadType(PNG, 'image/png')).toBe('image/png');
        expect(imageUploadType(JPEG, 'image/png')).toBe('image/jpeg');
    });

    it('refuses bytes that are not a picture, whatever the label says', () => {
        expect(imageUploadType(HTML, 'image/png')).toBeNull();
        expect(imageUploadType(SVG, 'image/svg+xml')).toBeNull();
    });

    it('refuses a picture whose label names something else, so the caller learns the label is wrong', () => {
        expect(imageUploadType(PNG, 'text/html')).toBeNull();
        expect(imageUploadType(PNG, 'image/svg+xml')).toBeNull();
    });
});

describe('setStoredImageHeaders', () => {
    it('serves a picture as the type its bytes are, inline, under the name the door gives it', () => {
        const res = fakeRes();
        const served = setStoredImageHeaders(res, { key: 'apps/screenshots/demo.html', data: JPEG, name: 'demo-screenshot' });
        expect(served).toBe(true);
        expect(res.headers['Content-Type']).toBe('image/jpeg');
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.headers['Content-Disposition']).toMatch(/^inline; filename="demo-screenshot\.jpg"/);
        expect(res.headers['Content-Security-Policy']).not.toContain('sandbox');
    });

    it('does not believe the stored label: a PNG stored as text/html is served as a PNG', () => {
        const res = fakeRes();
        expect(setStoredImageHeaders(res, { key: 'apps/icons/demo.html', data: PNG })).toBe(true);
        expect(res.headers['Content-Type']).toBe('image/png');
    });

    it('serves a GIF as a GIF, so a screenshot stored as one before A7-2 still shows', () => {
        const res = fakeRes();
        expect(setStoredImageHeaders(res, { key: 'apps/screenshots/demo.html', data: GIF, name: 'demo-screenshot' })).toBe(true);
        expect(res.headers['Content-Type']).toBe('image/gif');
        expect(res.headers['Content-Disposition']).toMatch(/filename="demo-screenshot\.gif"/);
    });

    it('refuses a page or an SVG and sets no header at all, so the door can answer with its refusal', () => {
        for (const data of [HTML, SVG, WAVE]) {
            const res = fakeRes();
            expect(setStoredImageHeaders(res, { key: 'apps/icons/demo.html', data })).toBe(false);
            expect(res.headers).toEqual({});
        }
    });
});
