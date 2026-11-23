/**
 * @file test/unit/ready-passed.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A step of pnpm ready that was green on a tree is known on the next run of the same
 *   tree and of no other tree, and old records are removed (scripts/lib/ready-passed.ts).
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP_MS, passedStore, prunePassed } from '../../scripts/lib/ready-passed.js';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-ready-passed-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);

describe('passedStore', () => {
    it('knows a step that was green on the same tree, in a store opened later', () => {
        const dir = join(scratch, 'same-tree');
        const first = passedStore(dir, TREE_A, () => Date.parse('2026-11-23T10:00:00Z'));
        expect(first.at('the unit suite')).toBeNull();
        first.add('the unit suite');

        const second = passedStore(dir, TREE_A, () => Date.parse('2026-11-23T10:30:00Z'));
        expect(second.at('the unit suite')).toBe('2026-11-23T10:00:00.000Z');
        expect(second.at('the full E2E sweep on SQLite')).toBeNull();
        second.add('the full E2E sweep on SQLite');
        expect(passedStore(dir, TREE_A).at('the unit suite')).toBe('2026-11-23T10:00:00.000Z');
    });

    it('knows nothing about another tree', () => {
        const dir = join(scratch, 'other-tree');
        passedStore(dir, TREE_A).add('the unit suite');
        expect(passedStore(dir, TREE_B).at('the unit suite')).toBeNull();
    });

    it('reads a record cut short as no record', () => {
        const dir = join(scratch, 'cut-short');
        passedStore(dir, TREE_A).add('the unit suite');
        writeFileSync(join(dir, `passed-${TREE_A}.json`), '{"tree":"aaa","steps":{"the unit su');
        const store = passedStore(dir, TREE_A);
        expect(store.at('the unit suite')).toBeNull();
        store.add('the checks');
        expect(store.at('the checks')).not.toBeNull();
    });

    it('refuses a name that is not a tree id, so no path is built from it', () => {
        expect(() => passedStore(join(scratch, 'bad'), '../../etc')).toThrow(/not a tree id/);
    });
});

describe('prunePassed', () => {
    it('removes a tree record older than the keep time and leaves the rest', () => {
        const dir = join(scratch, 'prune');
        passedStore(dir, TREE_A).add('the unit suite');
        passedStore(dir, TREE_B).add('the unit suite');
        writeFileSync(join(dir, 'notes.txt'), 'not a record');
        const old = (Date.now() - KEEP_MS - 60_000) / 1000;
        utimesSync(join(dir, `passed-${TREE_A}.json`), old, old);
        utimesSync(join(dir, 'notes.txt'), old, old);

        prunePassed(dir);
        expect(readdirSync(dir).sort()).toEqual(['notes.txt', `passed-${TREE_B}.json`]);
    });

    it('does nothing when the directory is not there', () => {
        const dir = join(scratch, 'never-made');
        prunePassed(dir);
        expect(existsSync(dir)).toBe(false);
    });
});
