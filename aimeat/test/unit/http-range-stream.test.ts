/**
 * @file test/unit/http-range-stream.test.ts
 * @description serveStoredFile() sends a large body a slice at a time, and never holds more than a
 *   slice of it.
 *
 *   WHAT WAS WRONG. A range was read with ONE call, however long it was, and a full download with
 *   read.all(). `Range: bytes=0-` is the first request a `<video>` element makes, and it is
 *   open-ended: on a 400 MB file that one call asked the database for 400 MB in one value. On
 *   Postgres the driver builds one string of twice that length, V8 refuses it, and the node process
 *   exits (measured 2026-10-10: ERR_STRING_TOO_LONG). Below that size it "worked" by holding the
 *   whole file in memory before the first byte was sent: 4.4 s to the first 4 MB of a 160 MB file.
 *
 *   The test runs serveStoredFile() behind a real HTTP server and reads it with a real client,
 *   because what is being proven is what arrives on the wire and when the reading stops: a fake
 *   response object would prove the fake.
 * @usage cd aimeat && pnpm exec vitest run test/unit/http-range-stream.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (http-range v1.3.0, a stored file is served in slices).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serveStoredFile, STORED_FILE_SLICE_BYTES } from '../../src/utils/http-range.js';

const SLICE = STORED_FILE_SLICE_BYTES;
// Six slices and a bit: a first, several in the middle and a short last one, and more than a
// loopback socket buffers, so a hang-up is noticed before the last read.
const SLICES = 7;
const SIZE = SLICE * 6 + 12345;
const DATA = crypto.randomBytes(SIZE);
const sha = (b: Buffer): string => crypto.createHash('sha1').update(b).digest('hex');

interface Calls { range: Array<[number, number]>; all: number }
let calls: Calls;
let vanishAfter = Infinity;
let server: http.Server;
let base = '';

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const r = res as unknown as http.ServerResponse & { status: (code: number) => unknown };
        r.status = (code: number) => { res.statusCode = code; return res; };
        void serveStoredFile(r as never, { key: 'film.mp4', mimeType: 'video/mp4', size: SIZE, utf8Verified: false, createdAt: '2026-10-10T18:00:00.000Z' },
            req.headers.range, {
                range: async (start, length) => {
                    calls.range.push([start, length]);
                    if (calls.range.length > vanishAfter) return null;
                    return DATA.subarray(start, start + length);
                },
                all: async () => { calls.all++; return DATA; },
            }, { headOnly: req.method === 'HEAD', conditionals: req.headers }).then((served) => {
            if (!served) { res.statusCode = 404; res.end(); }
        });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((done) => server.close(done)); });

function reset(): void { calls = { range: [], all: 0 }; vanishAfter = Infinity; }
const longest = (): number => Math.max(...calls.range.map(([, n]) => n));

describe('serveStoredFile sends a large body in slices', () => {
    it('answers an open-ended range with every byte asked for, read a slice at a time', async () => {
        reset();
        const res = await fetch(base + '/', { headers: { Range: 'bytes=0-' } });
        const body = Buffer.from(await res.arrayBuffer());
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
        expect(res.headers.get('content-length')).toBe(String(SIZE));
        expect(body.length).toBe(SIZE);
        expect(sha(body)).toBe(sha(DATA));
        expect(calls.all).toBe(0);
        expect(calls.range.length).toBe(SLICES);
        expect(longest()).toBe(SLICE);
    });

    it('answers a long explicit range from the middle the same way, byte for byte', async () => {
        reset();
        const start = 1000, end = SLICE * 2 + 500;
        const res = await fetch(base + '/', { headers: { Range: `bytes=${start}-${end}` } });
        const body = Buffer.from(await res.arrayBuffer());
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${SIZE}`);
        expect(sha(body)).toBe(sha(DATA.subarray(start, end + 1)));
        expect(calls.all).toBe(0);
        expect(longest()).toBeLessThanOrEqual(SLICE);
    });

    it('sends a full download without ever reading the whole file in one call', async () => {
        reset();
        const res = await fetch(base + '/');
        const body = Buffer.from(await res.arrayBuffer());
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe(String(SIZE));
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(sha(body)).toBe(sha(DATA));
        expect(calls.all).toBe(0);
        expect(longest()).toBe(SLICE);
    });

    it('reads a short range in one call, exactly as before', async () => {
        reset();
        const res = await fetch(base + '/', { headers: { Range: 'bytes=10-1033' } });
        const body = Buffer.from(await res.arrayBuffer());
        expect(res.status).toBe(206);
        expect(sha(body)).toBe(sha(DATA.subarray(10, 1034)));
        expect(calls.range).toEqual([[10, 1024]]);
    });

    it('stops reading when the client hangs up, which is what a video element does on a seek', async () => {
        reset();
        await new Promise<void>((done, fail) => {
            const req = http.get(base + '/', { headers: { Range: 'bytes=0-' } }, (res) => {
                res.once('data', () => { req.destroy(); setTimeout(done, 300); });
                res.on('error', () => { /* the hang-up is the point */ });
            });
            req.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') fail(err); });
        });
        // Seven slices make the whole file. A server that kept reading after the hang-up reads all seven.
        expect(calls.range.length).toBeLessThan(SLICES);
        expect(calls.all).toBe(0);
    });

    it('answers 404 through the caller when the file is gone before the first byte', async () => {
        reset();
        vanishAfter = 0;
        const res = await fetch(base + '/', { headers: { Range: 'bytes=0-' } });
        expect(res.status).toBe(404);
    });

    it('ends the response short when the file vanishes mid-way, and does not claim success', async () => {
        reset();
        vanishAfter = 1;
        let failed = false, got = 0;
        try {
            const res = await fetch(base + '/', { headers: { Range: 'bytes=0-' } });
            got = Buffer.from(await res.arrayBuffer()).length;
        } catch { failed = true; }
        // The headers promised SIZE bytes. A client must see the transfer break, never a short body
        // presented as complete.
        expect(failed || got < SIZE).toBe(true);
        expect(got).not.toBe(SIZE);
    });
});
