/**
 * @file test/unit/postgres-unit-files.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PostgreSQL half of every two-provider unit file runs automatically: CI's Postgres
 *   job runs scripts/test-unit-postgres.ts, which takes its list from the files themselves, and
 *   every listed file fails when the run asks for PostgreSQL and has no URL.
 *
 *   Before 2026-10-16 CI set DATABASE_URL for storage-conformance.test.ts alone, and the Postgres
 *   half of fifteen other files ran nowhere (QA audit P4-02, F7c-02, F24-01). This test failed on
 *   that tree on both counts: the workflow named one file, and thirteen files ignored the flag.
 * @version-history
 *   2026-10-16 — Initial (QA audit P4-02, F7c-02, F24-01).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { honoursRequireFlag, postgresUnitFiles } from '../../scripts/lib/postgres-unit-files.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

const AIMEAT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

describe('unit files with a PostgreSQL half', () => {
    const files = postgresUnitFiles(AIMEAT);

    it('are found by what they read, storage-conformance among them', () => {
        expect(files).toContain('test/unit/storage-conformance.test.ts');
        expect(files).toContain('test/unit/postgres-connection-loss.test.ts');
        expect(files.length).toBeGreaterThanOrEqual(16);
    });

    it.each(postgresUnitFiles(AIMEAT))('%s refuses a missing URL when the run asks for PostgreSQL', file => {
        expect(honoursRequireFlag(readFileSync(join(AIMEAT, file), 'utf8'))).toBe(true);
    });

    it('run in the CI job that has the Postgres service, with the flag', () => {
        const ci = readFileSync(join(AIMEAT, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
        const job = ci.slice(ci.indexOf('guards-postgres:'));
        expect(job).toContain('pnpm test:unit:postgres');
        expect(job).toMatch(/AIMEAT_CONFORMANCE_REQUIRE_POSTGRES: 'true'/);
    });

    it('the shared rule throws without a URL under the flag, and stays quiet otherwise', () => {
        const saved = { url: process.env.DATABASE_URL, flag: process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES };
        try {
            delete process.env.DATABASE_URL;
            process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES = 'true';
            expect(() => requirePostgresWhenAsked('x')).toThrow(/DATABASE_URL is not set/);
            delete process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES;
            expect(() => requirePostgresWhenAsked('x')).not.toThrow();
        } finally {
            if (saved.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.url;
            if (saved.flag === undefined) delete process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES; else process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES = saved.flag;
        }
    });
});
