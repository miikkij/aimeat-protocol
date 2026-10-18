/**
 * @file scripts/lib/e2e-github-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The red suites of an E2E run, written where GitHub shows them to a reader who is not
 *   signed in: check-run annotations (workflow `::error` commands) and the job summary.
 *
 *   WHY. The nightly sweep (.github/workflows/e2e-full.yml) was red every night from 2026-10-12 to
 *   2026-10-16 and its issue said only "still red" with a run link. GitHub serves a job's log only to
 *   a signed-in reader, so the names of the red suites were out of reach of every session that works
 *   without a GitHub token, which is all of them: the public annotations of a red night carried
 *   nothing but "Process completed with exit code 1". An annotation is readable anonymously through
 *   GET /repos/{owner}/{repo}/check-runs/{job id}/annotations, and the workflow's issue job copies
 *   these annotations into the issue comment.
 *
 *   LIMITS. GitHub keeps at most 10 error annotations per step, so the first annotation names every
 *   red suite and at most eight more carry one red suite each with its first failed tests. The
 *   suites past the eighth get one line each in the first annotation, after the names.
 *
 *   A READER DEPENDS ON THESE SHAPES. Lifecycle Central's `ci_sweep_ingest` (aimeat-apps,
 *   lifecycle-central/extension/scripts/ci_sweep_ingest.js) reads the nightly sweep's annotations
 *   anonymously and opens one incident per red suite: it matches the titles
 *   "<n> red E2E suite(s) on <backend>" and "E2E <suite> on <backend>", takes the first line of the
 *   list annotation as the comma-separated names and each later line as "<suite>: <detail>", and
 *   reads a red leg with no list annotation as a run that did not finish. A change to those shapes
 *   changes that action in the same piece of work.
 * @structure failedTestLines() · githubAnnotations() · githubSummary()
 * @version-history
 *   v1.1.1 -- 2026-10-19 -- A summary table cell escapes backslash before the pipe, so a backslash in a note cannot unescape it (CodeQL 1750).
 *   v1.1.0 -- 2026-10-18 -- The list annotation carries a line per suite past the eighth, and the
 *     header names the reader (wish-lifecycle-central-y-ajon-punainen-sarja-h-iri-ksi-commit-v-l).
 *   v1.0.0 -- 2026-10-16 -- Initial: the nightly sweep names its red suites in public.
 */

/** One red suite as the report names it. */
export interface RedSuite {
    name: string;
    passed: number;
    total: number;
    /** The verdict's note (TIMED OUT, DID NOT RUN, ...), empty for a plain failure. */
    note: string;
    /** The first lines of the suite's output that report a failed test. */
    failures: string[];
}

/** How many red suites get an annotation of their own, after the one that lists them all. */
const PER_SUITE_ANNOTATIONS = 8;
const MAX_FAILED_LINES = 5;
const MAX_LINE_CHARS = 300;

/** The lines of a suite's output that report a failed test (they start with ❌), at most five. */
export function failedTestLines(output: string): string[] {
    return output.split('\n')
        .filter(l => /^\s*❌/.test(l))
        .slice(0, MAX_FAILED_LINES)
        .map(l => l.trim().slice(0, MAX_LINE_CHARS));
}

/** A workflow command's message: GitHub reads %, CR and LF as escapes there. */
function escapeData(s: string): string {
    return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** A workflow command's property value, where `:` and `,` also end the value. */
function escapeProperty(s: string): string {
    return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function describeSuite(r: RedSuite): string {
    const head = `${r.passed}/${r.total} passed${r.note ? `; ${r.note}` : ''}`;
    return [head, ...r.failures].join('\n');
}

/**
 * The `::error` workflow commands for a run's red suites, on `backend`. Nothing for a green run.
 */
export function githubAnnotations(red: RedSuite[], backend: string): string[] {
    if (red.length === 0) return [];
    // The suites past the eighth have no annotation of their own, so the list annotation carries
    // one line for each of them after the names: "<suite>: <passed>/<total> passed[; note][ · first
    // failure]". A night with eleven red suites otherwise named three of them with no failure at all.
    const rest = red.slice(PER_SUITE_ANNOTATIONS).map(r => {
        const head = `${r.passed}/${r.total} passed${r.note ? `; ${r.note}` : ''}`;
        return `${r.name}: ${r.failures[0] ? `${head} · ${r.failures[0]}` : head}`;
    });
    const listMessage = [red.map(r => r.name).join(', '), ...rest].join('\n');
    const lines = [`::error title=${escapeProperty(`${red.length} red E2E suite(s) on ${backend}`)}::${escapeData(listMessage)}`];
    for (const r of red.slice(0, PER_SUITE_ANNOTATIONS)) {
        lines.push(`::error title=${escapeProperty(`E2E ${r.name} on ${backend}`)}::${escapeData(describeSuite(r))}`);
    }
    return lines;
}

/** Markdown for the job summary ($GITHUB_STEP_SUMMARY): one row per red suite, every one of them. */
export function githubSummary(red: RedSuite[], backend: string, totals: { passed: number; failed: number; total: number }): string {
    const head = `### E2E on ${backend}: ${totals.passed} passed, ${totals.failed} failed out of ${totals.total}\n\n`;
    if (red.length === 0) return `${head}Every suite is green.\n`;
    // Backslash first: a `\` already in the note before a `|` would pair with the escape added for
    // the pipe (`\\|`), and the pipe would split the table cell.
    const cell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    const rows = red.map(r => `| ${r.name} | ${r.passed}/${r.total} | ${cell(r.note)} | ${cell(r.failures.join('\n'))} |`);
    return `${head}| Red suite | Passed | Note | First failed tests |\n|---|---|---|---|\n${rows.join('\n')}\n`;
}
