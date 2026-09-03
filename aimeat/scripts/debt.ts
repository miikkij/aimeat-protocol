/**
 * @file debt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ratchets, and whether they are moving. A REPORT, never a gate.
 *
 *   WHY IT EXISTS. This repo has ten ratcheted backlogs and each one prints its own number when its
 *   own check runs. What no single check can print is the shape of the whole thing: which numbers
 *   have fallen since they were seeded, and which have been green and still for weeks. Measured on
 *   2026-09-04, two of the three largest had not moved from their seed at all — check:shared-impl
 *   38 -> 38 in twenty-four days, check:denial-coverage 40 -> 40 in twenty — while the gates
 *   reported ✓ on every commit in between. A ratchet only earns its keep if the number falls, and
 *   nothing was asking whether it had.
 *
 *   HOW IT DECIDES "still". Each backlog lives in a committed file, so `git log` on that file is a
 *   record of every value it has ever held. This walks that history, counts the entries at each
 *   revision, and reports the last date the count went DOWN. A file that has only ever grown or
 *   held steady says so, with the number of days.
 *
 *   WHY IT IS NOT A GATE, and this is the deliberate half. A gate keyed to a calendar fails at a
 *   moment nobody chose, and the first thing anyone does with a gate that fails for reasons
 *   unrelated to their change is switch it off. Making the numbers fall is a decision about what to
 *   work on, which is a person's decision. This gives that person the one view nothing else does.
 *   If the answer turns out to be that a report is not enough, the expiry-date design is written up
 *   in docs/internal/quality-plan-2026-09-04.md, stream E, and needs the developer's approval
 *   because it would block his commits.
 * @structure
 *   - RATCHETS: the backlog files, how to count one, and which check prints it
 *   - countAt(): entry count at one git revision
 *   - history(): every (date, count) this file has held, oldest first
 *   - main(): the table
 * @usage cd aimeat && pnpm debt
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (quality plan stream E, the report half).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const REPO = join(ROOT, '..');

interface Ratchet {
    /** Repo-relative, because that is what git wants. */
    file: string;
    label: string;
    check: string;
    /** Entries in this file's backlog, from its raw text. */
    count: (raw: string) => number;
}

/** An `{ note, exempt: { … } }` file: one key per exempted thing. */
const exemptMap = (raw: string): number => Object.keys((JSON.parse(raw) as { exempt?: object }).exempt ?? {}).length;

const RATCHETS: Ratchet[] = [
    { file: 'aimeat/security/route-scope-exemptions.json', label: 'Ungated route handlers', check: 'check:route-scopes', count: exemptMap },
    { file: 'aimeat/security/trusted-key-exemptions.json', label: 'Server-trusted memory keys', check: 'check:trusted-keys', count: exemptMap },
    { file: 'aimeat/security/config-coverage-exemptions.json', label: 'Settings not in the Config tab', check: 'check:config-coverage', count: exemptMap },
    { file: 'aimeat/security/outbound-fetch-exemptions.json', label: 'Bare outbound fetches', check: 'check:outbound-fetch', count: exemptMap },
    { file: 'aimeat/security/denial-coverage-exemptions.json', label: 'Suites with no denial case', check: 'check:denial-coverage', count: exemptMap },
    { file: 'aimeat/security/storage-parity-exemptions.json', label: 'Tables outside the cascades', check: 'check:storage-parity', count: exemptMap },
    {
        file: 'aimeat/eslint-rules/no-storage-in-mcp.js',
        label: 'MCP surfaces reaching storage',
        check: 'check:shared-impl',
        // The EXEMPT set is a literal list of quoted paths; count the lines inside it.
        count: raw => (/const EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(raw)?.[1].match(/^\s*'/gm) ?? []).length,
    },
];

function git(args: string[]): string {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

/** Every (date, count) this file has held, oldest first. A revision that will not parse is skipped. */
function history(r: Ratchet): { date: string; count: number }[] {
    const log = git(['log', '--format=%H %ad', '--date=short', '--', r.file]).trim();
    if (!log) return [];
    const out: { date: string; count: number }[] = [];
    for (const line of log.split('\n').reverse()) {
        const [sha, date] = line.split(' ');
        try {
            out.push({ date, count: r.count(git(['show', `${sha}:${r.file}`])) });
        } catch {
            // A revision from before the file had its current shape. It is not a reading, and the
            // series is more honest without it than with a zero standing in for "unparseable".
            // eslint-disable-next-line no-continue
            continue;
        }
    }
    return out;
}

/** Whole days since a YYYY-MM-DD, floored at 0: a commit dated today in a zone ahead of UTC is 0. */
const daysSince = (iso: string): number =>
    Math.max(0, Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000));

function main(): void {
    console.log('');
    console.log('  The ratchets, and whether they are moving');
    console.log('  ' + '─'.repeat(76));
    console.log(`  ${'backlog'.padEnd(32)}${'now'.padStart(5)}${'first'.padStart(7)}   ${'last fall'.padEnd(14)} check`);
    console.log('  ' + '─'.repeat(76));

    let still = 0;
    for (const r of RATCHETS) {
        if (!existsSync(join(REPO, r.file))) {
            console.log(`  ${r.label.padEnd(32)}${'—'.padStart(5)}  (file is gone)`);
            continue;
        }
        const series = history(r);
        const now = r.count(readFileSync(join(REPO, r.file), 'utf-8'));
        const seed = series[0]?.count ?? now;

        let lastFall = '';
        for (let i = series.length - 1; i > 0; i--) {
            if (series[i].count < series[i - 1].count) { lastFall = series[i].date; break; }
        }
        const fell = lastFall
            ? `${lastFall} (${daysSince(lastFall)}d)`
            : `never (${series.length ? daysSince(series[0].date) : 0}d)`;
        if (!lastFall) still++;

        console.log(`  ${r.label.padEnd(32)}${String(now).padStart(5)}${String(seed).padStart(7)}   ${fell.padEnd(14)} ${r.check}`);
    }

    console.log('  ' + '─'.repeat(76));
    console.log('');
    console.log('  `first` is the count at the file\'s FIRST commit, not the seed a check\'s own text');
    console.log('  quotes: several were reseeded when their scan learned to see more, so a rise here');
    console.log('  can mean the instrument improved rather than the debt grew. And a fall in the total');
    console.log('  is not always debt paid — an entry can go because it was stale or reclassified. Each');
    console.log('  check\'s own output is the authority on what its number means; this is the shape.');
    console.log('');
    if (still) {
        console.log(`  ${still} of ${RATCHETS.length} have never fallen from the number they started at.`);
        console.log('  A ratchet that never falls is a very well documented freeze: the gate reports ✓ on');
        console.log('  every commit, and the thing it is counting is exactly where it was.');
    } else {
        console.log('  Every backlog here has come down at least once since it was seeded.');
    }
    console.log('');
    console.log('  This is a report. It exits 0 whatever it finds, on purpose — see the file header.');
}

main();
