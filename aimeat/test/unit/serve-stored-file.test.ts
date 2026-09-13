/**
 * @file test/unit/serve-stored-file.test.ts
 * @description serveStoredFile: what it READS, and what it says about the file while doing it.
 *
 *   THE CASE THAT PROMPTED THIS SUITE. A file stored before the UTF-8 verdict existed carries no
 *   verdict, and its metadata record carries a zero-length `data` buffer. Zero bytes decode as valid
 *   UTF-8. So a range reply built from metadata alone stamped `charset=utf-8` on a file it had never
 *   read — and on a genuinely cp1252 file that is not a slow answer but a false one, declaring an
 *   encoding the bytes do not have while a plain GET of the same file correctly declares nothing.
 *   It was caught against a real node and only because the run happened to include a legacy row.
 *
 *   So every case here asserts BOTH halves: the same Content-Type across HEAD, GET and 206, and the
 *   number of bytes actually read to produce it. A fake reader counts the reads, because "it did not
 *   load the file" is the entire feature and no assertion about the response body can see it.
 *
 *   REVALIDATION (2026-09-13). A re-upload to the same key replaces the row in place, and GET /v1/pub
 *   answers with `max-age=300` and, until now, no ETag: a browser holding the old response kept
 *   drawing the old bytes for five minutes and had nothing to revalidate with afterwards (appdev
 *   pitfall pub-file-cache-stale-assets). The last describe block pins the validator and the 304.
 * @usage cd aimeat && pnpm exec vitest run test/unit/serve-stored-file.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-13 — Strong ETag on every representation, If-None-Match / If-Modified-Since
 *     answered with 304, If-Range honoured, and storedFileVersion() for versioned upload URLs.
 *   v1.0.0 — 2026-08-16 — Initial (TARGET-063: the streaming read path).
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { serveStoredFile, needsBytesForType, storedFileVersion, versionedAddress, type StoredFileReader } from '../../src/utils/http-range.js';
import { setStoredFileHeaders } from '../../src/utils/file-download-headers.js';

/** UTF-8 text, so the charset question has a real answer either way. */
const UTF8 = Buffer.from('vnr,laake\n001000,Särkylääke\n'.repeat(40), 'utf8');
/** cp1252: 0xE4 alone is not a legal UTF-8 sequence. The file the wrong answer would have lied about. */
const CP1252 = Buffer.concat([Buffer.from('name\n'), Buffer.from([0x53, 0xE4, 0x72, 0x6B, 0x79, 0x0A])]);

/** A Response that records rather than sends. */
function fakeRes() {
    const headers: Record<string, string> = {};
    const out = { status: 200, headers, body: null as Buffer | null, ended: false };
    const res = {
        setHeader(k: string, v: string | number) { headers[k.toLowerCase()] = String(v); },
        status(code: number) { out.status = code; return res; },
        end(chunk?: Buffer) { out.body = chunk ?? null; out.ended = true; return res; },
    } as unknown as Response;
    return { res, out };
}

/** A reader that counts what it was asked for, so "it did not read the file" is measurable. */
function countingReader(data: Buffer) {
    const calls = { all: 0, range: 0, bytesRead: 0 };
    const reader: StoredFileReader = {
        async all() { calls.all += 1; calls.bytesRead += data.length; return data; },
        async range(start, length) {
            calls.range += 1;
            const chunk = data.subarray(start, start + length);
            calls.bytesRead += chunk.length;
            return chunk;
        },
    };
    return { reader, calls };
}

const withVerdict = (data: Buffer, utf8Verified: boolean) =>
    ({ key: 'data/rows.csv', mimeType: 'text/csv', size: data.length, utf8Verified });
/** A row from before the verdict existed: no answer stored, and none inferable from metadata. */
const legacy = (data: Buffer) => ({ key: 'data/rows.csv', mimeType: 'text/csv', size: data.length });

describe('a file whose verdict is stored is never read beyond the range asked for', () => {
    it('a suffix range reads only those bytes', async () => {
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        expect(await serveStoredFile(res, withVerdict(UTF8, true), 'bytes=-8', reader)).toBe(true);

        expect(out.status).toBe(206);
        expect(out.body!.equals(UTF8.subarray(UTF8.length - 8))).toBe(true);
        expect(out.headers['content-range']).toBe(`bytes ${UTF8.length - 8}-${UTF8.length - 1}/${UTF8.length}`);
        expect(calls.all, 'the whole file was read to serve eight bytes').toBe(0);
        expect(calls.bytesRead, 'more than the range crossed the wire').toBe(8);
    });

    it('a HEAD reads nothing at all', async () => {
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, withVerdict(UTF8, true), undefined, reader, { headOnly: true });

        expect(out.status).toBe(200);
        expect(out.body, 'a HEAD must carry no body').toBeNull();
        expect(out.headers['content-length'], 'and must still report the full size').toBe(String(UTF8.length));
        expect(out.headers['accept-ranges'], 'a range reader decides from this header alone').toBe('bytes');
        expect(calls.all + calls.range, 'a HEAD read the file').toBe(0);
    });

    it('a HEAD carrying a Range answers 206, because that IS the question it is asking', async () => {
        // Not pedantry about RFC 9110. `HEAD` with `Range: bytes=0-` is the probe a client uses to
        // find out whether this server does ranges at all, and DuckDB-Wasm's own condition for the
        // answer is `contentLength !== null && status == 206`. An earlier version of serveStoredFile
        // short-circuited before reading the Range header, so the probe got 200 and the full length.
        // DuckDB read that as "no ranges here": it pulled an 8.45 MB Parquet file in ONE request to
        // answer a two-column aggregate, and with full reads disabled it refused to open the file.
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, withVerdict(UTF8, true), 'bytes=0-', reader, { headOnly: true });

        expect(out.status, 'a ranged HEAD answered 200, which reads as "no ranges here"').toBe(206);
        expect(out.headers['content-range']).toBe(`bytes 0-${UTF8.length - 1}/${UTF8.length}`);
        expect(out.headers['content-length'], 'the LENGTH OF THE RANGE, not of the file').toBe(String(UTF8.length));
        expect(out.body, 'a HEAD must still carry no body').toBeNull();
        expect(calls.all + calls.range, 'and must still read nothing').toBe(0);
    });

    it('a HEAD with a partial Range reports that range, not the whole file', async () => {
        const { res, out } = fakeRes();
        const { reader } = countingReader(UTF8);
        await serveStoredFile(res, withVerdict(UTF8, true), 'bytes=10-19', reader, { headOnly: true });
        expect(out.status).toBe(206);
        expect(out.headers['content-range']).toBe(`bytes 10-19/${UTF8.length}`);
        expect(out.headers['content-length']).toBe('10');
    });

    it('a HEAD with an unsatisfiable Range is a 416, exactly as the GET would be', async () => {
        const { res, out } = fakeRes();
        const { reader } = countingReader(UTF8);
        await serveStoredFile(res, withVerdict(UTF8, true), 'bytes=999999-', reader, { headOnly: true });
        expect(out.status).toBe(416);
        expect(out.headers['content-range']).toBe(`bytes */${UTF8.length}`);
    });

    it('every representation carries Last-Modified, which a ranged reader keeps between requests', async () => {
        const { res, out } = fakeRes();
        const { reader } = countingReader(UTF8);
        await serveStoredFile(res, { ...withVerdict(UTF8, true), createdAt: '2026-08-15T21:00:00.000Z' },
            'bytes=-8', reader);
        expect(out.headers['last-modified']).toBe('Sat, 15 Aug 2026 21:00:00 GMT');
    });

    it('an unsatisfiable range is a 416 and reads nothing', async () => {
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, withVerdict(UTF8, true), 'bytes=999999-', reader);

        expect(out.status).toBe(416);
        expect(out.headers['content-range']).toBe(`bytes */${UTF8.length}`);
        expect(calls.all + calls.range, 'a refusal read the file').toBe(0);
    });

    it('a full GET reads the file once, and only once', async () => {
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, withVerdict(UTF8, true), undefined, reader);

        expect(out.status).toBe(200);
        expect(out.body!.equals(UTF8)).toBe(true);
        expect(calls.all).toBe(1);
        expect(calls.range).toBe(0);
    });

    it('a file that vanished between the metadata and the bytes is reported, not half-served', async () => {
        const { res, out } = fakeRes();
        const gone: StoredFileReader = { async all() { return null; }, async range() { return null; } };
        expect(await serveStoredFile(res, withVerdict(UTF8, true), undefined, gone), 'it claimed success').toBe(false);
        expect(out.ended, 'it sent a response anyway, so the caller cannot send its 404').toBe(false);
    });
});

describe('a file stored before the verdict existed still gets ONE answer', () => {
    const contentTypeAcross = async (data: Buffer, file: ReturnType<typeof legacy>) => {
        const seen: Record<string, string> = {};
        for (const [label, rangeHeader, headOnly] of [
            ['head', undefined, true], ['get', undefined, false], ['range', 'bytes=-4', false],
        ] as const) {
            const { reader } = countingReader(data);
            const { res, out } = fakeRes();
            await serveStoredFile(res, { ...file }, rangeHeader, reader, { headOnly });
            seen[label] = out.headers['content-type'];
        }
        return seen;
    };

    it('a cp1252 file is NOT declared UTF-8 by any of the three', async () => {
        // The defect this suite exists for. Metadata carries an empty data buffer, empty decodes as
        // valid UTF-8, and the 206 declared a charset the file does not have.
        const seen = await contentTypeAcross(CP1252, legacy(CP1252));
        expect(seen.range, 'the range reply invented an encoding').toBe('text/csv');
        expect(seen.head).toBe('text/csv');
        expect(seen.get).toBe('text/csv');
    });

    it('a UTF-8 file is declared identically by all three', async () => {
        const seen = await contentTypeAcross(UTF8, legacy(UTF8));
        expect(new Set(Object.values(seen)).size, `three answers: ${JSON.stringify(seen)}`).toBe(1);
        expect(seen.get).toBe('text/csv; charset=utf-8');
    });

    it('it costs one read of the file, and not two', async () => {
        // The old cost, paid only by rows that predate the verdict — but paid once. Reading the file
        // for the header and then asking the database for a slice of the same file would be worse
        // than what it replaced.
        const { reader, calls } = countingReader(UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, legacy(UTF8), 'bytes=-4', reader);

        expect(out.status).toBe(206);
        expect(out.body!.equals(UTF8.subarray(UTF8.length - 4))).toBe(true);
        expect(calls.all, 'the file should be read once for the charset').toBe(1);
        expect(calls.range, 'and then sliced in place rather than read again').toBe(0);
    });

    it('handing the header builder a metadata record does not make it invent a charset', async () => {
        // Defence in depth rather than the fix: serveStoredFile above never hands over an empty
        // buffer any more. This pins the trap itself, because the next caller to pass a metadata
        // record straight through would otherwise declare an encoding for a file nobody read — the
        // buffer is empty, empty decodes as UTF-8, and the answer looks confident and is invented.
        const { res, out } = fakeRes();
        setStoredFileHeaders(res, { key: 'rows.csv', mimeType: 'text/csv', data: Buffer.alloc(0) });
        expect(out.headers['content-type']).toBe('text/csv');
    });

    it('a type no charset could improve answers from metadata alone', async () => {
        // A PNG never carries a verdict and never needs one, so nothing about this path is slow for
        // the files that make up most of what a node stores.
        const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        expect(needsBytesForType({ mimeType: 'image/png' })).toBe(false);
        const { reader, calls } = countingReader(png);
        const { res, out } = fakeRes();
        await serveStoredFile(res, { key: 'a.png', mimeType: 'image/png', size: png.length }, undefined, reader, { headOnly: true });

        expect(out.headers['content-type']).toBe('image/png');
        expect(calls.all + calls.range).toBe(0);
    });
});

describe('a file written again under the same key is revalidated, never trusted past its validator', () => {
    // Relative to the real clock and an hour back, so no date here is in the future. The second
    // write has the SAME size as the first: a validator built from the size alone would miss it.
    const t0 = Math.floor(Date.now() / 1000) * 1000 - 3_600_000 + 250;
    const first = { ...withVerdict(UTF8, true), createdAt: new Date(t0).toISOString() };
    const second = { ...withVerdict(UTF8, true), createdAt: new Date(t0 + 4_000).toISOString() };

    /** One request against `file`, with the given request headers. */
    const request = async (
        file: typeof first,
        headers: Record<string, string>,
        opts: { range?: string; headOnly?: boolean; data?: Buffer } = {},
    ) => {
        const { reader, calls } = countingReader(opts.data ?? UTF8);
        const { res, out } = fakeRes();
        await serveStoredFile(res, file, opts.range, reader, { headOnly: opts.headOnly, conditionals: headers });
        return { out, calls };
    };
    const etagOf = async (file: typeof first) => (await request(file, {})).out.headers.etag;

    it('every representation carries the same strong ETag', async () => {
        const get = (await request(first, {})).out.headers.etag;
        const head = (await request(first, {}, { headOnly: true })).out.headers.etag;
        const part = (await request(first, {}, { range: 'bytes=-8' })).out.headers.etag;
        expect(get, 'a GET of a stored file carried no ETag, so a browser has nothing to revalidate with').toMatch(/^"[^"]+"$/);
        expect(head).toBe(get);
        expect(part).toBe(get);
    });

    it('the ETag changes when the file is written again, even at the same size', async () => {
        expect(await etagOf(second)).not.toBe(await etagOf(first));
    });

    it('If-None-Match with the current ETag is a 304 that reads nothing', async () => {
        const etag = await etagOf(first);
        const { out, calls } = await request(first, { 'if-none-match': etag });
        expect(out.status).toBe(304);
        expect(out.body, 'a 304 carries no body').toBeNull();
        expect(out.headers.etag, 'and still names the validator').toBe(etag);
        expect(out.headers['content-length']).toBeUndefined();
        expect(calls.all + calls.range, 'a 304 read the file').toBe(0);
    });

    it('a row from before the UTF-8 verdict answers a 304 without reading its bytes either', async () => {
        const old = { ...legacy(UTF8), createdAt: first.createdAt };
        const etag = (await request(old, {})).out.headers.etag;
        const { out, calls } = await request(old, { 'if-none-match': etag });
        expect(out.status).toBe(304);
        expect(calls.all + calls.range).toBe(0);
    });

    it('If-None-Match with the previous ETag gets the new bytes', async () => {
        const stale = await etagOf(first);
        const fresh = Buffer.from('uusi sisältö\n'.repeat(40), 'utf8');
        const { out } = await request({ ...second, size: fresh.length }, { 'if-none-match': stale }, { data: fresh });
        expect(out.status).toBe(200);
        expect(out.body!.equals(fresh)).toBe(true);
    });

    it('a weak form of the ETag still matches If-None-Match, as a compressing proxy sends it', async () => {
        const etag = await etagOf(first);
        const { out } = await request(first, { 'if-none-match': `"other", W/${etag}` });
        expect(out.status).toBe(304);
    });

    it('If-None-Match: * matches any stored file', async () => {
        expect((await request(first, { 'if-none-match': '*' })).out.status).toBe(304);
    });

    it('a HEAD with a matching If-None-Match is a 304 too', async () => {
        const etag = await etagOf(first);
        const { out } = await request(first, { 'if-none-match': etag }, { headOnly: true });
        expect(out.status).toBe(304);
    });

    it('If-Modified-Since at the write time is a 304, and a second before it sends the file', async () => {
        const lastModified = (await request(second, {})).out.headers['last-modified'];
        expect((await request(second, { 'if-modified-since': lastModified })).out.status).toBe(304);
        const before = new Date(Date.parse(lastModified) - 1000).toUTCString();
        expect((await request(second, { 'if-modified-since': before })).out.status).toBe(200);
    });

    it('If-None-Match is decided first, and If-Modified-Since is ignored beside it', async () => {
        // RFC 9110 §13.2.2: a date says nothing a mismatching entity tag has not already answered.
        // A same-second rewrite is exactly the case where the date would be wrong.
        const stale = await etagOf(first);
        const lastModified = (await request(second, {})).out.headers['last-modified'];
        const { out } = await request(second, { 'if-none-match': stale, 'if-modified-since': lastModified });
        expect(out.status).toBe(200);
    });

    it('an unparseable If-Modified-Since is ignored', async () => {
        expect((await request(first, { 'if-modified-since': 'yesterday' })).out.status).toBe(200);
    });

    it('a matching conditional request with a Range is a 304, not a 206', async () => {
        const etag = await etagOf(first);
        const { out, calls } = await request(first, { 'if-none-match': etag }, { range: 'bytes=-8' });
        expect(out.status).toBe(304);
        expect(calls.all + calls.range).toBe(0);
    });

    it('If-Range with a stale ETag sends the whole new file instead of a slice of it', async () => {
        // A range reader that resumes against a file which changed under it would otherwise stitch
        // a slice of the new bytes onto the old ones.
        const stale = await etagOf(first);
        const { out } = await request(second, { 'if-range': stale }, { range: 'bytes=-8' });
        expect(out.status).toBe(200);
        expect(out.body!.equals(UTF8)).toBe(true);
    });

    it('If-Range with the current ETag honours the range', async () => {
        const etag = await etagOf(second);
        const { out } = await request(second, { 'if-range': etag }, { range: 'bytes=-8' });
        expect(out.status).toBe(206);
    });

    it('storedFileVersion changes on every write and is URL-safe', () => {
        const a = storedFileVersion(first);
        const b = storedFileVersion(second);
        expect(a).toMatch(/^[0-9a-z-]+$/);
        expect(b).not.toBe(a);
        expect(storedFileVersion({ size: 3 }), 'no write time, no version').toBeNull();
    });

    it('versionedAddress puts that version on the address an upload answer hands out', () => {
        const plain = '/v1/pub/alice%40node/ridge/hero.png';
        expect(versionedAddress(plain, first)).toBe(`${plain}?v=${storedFileVersion(first)}`);
        expect(versionedAddress(plain, second)).not.toBe(versionedAddress(plain, first));
        expect(versionedAddress(`${plain}?mode=x`, first)).toBe(`${plain}?mode=x&v=${storedFileVersion(first)}`);
        expect(versionedAddress(plain, { size: 3 }), 'nothing to version by, so the address is left alone').toBe(plain);
    });
});
