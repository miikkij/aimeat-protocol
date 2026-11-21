/**
 * @file test/unit/unknown-env.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node names at start an AIMEAT_* variable that does nothing: a CLI flag name used as
 *   a variable that disagrees with the storage the node opened, and a name nothing in the repository
 *   reads (src/config/unknown-env.ts; docs/pitfalls.md §23 until 2026-11-21).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { envWarnings } from '../../src/config/unknown-env.js';
import { KNOWN_ENV_NAMES } from '../../src/config/known-env-names.js';

// Built from pieces, so check:env-names does not read these made-up names as names the repository uses.
const TYPO = 'AIMEAT_' + 'PROT';
const KV = 'AIMEAT_SITE_KV_' + 'HELLO';
const sqlite = { storageProvider: 'sqlite', sqlitePath: '/tmp/scratch.db' };
const postgres = { storageProvider: 'postgres-kysely', sqlitePath: '' };

describe('start-time warnings about AIMEAT_* variables', () => {
    it('names AIMEAT_DB and AIMEAT_DB_PATH when the node opened something else', () => {
        const w = envWarnings({ AIMEAT_DB: 'sqlite', AIMEAT_DB_PATH: '/tmp/scratch.db' }, postgres);
        expect(w).toHaveLength(2);
        expect(w[0]).toContain('AIMEAT_DB=sqlite');
        expect(w[0]).toContain('postgres-kysely');
        expect(w[1]).toContain('AIMEAT_STORAGE=sqlite and AIMEAT_SQLITE_PATH');
    });
    it('says nothing when the flag-shaped names agree with what the node uses (the E2E runner sets them so)', () => {
        expect(envWarnings({ AIMEAT_DB: 'sqlite', AIMEAT_DB_PATH: '/tmp/scratch.db', AIMEAT_STORAGE: 'sqlite' }, sqlite)).toEqual([]);
    });
    it('names a variable nothing reads, and not one the repository knows or a read prefix', () => {
        const w = envWarnings({ [TYPO]: '40050', AIMEAT_PORT: '40050', [KV]: 'x', PATH: '/bin' }, sqlite);
        expect(w).toEqual([expect.stringContaining(`${TYPO} is set, and nothing in this node reads it`)]);
    });
    it('the generated list knows the settings the node reads', () => {
        for (const n of ['AIMEAT_PORT', 'AIMEAT_STORAGE', 'AIMEAT_SQLITE_PATH', 'AIMEAT_NODE_ID']) expect(KNOWN_ENV_NAMES.has(n)).toBe(true);
        expect(KNOWN_ENV_NAMES.has(TYPO)).toBe(false);
    });
});
