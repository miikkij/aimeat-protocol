/**
 * @file scripts/check-atomic-writes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for read-then-write without a version condition: a unit of code that reads a
 *   stored record and later writes the same key back unconditionally, so two requests that read the
 *   same version both pass the same check, or the second overwrites the first's change.
 *
 *   WHY IT EXISTS. The version condition is there and it is atomic: `setMemoryIfVersion` and
 *   `createMemoryIfAbsent` in both storage providers, `expectedVersion` on the shared memory write
 *   service, `updateRecord` in services/record-cas.ts, and claims in the pattern of
 *   commerce/session-claim.ts. Nothing made new code use it. The quality round of 2026-10-18 found
 *   sixteen read, check and write code paths in code written after the A04 fix of 2026-09-27, most
 *   of them on money routes; commit 4c9fd43b5 fixed seven of them. This gate is what stops the next
 *   one. Jouni, 2026-10-18: "luulin että tätä varten oli se versiointi tehty jo tukemaan että huomaa
 *   että voiko päivittää jos versio päivittyy välissä, ehkä tätä on parannettava."
 *
 *   WHAT IT READS, AND WHAT IT CANNOT. scripts/inventory/atomic-writes.ts has the detection rule and
 *   its limits. In short: one unit, one key expression, a read through `getMemory` (or a wrapper of
 *   it) and a later unconditional write through `setMemory` / `writeMemoryRecord` (or a wrapper),
 *   with no conditional write of the same key in the unit. A storage transaction is NOT a guard:
 *   on PostgreSQL it runs at READ COMMITTED and the read takes no row lock. A read and a write of
 *   one record through two different key expressions, or split across a function and its caller,
 *   are not seen. A green run is a statement about this pattern, never about the class.
 *
 *   SCOPE. All of src/, minus the shared GATE_SCAN_EXCLUDE and EXCLUDED: new directories are covered
 *   without anyone adding them.
 *
 *   RATCHET, NOT A WALL. security/atomic-write-baseline.json holds the hits of the day it was
 *   seeded, keyed `file:unit|key` (no line number, so an entry keeps covering its code when lines
 *   above it move), each with one line: `Safe: <why it is safe>`, or `DEBT: …` naming the
 *   non-public note that holds the reason. The repository is public, so an open site's line never
 *   says what two requests could gain there (.claude/rules/gates-ratchets.md). A new hit fails the
 *   gate, and so does a listed hit that is gone, until its line is removed. The list only shrinks.
 * @structure EXCLUDED · BASELINE · main(): report, --list, --seed, --strict
 * @usage
 *   cd aimeat && pnpm check:atomic-writes            # the gate (strict)
 *   cd aimeat && pnpm check:atomic-writes:report     # report only
 *   cd aimeat && pnpm exec tsx scripts/check-atomic-writes.ts --list   # every hit with its lines
 * @version-history
 *   v1.0.1 — 2026-10-18 — A DEBT line names where its reason lives, not what the site lets a caller
 *     do; the reasons moved to Platform Development Notes doc-mve1mtynyrma.
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-tarkistus-ei-atomiselle-kirjoitukselle-uudessa-koodissa).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteHits, type AtomicWriteHit } from './inventory/atomic-writes.js';
import { inGateScope, srcProgram } from './inventory/program.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const BASELINE = join(AIMEAT, 'security', 'atomic-write-baseline.json');

/**
 * What is not scanned, and why. Everything else under src/ is.
 * - inventory/program.ts GATE_SCAN_EXCLUDE, the list every scan of src/ shares: unit tests,
 *   generated files, src/static (browser code, which reaches storage only through the routes), src/data.
 * - src/storage/providers, src/storage/adapter: the storage methods themselves, where the
 *   conditional write is implemented (a FOR UPDATE read, then the write, in one transaction).
 */
export const EXCLUDED = /[/\\]src[/\\]storage[/\\](providers|adapter)[/\\]/;
export const scanned = (fileName: string): boolean => inGateScope(fileName) && !EXCLUDED.test(fileName);

interface BaselineFile {
    note: string;
    /** `file:unit|key` → why it is safe, or the wish that fixes it. */
    exempt: Record<string, string>;
}

/** The two shapes a baseline line takes. `DEBT:` is what `pnpm debt` counts as open. */
const REASON = /^(Safe|DEBT): \S/;

export const hitKey =(h: AtomicWriteHit): string => `${h.file}:${h.unit}|${h.key}`;

export function main(): boolean {
    const { program, files } = srcProgram();
    const hits = atomicWriteHits(program, files.filter(f => scanned(f.fileName)), AIMEAT);

    if (process.argv.includes('--list')) {
        for (const h of hits) {
            console.log(`${h.file}:${h.readLine}->${h.writeLine}\t${h.unit}\t${h.key}${h.inTransaction ? '\t[in transaction]' : ''}`);
            console.log(`    ${h.text}`);
        }
        console.log(`\n  ${hits.length} hits in ${new Set(hits.map(h => h.file)).size} files`);
        return true;
    }

    if (process.argv.includes('--seed')) {
        const prior = (() => { try { return JSON.parse(readFileSync(BASELINE, 'utf-8')) as BaselineFile; } catch { return null; } })();
        const file: BaselineFile = {
            note: prior?.note ?? 'Units that read a stored record and later write the same key unconditionally. Each line says why it is safe or which wish fixes it. The list only shrinks: a new hit fails check:atomic-writes.',
            exempt: Object.fromEntries(hits.map(h => [hitKey(h), prior?.exempt[hitKey(h)] ?? 'UNREVIEWED'])),
        };
        writeFileSync(BASELINE, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${hits.length} hits → ${BASELINE}`);
        return true;
    }

    const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as BaselineFile;
    const listed = Object.keys(baseline.exempt);
    const fresh = hits.filter(h => baseline.exempt[hitKey(h)] === undefined);
    const gone = listed.filter(k => !hits.some(h => hitKey(h) === k));
    // Every entry is an answer: `Safe: <the fact that makes it so>`, or `DEBT: …` with a pointer to
    // the non-public note that holds the reason. A bare placeholder would let a new hit in unread.
    const unreasoned = listed.filter(k => !REASON.test(baseline.exempt[k] ?? ''));

    console.log('');
    console.log('  Read, then write the same key, with no version condition');
    console.log('  ' + '─'.repeat(62));
    console.log(`  hits                ${String(hits.length).padStart(3)}   in ${new Set(hits.map(h => h.file)).size} files`);
    console.log(`  of those, in a transaction ${String(hits.filter(h => h.inTransaction).length).padStart(3)}   (not a guard on PostgreSQL)`);
    console.log(`  listed              ${String(listed.length).padStart(3)}`);
    console.log(`  NEW, not listed     ${String(fresh.length).padStart(3)}`);
    console.log('');

    if (unreasoned.length > 0) {
        console.error('✖ A baseline entry needs its one line, "Safe: <why>" or "DEBT: <where the non-public reason is>":');
        for (const k of unreasoned) console.error(`    ${k}`);
        return false;
    }

    if (fresh.length > 0) {
        console.log('  NEW: reads a record and writes the same key back with no version condition:');
        for (const h of fresh) {
            console.log(`    ${h.file}:${h.readLine} → ${h.writeLine}  ${h.unit}  key ${h.key}`);
            console.log(`      ${h.text}`);
        }
        console.log('');
        console.error('✖ Two requests that read the same version both pass the check, or the second');
        console.error('  overwrites the first. Write with a condition: updateRecord() in');
        console.error('  src/services/record-cas.ts, storage.setMemoryIfVersion / createMemoryIfAbsent, or');
        console.error('  writeMemoryRecord with expectedVersion. If the unit is safe without one, add it to');
        console.error('  security/atomic-write-baseline.json with the sentence that says why.');
        return false;
    }

    // A listed hit that is gone fails, as in check:identity-resolution: a line left behind would
    // clear, unread, a new unit that later gets the same name and key.
    if (gone.length > 0) {
        console.error(`✖ ${gone.length} listed hit${gone.length === 1 ? '' : 's'} gone. Remove from security/atomic-write-baseline.json:`);
        for (const k of gone) console.error(`    ${k}`);
        return false;
    }

    console.log(`  ✓ no read-then-write without a version condition, beyond the ${listed.length} listed`);
    return true;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && !main() && process.argv.includes('--strict')) process.exit(1);
