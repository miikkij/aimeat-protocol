/**
 * @file test/unit/content-type-verdict.test.ts
 * @description The UTF-8 verdict, and the one thing that must never happen to it: "we did not check"
 *   turning into "we checked and it is not UTF-8".
 *
 *   Those two are different facts with the same falsy shape, and the whole design rests on keeping
 *   them apart. A file stored before the verdict existed carries no answer, and the honest response
 *   is to serve it exactly as it is served today. A file that was checked and failed gets the same
 *   treatment for a different reason. Collapsing the first into the second would be harmless here
 *   and is checked anyway, because the inverse — undefined read as "verified" — would declare
 *   charset=utf-8 over a cp1252 file and corrupt something that reads correctly now.
 *
 *   The other half is that sniffedContentType and verifiedContentType must agree. They are two ways
 *   into one rule, and a 200 that sniffs the bytes and a 206 that reads the stored verdict have to
 *   name the same type or a client learns one answer from one request and a different one from the
 *   next.
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-type-verdict.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial (TARGET-063: the streaming read path).
 */
import { describe, it, expect } from 'vitest';
import {
    appContentType, sniffedContentType, verifiedContentType, needsUtf8Verdict, isValidUtf8, utf8VerdictFor,
} from '../../src/utils/app-content-type.js';

const UTF8 = Buffer.from('Särkylääke ÄÖ\n', 'utf8');
/** 0xE4 standing alone is not a legal UTF-8 sequence — a genuine cp1252 file. */
const CP1252 = Buffer.from([0x53, 0xE4, 0x72, 0x6B, 0x79, 0x0A]);
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

describe('what the decode test answers', () => {
    it('recognises UTF-8, and refuses to call cp1252 UTF-8', () => {
        expect(isValidUtf8(UTF8)).toBe(true);
        expect(isValidUtf8(CP1252)).toBe(false);
        expect(isValidUtf8(Buffer.alloc(0)), 'an empty file decodes trivially').toBe(true);
    });

    it('is asked only where the answer could change what is served', () => {
        expect(needsUtf8Verdict('text/csv')).toBe(true);
        expect(needsUtf8Verdict('application/json')).toBe(true);
        expect(needsUtf8Verdict('image/svg+xml'), 'an SVG is a document').toBe(true);
        expect(needsUtf8Verdict('image/png')).toBe(false);
        expect(needsUtf8Verdict('application/octet-stream')).toBe(false);
        expect(needsUtf8Verdict(''), 'an absent type is octet-stream').toBe(false);
        expect(needsUtf8Verdict('text/csv; charset=iso-8859-1'), 'the author already said it').toBe(false);
    });

    it('the stored verdict is null exactly when the question does not apply', () => {
        expect(utf8VerdictFor({ mimeType: 'text/csv', data: UTF8 })).toBe(true);
        expect(utf8VerdictFor({ mimeType: 'text/csv', data: CP1252 })).toBe(false);
        expect(utf8VerdictFor({ mimeType: 'image/png', data: PNG })).toBeNull();
        expect(utf8VerdictFor({ mimeType: 'text/plain; charset=utf-8', data: UTF8 })).toBeNull();
    });
});

describe('a stored verdict and the bytes reach the same conclusion', () => {
    const cases: Array<{ type: string; bytes: Buffer }> = [
        { type: 'text/csv', bytes: UTF8 },
        { type: 'text/csv', bytes: CP1252 },
        { type: 'text/plain', bytes: UTF8 },
        { type: 'application/json', bytes: UTF8 },
        { type: 'image/png', bytes: PNG },
        { type: 'application/octet-stream', bytes: PNG },
        { type: 'text/csv; charset=iso-8859-1', bytes: CP1252 },
    ];

    it('sniffing the file and reading its verdict give the same Content-Type', () => {
        for (const { type, bytes } of cases) {
            const sniffed = sniffedContentType(type, bytes);
            const stored = verifiedContentType(type, utf8VerdictFor({ mimeType: type, data: bytes }) ?? undefined);
            expect(stored, `${type}: the 206 would say "${stored}" where the 200 says "${sniffed}"`).toBe(sniffed);
        }
    });

    it('a UTF-8 text file is declared as such through both doors', () => {
        expect(sniffedContentType('text/csv', UTF8)).toBe('text/csv; charset=utf-8');
        expect(verifiedContentType('text/csv', true)).toBe('text/csv; charset=utf-8');
    });
});

describe('not established is not the same as not UTF-8', () => {
    it('undefined never declares a charset', () => {
        // A file stored before the verdict existed. Saying nothing keeps it being served exactly as
        // it is served today; the alternative would retype somebody's cp1252 file over their head.
        expect(verifiedContentType('text/csv', undefined)).toBe('text/csv');
        expect(verifiedContentType('text/csv', null)).toBe('text/csv');
        expect(verifiedContentType('text/csv', false)).toBe('text/csv');
    });

    it('a false verdict is not read as "leave it alone, we know nothing"', () => {
        // Same output, different reason, and the difference is visible at the layer above: the
        // provider records false and leaves NULL absent, so a later backfill can tell which rows it
        // still has to look at.
        expect(utf8VerdictFor({ mimeType: 'text/csv', data: CP1252 })).toBe(false);
        expect(utf8VerdictFor({ mimeType: 'image/png', data: PNG })).toBeNull();
    });

    it('an empty or missing type still comes back as something a client can read', () => {
        expect(verifiedContentType('', true)).toBe('application/octet-stream');
        expect(verifiedContentType(undefined, undefined)).toBe('application/octet-stream');
    });
});

describe('the node-generated path is untouched by any of this', () => {
    it('appContentType still declares utf-8 without asking about bytes', () => {
        // App HTML is UTF-8 by construction — it arrives as a JavaScript string through a JSON API —
        // and that argument is the reason this function does not sniff. It must not start.
        expect(appContentType('text/html')).toBe('text/html; charset=utf-8');
        expect(appContentType('text/html; charset=iso-8859-1')).toBe('text/html; charset=iso-8859-1');
        expect(appContentType('image/png')).toBe('image/png');
    });
});
