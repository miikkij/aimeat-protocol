/**
 * @file test/unit/check-outbound-fetch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proof that `pnpm check:outbound-fetch` reports the two things the 2026-10 QA audit
 *   (P3-04) found it could not see: an exemption that matches no call site any more, and a second
 *   identical line in a file whose first copy is exempted. The scanner reads files from a temp
 *   directory, never the repository's own src/.
 *
 *   FAIL-FIRST: the v1.1.0 script compared findings against the exemption keys in one direction
 *   only (fresh = finding without an entry) and keyed every copy of a line with the same key, so
 *   against these fixtures it reported nothing in both cases: ten dead entries stood in the real
 *   file for weeks with the gate green.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-outbound-fetch.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit P3-04).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFetches, compareExemptions, keyFindings } from '../../scripts/check-outbound-fetch.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'outbound-fetch-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function scan(source: string): ReturnType<typeof collectFetches> {
    const file = join(dir, 'probe.ts');
    writeFileSync(file, source, 'utf8');
    return collectFetches([file]);
}

describe('check:outbound-fetch exemptions', () => {
    it('reports an entry that matches no call site as stale', () => {
        const findings = scan('export async function a(u: string) {\n  return safeFetch(u);\n}\n');
        expect(findings).toHaveLength(0);
        const { fresh, stale } = compareExemptions(findings, {
            'src/services/gone.ts:const resp = await fetch(`${baseUrl}/chat/completions`, {': 'moved to safeFetch',
        });
        expect(fresh).toHaveLength(0);
        expect(stale).toEqual(['src/services/gone.ts:const resp = await fetch(`${baseUrl}/chat/completions`, {']);
    });

    it('keeps an entry that still matches its call site', () => {
        const findings = scan('export async function a(u: string) {\n  const res = await fetch(u, {});\n}\n');
        const [only] = keyFindings(findings);
        const { fresh, stale } = compareExemptions(findings, { [only.key]: 'reviewed' });
        expect(fresh).toHaveLength(0);
        expect(stale).toHaveLength(0);
    });

    it('treats a second identical line in the same file as a new finding with its own key', () => {
        const findings = scan([
            'export async function a(u: string) {',
            '  const res = await fetch(u, {});',
            '}',
            'export async function b(u: string) {',
            '  const res = await fetch(u, {});',
            '}',
        ].join('\n'));
        const keyed = keyFindings(findings);
        expect(keyed).toHaveLength(2);
        expect(keyed[1].key).toBe(`${keyed[0].key} #2`);

        const { fresh } = compareExemptions(findings, { [keyed[0].key]: 'reviewed for the first call only' });
        expect(fresh.map(f => f.line)).toEqual([5]);

        const both = compareExemptions(findings, { [keyed[0].key]: 'first', [keyed[1].key]: 'second' });
        expect(both.fresh).toHaveLength(0);
        expect(both.stale).toHaveLength(0);
    });
});
