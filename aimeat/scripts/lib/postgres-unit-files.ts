/**
 * @file scripts/lib/postgres-unit-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The unit files that have a PostgreSQL half: every test/unit/*.test.ts that reads
 *   process.env.DATABASE_URL. Derived from the files, never kept by hand, so CI and `pnpm gate`
 *   cannot drift from the tree: a new two-provider test is in the Postgres run the day it lands.
 *
 *   Until 2026-10-16 the one CI step that set DATABASE_URL named storage-conformance.test.ts alone,
 *   and the PostgreSQL half of the other fifteen ran in no automatic run, among them the regression
 *   tests for two production incidents (QA audit P4-02, F7c-02, F24-01).
 * @usage
 *   import { postgresUnitFiles, honoursRequireFlag } from './lib/postgres-unit-files.js';
 * @version-history
 *   2026-10-16 — Initial (QA audit P4-02, F7c-02, F24-01).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Paths relative to `aimeatDir`, forward slashes, sorted. */
export function postgresUnitFiles(aimeatDir: string): string[] {
    const dir = join(aimeatDir, 'test', 'unit');
    return readdirSync(dir)
        .filter(name => name.endsWith('.test.ts'))
        .filter(name => readFileSync(join(dir, name), 'utf8').includes('process.env.DATABASE_URL'))
        .map(name => `test/unit/${name}`)
        .sort();
}

/** True when the file refuses a missing URL under AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true. */
export function honoursRequireFlag(source: string): boolean {
    return source.includes('requirePostgresWhenAsked(') || source.includes('AIMEAT_CONFORMANCE_REQUIRE_POSTGRES');
}
