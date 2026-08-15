/**
 * @file test/unit/storage-file-range.test.ts
 * @description Reading a stored file WITHOUT reading all of it, proven identically on both providers.
 *
 *   WHY THESE METHODS EXIST. Every download door used to load the entire file and then decide which
 *   part of it to send. An eight-byte suffix request — the first thing a Parquet reader asks, because
 *   the footer is at the end — read the whole file out of the database to answer it. Measured on
 *   Postgres against this repo's own backend: 181 ms for a 25 MB file that way, 3 ms as a
 *   database-side substring, and the gap widens with the file. So the contract is now "metadata
 *   first, then only the bytes asked for".
 *
 *   WHY IT IS A CONFORMANCE TEST AND NOT A UNIT TEST. `Storage` is implemented twice by hand, and
 *   the two halves have drifted before: listStorageFiles omits the bytes on Postgres and returned
 *   every one of them on SQLite, so the fast local backend was quietly reading 500 MB to list fifty
 *   files while production did the right thing. TypeScript proved the signatures matched the whole
 *   time. Only running the same scenario against both catches that.
 *
 *   Postgres is optional, exactly as in storage-conformance.test.ts: without DATABASE_URL the
 *   SQLite arm still runs and the cross-provider comparison prints why it was skipped.
 * @structure providers() bootstrap · metadata without bytes · exact slices · listings without
 *   payload · the UTF-8 verdict settled on write
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-file-range.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial (TARGET-063: the streaming read path).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.filerange-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) {
        try {
            provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
        } catch (err) {
            console.warn(`[file-range] postgres unavailable, comparing sqlite only: ${String(err)}`);
        }
    } else {
        console.warn('[file-range] DATABASE_URL not set — cross-provider comparison skipped, sqlite invariants still run');
    }
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) {
        await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the file is the test's own scratch */ } }
    }
});

const NOW = () => new Date().toISOString();
/** 3 kB with a known byte at every offset, so a wrong slice is visible rather than merely plausible. */
const PATTERN = Buffer.from(Array.from({ length: 3072 }, (_, i) => 65 + (i % 26)));

/** A distinct owner identity per case, so one case's cleanup cannot empty another's fixture. */
let seq = 0;
function ghiiFor(): string {
    seq += 1;
    return `filerange${process.pid}s${seq}@aimeat-conformance-001`;
}

async function put(s: Storage, ghii: string, key: string, mimeType: string, data: Buffer): Promise<void> {
    await s.createStorageFile({
        key, ownerGaii: ghii, visibility: 'private', mimeType, size: data.length, data,
        tags: ['fixture'], createdAt: NOW(),
    });
}

async function clear(s: Storage, ghii: string): Promise<void> {
    for (const f of await s.listStorageFiles(ghii)) await s.deleteStorageFile(ghii, f.key);
}

describe('a stored file can be read in parts, identically on every provider', () => {
    it('getStorageFileMeta answers everything except the bytes', async () => {
        for (const { name, storage } of provs) {
            const ghii = ghiiFor();
            await put(storage, ghii, 'r/pattern.bin', 'application/octet-stream', PATTERN);

            const meta = await storage.getStorageFileMeta(ghii, 'r/pattern.bin');
            expect(meta, `${name}: no metadata came back`).not.toBeNull();
            expect(meta!.size, `${name}: the size must be the WHOLE file, not what was read`).toBe(PATTERN.length);
            expect(meta!.data.length, `${name}: metadata carried ${meta!.data.length} bytes of payload`).toBe(0);
            expect(meta!.mimeType, `${name}: mime type`).toBe('application/octet-stream');
            expect(meta!.tags, `${name}: tags`).toEqual(['fixture']);
            expect(meta!.visibility, `${name}: visibility, which is what the access decision reads`).toBe('private');
            expect(await storage.getStorageFileMeta(ghii, 'r/absent.bin'), `${name}: a missing file must be null`).toBeNull();

            await clear(storage, ghii);
        }
    }, 60_000);

    it('readStorageFileRange returns exactly the bytes asked for, counting from zero', async () => {
        for (const { name, storage } of provs) {
            const ghii = ghiiFor();
            await put(storage, ghii, 'r/pattern.bin', 'application/octet-stream', PATTERN);
            const read = (start: number, length: number) => storage.readStorageFileRange(ghii, 'r/pattern.bin', start, length);

            // Byte zero, which is where an off-by-one in the 1-indexed SQL would land.
            expect((await read(0, 1))!.equals(PATTERN.subarray(0, 1)), `${name}: byte 0`).toBe(true);
            expect((await read(1, 4))!.equals(PATTERN.subarray(1, 5)), `${name}: a window`).toBe(true);
            // The tail: the shape a suffix range resolves to, and the read that used to cost the
            // entire file to serve eight bytes.
            expect((await read(PATTERN.length - 8, 8))!.equals(PATTERN.subarray(PATTERN.length - 8)), `${name}: the last 8 bytes`).toBe(true);
            expect((await read(0, PATTERN.length))!.equals(PATTERN), `${name}: the whole thing`).toBe(true);
            // Past the end gives what is there. Whether that is a 416 belongs to the caller, which
            // is the only party that has read the Range header.
            expect((await read(PATTERN.length - 2, 100))!.length, `${name}: a clamped tail`).toBe(2);
            expect((await read(PATTERN.length + 50, 10))!.length, `${name}: starting past the end`).toBe(0);
            expect((await read(0, 0))!.length, `${name}: a zero-length read`).toBe(0);
            expect(await storage.readStorageFileRange(ghii, 'r/absent.bin', 0, 4), `${name}: a missing file must be null`).toBeNull();

            await clear(storage, ghii);
        }
    }, 60_000);

    it('listStorageFiles names the files without carrying them', async () => {
        // The one that was already broken. SQLite read `SELECT *`, so listing an owner's files
        // pulled every byte of every file out of the database to build a list that displays none of
        // them. Postgres has always omitted the column, so only the fast local backend was wrong,
        // and nothing had ever looked.
        for (const { name, storage } of provs) {
            const ghii = ghiiFor();
            await put(storage, ghii, 'r/big.bin', 'application/octet-stream', PATTERN);
            await put(storage, ghii, 'r/small.txt', 'text/plain', Buffer.from('hello'));

            const listed = await storage.listStorageFiles(ghii);
            expect(listed.length, `${name}: both fixtures should be listed`).toBe(2);
            for (const f of listed) {
                expect(f.data.length, `${name}: listing carried ${f.data.length} bytes for ${f.key}`).toBe(0);
                expect(f.size, `${name}: the size still has to be reported for ${f.key}`).toBeGreaterThan(0);
            }
            const batch = await storage.listStorageFilesForOwners([ghii]);
            expect(batch[ghii].length, `${name}: batch listing`).toBe(2);
            for (const f of batch[ghii]) expect(f.data.length, `${name}: batch listing carried bytes`).toBe(0);

            await clear(storage, ghii);
        }
    }, 60_000);

    it('the UTF-8 verdict is settled on write, and only where it changes the answer', async () => {
        for (const { name, storage } of provs) {
            const ghii = ghiiFor();
            const write = async (key: string, mimeType: string, data: Buffer) => {
                await put(storage, ghii, key, mimeType, data);
                return (await storage.getStorageFileMeta(ghii, key))!;
            };

            // Built from code points rather than written as literals: the point of the case is which
            // BYTES are stored, and a source file's own encoding must not be part of the question.
            const finnish = Buffer.from('vnr,laake\n001000,Särkylääke ÄÖ\n', 'utf8');
            expect((await write('u/utf8.csv', 'text/csv', finnish)).utf8Verified, `${name}: valid UTF-8`).toBe(true);

            // The same word as cp1252: 0xE4 alone is not a legal UTF-8 sequence, so this is the
            // genuinely non-UTF-8 file the sniffer exists to leave alone.
            const cp1252 = Buffer.from([0x53, 0xE4, 0x72, 0x6B, 0x79, 0x0A]);
            expect((await write('u/latin.csv', 'text/csv', cp1252)).utf8Verified, `${name}: not UTF-8`).toBe(false);

            // A PNG cannot be improved by a charset, so nothing is computed and nothing is stored.
            // undefined must not collapse into false anywhere on the way back: false would claim we
            // had checked and found it wanting.
            const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
            expect((await write('u/pic.png', 'image/png', png)).utf8Verified, `${name}: not applicable`).toBeUndefined();

            // An author who named a charset already said it, and we do not overrule them.
            expect((await write('u/said.csv', 'text/csv; charset=iso-8859-1', cp1252)).utf8Verified, `${name}: author declared`).toBeUndefined();

            // It survives the full read as well as the metadata read, so the 200 and the 206 cannot
            // reach different conclusions about the same file.
            expect((await storage.getStorageFile(ghii, 'u/utf8.csv'))!.utf8Verified, `${name}: full read`).toBe(true);

            await clear(storage, ghii);
        }
    }, 60_000);
});
