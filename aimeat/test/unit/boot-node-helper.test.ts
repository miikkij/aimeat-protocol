/**
 * @file test/unit/boot-node-helper.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A test file that boots an AIMEAT node in-process goes through test/helpers/boot-node.ts,
 *   which mints earlier tokens again after a later boot (docs/pitfalls.md §45 until 2026-11-21). The
 *   files that had their own boot on that day are listed in security/boot-node-baseline.json; none may
 *   join, and one that stops booting its own node leaves the list.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const HELPER = 'test/helpers/boot-node.ts';

/** Does this text boot the node itself: an import of createServer from src/server? */
function bootsOwnNode(text: string): boolean {
    return /import\s*\{[^}]*\bcreateServer\b[^}]*\}\s*from\s*'(?:\.\.\/)+src\/server(?:\.js)?'/.test(text);
}

function testFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'fixtures') testFiles(p, out); }
        else if (name.endsWith('.ts')) out.push(p);
    }
    return out;
}

const baseline = new Set((JSON.parse(readFileSync(join(AIMEAT, 'security', 'boot-node-baseline.json'), 'utf8')) as { files: string[] }).files);
const booting = testFiles(join(AIMEAT, 'test'))
    .map(f => relative(AIMEAT, f).split('\\').join('/'))
    .filter(f => f !== HELPER && bootsOwnNode(readFileSync(join(AIMEAT, f), 'utf8')));

describe('an in-process node boots through test/helpers/boot-node.ts', () => {
    it('reads a createServer import from src/server, and nothing else, as a boot', () => {
        // Built from pieces, so this file does not read as a boot itself.
        const from = (up: string) => `from '${up}src/` + "server.js';";
        expect(bootsOwnNode(`import { createServer } ${from('../')}`)).toBe(true);
        expect(bootsOwnNode(`import { createServer, x } ${from('../../')}`)).toBe(true);
        // node:http's createServer is a stub server, not a node.
        expect(bootsOwnNode("import { createServer } from 'node:http';")).toBe(false);
        expect(bootsOwnNode("import { bootNode } from './helpers/boot-node.js';")).toBe(false);
    });
    it('no test file outside the baseline boots its own node', () => {
        expect(booting.filter(f => !baseline.has(f)),
            'boot the node with bootNode() from test/helpers/boot-node.ts, which re-mints earlier tokens after a later boot').toEqual([]);
    });
    it('the baseline names only files that still boot their own node', () => {
        expect([...baseline].filter(f => !booting.includes(f)),
            'this file no longer boots its own node: take it off security/boot-node-baseline.json').toEqual([]);
    });
    it('found the files it is about (the scan is not empty)', () => {
        expect(booting.length).toBeGreaterThan(10);
    });
});
