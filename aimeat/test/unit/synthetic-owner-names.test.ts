/**
 * @file test/unit/synthetic-owner-names.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every owner name the server itself writes records under is a name nobody can
 *   register.
 *
 *   The node keeps some of its own records under a made-up account: `system@<node>` holds the
 *   seeded schemas and skills, `security-system@<node>` holds every security incident and every
 *   quarantined upload. Such a name is safe only while no person can sign up with it, because an
 *   account under that name owns the whole namespace: it reads the records as its own memory,
 *   writes rows the operator's screens then trust, and erases everything by deleting itself.
 *   `security-system` was missing from RESERVED_NAMES, and nothing tied that list to the names
 *   the code writes under. This test is the tie: it reads the source for every `name@${…nodeId}`
 *   literal and requires each name to be reserved, so the next synthetic owner cannot be missed.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESERVED_NAMES, validateOwnerName } from '../../src/utils/gaii.js';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** A template literal that starts with a fixed owner name and ends in the node id: `name@${…nodeId}`. */
const SYNTHETIC_OWNER = /`([a-z0-9][a-z0-9-]*[a-z0-9])@\$\{\s*(?:[\w$]+\.)*nodeId\s*\}/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== '__tests__') sourceFiles(full, out);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** Each synthetic owner name in the server source, with where it is written. */
function syntheticOwners(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const file of sourceFiles(SRC)) {
        const source = readFileSync(file, 'utf-8');
        for (const m of source.matchAll(SYNTHETIC_OWNER)) {
            const line = source.slice(0, m.index).split('\n').length;
            const at = `${relative(SRC, file).replace(/\\/g, '/')}:${line}`;
            found.set(m[1], [...(found.get(m[1]) ?? []), at]);
        }
    }
    return found;
}

describe('the owner names the server writes under', () => {
    const found = syntheticOwners();

    it('are found in the source', () => {
        // A scan that finds nothing proves nothing. These are written in several places each.
        for (const name of ['system', 'security-system', 'node']) {
            expect(found.has(name), `${name} was not found; the scan is broken`).toBe(true);
        }
    });

    it('are all reserved', () => {
        const open = [...found]
            .filter(([name]) => !RESERVED_NAMES.has(name))
            .map(([name, at]) => `${name} (${at.join(', ')})`);
        expect(open).toEqual([]);
    });

    it('are refused at registration', () => {
        for (const name of found.keys()) {
            expect(validateOwnerName(name), name).not.toBeNull();
        }
    });
});
