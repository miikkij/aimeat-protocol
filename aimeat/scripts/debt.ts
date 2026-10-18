/**
 * @file debt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ratchets, and whether they are moving. A REPORT, never a gate.
 *
 *   WHY IT EXISTS. Every ratcheted backlog under aimeat/security/ (and the one list kept in an
 *   ESLint rule) prints its own number when its own check runs. What no single check can print is
 *   the shape of the whole thing: which numbers have fallen since they were seeded, which have been
 *   green and still for weeks, and how many entries are still questions nobody has answered.
 *   Measured on 2026-09-04, two of the three largest had not moved from their seed at all —
 *   check:shared-impl 38 -> 38 in twenty-four days, check:denial-coverage 40 -> 40 in twenty — while
 *   the gates reported ✓ on every commit in between. A ratchet only earns its keep if the number
 *   falls, and nothing was asking whether it had.
 *
 *   THREE NUMBERS PER BACKLOG, because an entry count alone says nothing about the work left
 *   (QA audit 2026-10, P3-07: the report printed 170 for the route-scope file, which had no open
 *   question in it, and left out field-reach, where 409 of 462 entries were open).
 *   - `now`: entries in the file.
 *   - `open`: entries that are still a QUESTION, i.e. carry the placeholder the seeding wrote
 *     (`SEEDED`, `Seeded backlog`, `UNREVIEWED`, `NOT YET REVIEWED`, `DEBT`, verdict `untriaged`,
 *     decision `required`). For a baseline whose header says every entry is recorded debt, every
 *     entry is open. `—` means the file has no placeholder: each entry is an answer.
 *   - `due`: answers whose `[triaged YYYY-MM-DD]` stamp (or `verifiedOn` date) runs past the file's
 *     maxAgeDays within the next 30 days, overdue ones included. Those make their gate fail on the
 *     day they expire, so this column is the warning a month ahead.
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
 *   - RATCHETS: the backlog files, how to count entries, open questions and due answers in one
 *   - countAt(): entry count at one git revision
 *   - history(): every (date, count) this file has held, oldest first
 *   - main(): the table
 * @usage cd aimeat && pnpm debt
 * @version-history
 *   2026-10-18 — The reads followed by an unconditional write of the same key join the report
 *     (wish wish-tarkistus-ei-atomiselle-kirjoitukselle-uudessa-koodissa).
 *   2026-10-18 — The pairs written twice join the report: offer and signal fields the Python builders
 *     lack, the Python daemon's differences from aimeat connect, and the browser library routes called
 *     with different parameters (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 *   2026-10-16 — The catalog MCP tools no E2E suite calls, the suites whose only refusal is an
 *     anonymous 401 and the authenticated routes no suite refuses join the report (QA audit W27, W29, P3-08).
 *   v1.5.0 — 2026-10-16 — Every backlog file under security/ is on the report (thirteen joined:
 *     field-reach, storage-owner-relations, protocol-versions, classification-reach,
 *     identity-resolution, owner-principal, open-writes, scope-parity, peer-paths, locale-jargon,
 *     plain-language, mcp-schema-single-source, connector-own-handlers), and each row prints its
 *     open questions and the answers due within 30 days beside the entry count (QA audit P3-07).
 *   v1.4.0 — 2026-10-12 — The node MCP tools that `aimeat connect serve` does not offer join the report.
 *   v1.3.0 — 2026-10-05 — The single-entry ceilings join the report (secaudit 2026-10, C1, C2, C7).
 *   v1.2.0 — 2026-09-13 — The substitute-answering catches join the report. Their file is keyed by
 *     file with a per-file ceiling rather than one key per site, so the count is the sum of the
 *     ceilings and falls only when a handler is fixed AND its ceiling lowered.
 *   v1.1.0 -- 2026-09-13 -- Count copied poster shapes and their last fall.
 *   v1.0.0 — 2026-09-04 — Initial (quality plan stream E, the report half).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TRIAGE_STAMP } from './inventory/triage-clock.js';

const ROOT = process.cwd();
const REPO = join(ROOT, '..');

/** How far ahead the `due` column looks. */
const DUE_WINDOW_DAYS = 30;

interface Ratchet {
    /** Repo-relative, because that is what git wants. */
    file: string;
    label: string;
    check: string;
    /** Entries in this file's backlog, from its raw text. */
    count: (raw: string) => number;
    /** Entries still carrying the placeholder; absent when the file has none. */
    open?: (raw: string) => number;
    /** Answers whose triage date runs out within DUE_WINDOW_DAYS; absent when the file has no clock. */
    due?: (raw: string) => number;
}

type Json = Record<string, unknown>;
const parse = (raw: string): Json => JSON.parse(raw) as Json;

/**
 * The placeholders the seeding scripts write, one per file family: `SEEDED …` (identity-resolution,
 * owner-principal, open-writes, silent-catch), `Seeded …` (route-scope, outbound-fetch,
 * denial-coverage, storage-parity, scope-parity, classification-reach, config-coverage),
 * `UNREVIEWED` (trusted-keys, single-entry, peer-paths), `NOT YET REVIEWED` (field-reach) and
 * `DEBT` (route-scope's named holes). Anchored at the start: an answer that QUOTES its old
 * placeholder ("Previously reviewed as: Seeded …") is an answer.
 */
const PLACEHOLDER = /^\s*(SEEDED|Seeded|UNREVIEWED|NOT YET REVIEWED|DEBT\b)/;
const isOpen = (text: unknown): boolean => typeof text === 'string' && PLACEHOLDER.test(text);

/** An `{ note, exempt: { … } }` file: one key per exempted thing. */
const exemptValues = (raw: string): unknown[] => Object.values((parse(raw).exempt ?? {}) as Json);
const exemptMap = (raw: string): number => exemptValues(raw).length;
/** The reason text of an exempt entry: a string, or `{ reason }` (denial-coverage). */
const reasonOf = (v: unknown): unknown => (v && typeof v === 'object' ? (v as Json).reason : v);
const exemptOpen = (raw: string): number => exemptValues(raw).filter(v => isOpen(reasonOf(v))).length;

/** Whole days since a YYYY-MM-DD, floored at 0: a commit dated today in a zone ahead of UTC is 0. */
const daysSince = (iso: string): number =>
    Math.max(0, Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000));

/** Is an answer dated `day` within the window of expiring under `maxAgeDays`, or past it? */
const isDue = (day: string, maxAgeDays: number): boolean => daysSince(day) > maxAgeDays - DUE_WINDOW_DAYS;

/** The `[triaged YYYY-MM-DD]` clock over an exempt map (the three files triage-clock.ts reads). */
const stampedDue = (raw: string): number => {
    const j = parse(raw);
    const maxAge = typeof j.maxAgeDays === 'number' ? j.maxAgeDays : 90;
    return exemptValues(raw).filter(v => {
        if (typeof v !== 'string' || v.startsWith('SEEDED')) return false;
        const m = TRIAGE_STAMP.exec(v);
        return m ? isDue(m[1], maxAge) : true;   // an undated answer already fails its gate
    }).length;
};

/** A `{ files: { path: { kind: n } } }` baseline: the backlog is the sum of the counts. */
const nestedCounts = (raw: string): number => Object.values((parse(raw).files ?? {}) as Record<string, Record<string, number>>)
    .reduce((total, counts) => total + Object.values(counts).reduce((sum, n) => sum + n, 0), 0);

/** single-entry: per rule, per file, `{ count, why }`. */
const singleEntryRows = (raw: string): { count: number; why?: string }[] =>
    Object.values((parse(raw).rules ?? {}) as Record<string, Record<string, { count: number; why?: string }>>)
        .flatMap(files => Object.values(files));

/** peer-paths: writers and readers, each `{ path: { count, why } }`. */
const peerRows = (raw: string): { count: number; why?: string }[] => {
    const j = parse(raw) as { writers?: Json; readers?: Json };
    return [...Object.values(j.writers ?? {}), ...Object.values(j.readers ?? {})] as { count: number; why?: string }[];
};

interface Protocol { verdict: string; verifiedOn: string | null }
const protocols = (raw: string): Protocol[] => (parse(raw).protocols ?? []) as Protocol[];

/** A list that only shrinks and whose every entry is the thing being counted down. */
const listLength = (key: string) => (raw: string): number => {
    const v = parse(raw)[key];
    return Array.isArray(v) ? v.length : 0;
};

const RATCHETS: Ratchet[] = [
    // Baselines whose header says every entry is recorded debt: open = now.
    { file: 'aimeat/security/poster-shapes-baseline.json', label: 'Design-language shapes in view sheets', check: 'check:poster-shapes', count: nestedCounts, open: nestedCounts },
    { file: 'aimeat/security/shape-tokens-baseline.json', label: 'Shape literals with a theme value', check: 'check:shape-tokens', count: nestedCounts, open: nestedCounts },
    // Exempt maps with answers and placeholders.
    { file: 'aimeat/security/route-scope-exemptions.json', label: 'Ungated route handlers', check: 'check:route-scopes', count: exemptMap, open: exemptOpen, due: stampedDue },
    { file: 'aimeat/security/identity-resolution-exemptions.json', label: 'Token subjects never resolved', check: 'check:identity-resolution', count: exemptMap, open: exemptOpen, due: stampedDue },
    { file: 'aimeat/security/owner-principal-exemptions.json', label: 'Refusals on the owner name', check: 'check:owner-principal', count: exemptMap, open: exemptOpen, due: stampedDue },
    { file: 'aimeat/security/open-write-exemptions.json', label: 'Writes admitting no credential', check: 'check:open-writes', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/atomic-write-baseline.json', label: 'Reads written back unversioned', check: 'check:atomic-writes', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/trusted-key-exemptions.json', label: 'Server-trusted memory keys', check: 'check:trusted-keys', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/config-coverage-exemptions.json', label: 'Settings not in the Config tab', check: 'check:config-coverage', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/outbound-fetch-exemptions.json', label: 'Bare outbound fetches', check: 'check:outbound-fetch', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/denial-coverage-exemptions.json', label: 'Suites with no denial case', check: 'check:denial-coverage', count: exemptMap, open: exemptOpen },
    {
        file: 'aimeat/security/denial-coverage-exemptions.json',
        label: 'Suites whose only refusal is an anonymous 401',
        check: 'check:denial-coverage',
        count: raw => Object.keys((parse(raw).anonymous_only ?? {}) as Json).length,
        open: raw => Object.values((parse(raw).anonymous_only ?? {}) as Json).filter(v => isOpen(reasonOf(v))).length,
    },
    { file: 'aimeat/security/route-refusal-exemptions.json', label: 'Authenticated routes no suite refuses', check: 'check:denial-coverage', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/storage-parity-exemptions.json', label: 'Tables outside the cascades', check: 'check:storage-parity', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/scope-parity-exemptions.json', label: 'Permission words on one side', check: 'check:scope-parity', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/field-reach-exemptions.json', label: 'REST reads with no agent twin', check: 'check:field-reach', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/connect-serve-parity-exemptions.json', label: 'MCP tools not on connect serve', check: 'check:mcp-tools', count: exemptMap },
    { file: 'aimeat/security/mcp-uncalled-tools.json', label: 'MCP tools no E2E suite calls', check: 'check:mcp-test-calls', count: exemptMap },
    // Wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille (2026-10-18): the pairs
    // written twice. The browser libraries' row is a report (audit:browser-libs), never a gate.
    { file: 'aimeat/security/python-shape-parity.json', label: 'Offer and signal fields Python lacks', check: 'check:python-shapes', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/python-daemon-parity.json', label: 'Python daemon vs connector', check: 'check:python-daemon', count: exemptMap, open: exemptOpen },
    { file: 'aimeat/security/browser-lib-routes.json', label: 'Browser libs, parameters differ', check: 'audit:browser-libs', count: raw => Object.keys((parse(raw).differences ?? {}) as Json).length },
    {
        file: 'aimeat/security/storage-owner-relations.json',
        label: 'Identity columns, policy open',
        check: 'check:storage-parity',
        count: raw => Object.keys((parse(raw).relations ?? {}) as Json).length,
        // An open question here is a relation whose policy decision is still `required`.
        open: raw => Object.values((parse(raw).relations ?? {}) as Record<string, { decision?: string }>)
            .filter(r => r.decision === 'required').length,
    },
    {
        file: 'aimeat/security/protocol-versions.json',
        label: 'External protocol versions',
        check: 'check:protocol-versions',
        count: raw => protocols(raw).length,
        open: raw => protocols(raw).filter(p => p.verdict === 'untriaged').length,
        due: raw => {
            const maxAge = typeof parse(raw).maxAgeDays === 'number' ? parse(raw).maxAgeDays as number : 90;
            return protocols(raw).filter(p => p.verdict !== 'untriaged' && (!p.verifiedOn || isDue(p.verifiedOn, maxAge))).length;
        },
    },
    {
        file: 'aimeat/security/classification-reach.json',
        label: 'Files reading content',
        check: 'check:classification-reach',
        count: raw => Object.keys((parse(raw).files ?? {}) as Json).length,
        open: raw => Object.values((parse(raw).files ?? {}) as Record<string, { why?: string }>).filter(f => isOpen(f.why)).length,
    },
    {
        file: 'aimeat/security/peer-paths.json',
        label: 'Files writing or trusting peers',
        check: 'check:peer-paths',
        count: raw => peerRows(raw).length,
        open: raw => peerRows(raw).filter(r => isOpen(r.why)).length,
    },
    {
        file: 'aimeat/security/silent-catch-substitutes.json',
        label: 'Catches answering a substitute',
        check: 'check:silent-catch',
        // Keyed by FILE with a per-file ceiling, not one key per site: a catch handler has no stable
        // name. The backlog is the sum of the ceilings, so it falls when a handler is fixed AND the
        // count is lowered. `open` is the number of FILES still carrying the seed placeholder.
        count: raw => Object.values((parse(raw).files ?? {}) as Record<string, { count: number }>)
            .reduce((n, e) => n + e.count, 0),
        open: raw => Object.values((parse(raw).files ?? {}) as Record<string, { reason?: string }>)
            .filter(e => isOpen(e.reason)).length,
    },
    {
        file: 'aimeat/security/single-entry-baseline.json',
        label: 'Hand copies of a single decision',
        check: 'check:single-entry',
        // Per rule, per file, a ceiling: the backlog is the sum of the ceilings; `open` counts the
        // (rule, file) rows still carrying UNREVIEWED.
        count: raw => singleEntryRows(raw).reduce((n, e) => n + e.count, 0),
        open: raw => singleEntryRows(raw).filter(e => isOpen(e.why)).length,
    },
    // Lists whose every entry is recorded debt: open = now.
    { file: 'aimeat/security/locale-jargon-baseline.json', label: 'Strings saying "node" to a person', check: 'check:locales', count: raw => (JSON.parse(raw) as unknown[]).length, open: raw => (JSON.parse(raw) as unknown[]).length },
    { file: 'aimeat/security/plain-language-baseline.json', label: 'Messages not in plain language', check: 'check:plain-language', count: listLength('messages'), open: listLength('messages') },
    { file: 'aimeat/security/mcp-schema-single-source.json', label: 'MCP schemas written by hand', check: 'check:mcp-schemas', count: listLength('tools'), open: listLength('tools') },
    { file: 'aimeat/security/connector-own-handlers.json', label: 'Connector handlers off dispatch', check: 'check:mcp-schemas', count: listLength('tools'), open: listLength('tools') },
    {
        file: 'aimeat/eslint-rules/no-storage-in-mcp.js',
        label: 'MCP surfaces reaching storage',
        check: 'check:shared-impl',
        // The EXEMPT set is a literal list of quoted paths; count the lines inside it. Every line is
        // a file waiting for its conversion, so open = now.
        count: raw => (/const EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(raw)?.[1].match(/^\s*'/gm) ?? []).length,
        open: raw => (/const EXEMPT = new Set\(\[([\s\S]*?)\]\)/.exec(raw)?.[1].match(/^\s*'/gm) ?? []).length,
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

const W = 104;

function main(): void {
    console.log('');
    console.log('  The ratchets, and whether they are moving');
    console.log('  ' + '─'.repeat(W));
    console.log(`  ${'backlog'.padEnd(36)}${'now'.padStart(5)}${'open'.padStart(6)}${'due'.padStart(5)}${'first'.padStart(7)}   ${'last fall'.padEnd(17)} check`);
    console.log('  ' + '─'.repeat(W));

    let still = 0;
    let openTotal = 0;
    let dueTotal = 0;
    for (const r of RATCHETS) {
        if (!existsSync(join(REPO, r.file))) {
            console.log(`  ${r.label.padEnd(36)}${'—'.padStart(5)}  (file is gone)`);
            continue;
        }
        const series = history(r);
        const raw = readFileSync(join(REPO, r.file), 'utf-8');
        const now = r.count(raw);
        const open = r.open ? r.open(raw) : null;
        const due = r.due ? r.due(raw) : null;
        openTotal += open ?? 0;
        dueTotal += due ?? 0;
        const seed = series[0]?.count ?? now;

        let lastFall = '';
        for (let i = series.length - 1; i > 0; i--) {
            if (series[i].count < series[i - 1].count) { lastFall = series[i].date; break; }
        }
        const fell = lastFall
            ? `${lastFall} (${daysSince(lastFall)}d)`
            : `never (${series.length ? daysSince(series[0].date) : 0}d)`;
        if (!lastFall) still++;

        const cell = (n: number | null, w: number): string => (n === null ? '—' : String(n)).padStart(w);
        console.log(`  ${r.label.padEnd(36)}${String(now).padStart(5)}${cell(open, 6)}${cell(due, 5)}${String(seed).padStart(7)}   ${fell.padEnd(17)} ${r.check}`);
    }

    console.log('  ' + '─'.repeat(W));
    console.log(`  ${'open questions, all backlogs'.padEnd(36)}${''.padStart(5)}${String(openTotal).padStart(6)}${String(dueTotal).padStart(5)}`);
    console.log('');
    console.log('  `now` counts entries. `open` counts the entries that are still a question: they carry the');
    console.log('  placeholder the seeding wrote (SEEDED, Seeded backlog, UNREVIEWED, NOT YET REVIEWED, DEBT,');
    console.log('  verdict untriaged, decision required), or the file\'s header says every entry is recorded');
    console.log('  debt. `—` means the file has no placeholder: every entry is a written answer.');
    console.log(`  \`due\` counts answers whose triage date runs past the file's maxAgeDays within ${DUE_WINDOW_DAYS} days,`);
    console.log('  overdue ones included: their gate fails on that day until somebody re-reads the code.');
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
