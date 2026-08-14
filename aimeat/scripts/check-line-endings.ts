/**
 * @file check-line-endings.ts
 * @description Refuses a staged file whose diff is mostly line-ending churn.
 *
 *   WHY THIS AND NOT .gitattributes. 584 of this repo's 2864 tracked files are CRLF in their
 *   committed blobs, and have been for a long time. Nothing is broken by that: TypeScript, JSON and
 *   the tooling all read either ending. Declaring `eol=lf` would mark those 584 files modified in
 *   every working tree at once — including a parallel session's — to fix something that was not
 *   hurting anyone. The mixed state is not the problem.
 *
 *   The problem is a WRITER that flips a file wholesale. `pathlib.Path.write_text` on Windows
 *   translates every '\n' to '\r\n', so a script that reads a file, edits one line and writes it
 *   back produces a diff where every line changed. That happened on 2026-08-14: a 71-line change
 *   arrived as 1388 insertions and 1319 deletions, and the real change was invisible inside it.
 *   Two earlier commits carry the same churn, one of them 31,000 lines of it, and nobody can review
 *   a diff like that.
 *
 *   So this compares what git says changed against what changed once carriage returns at end of
 *   line are ignored. A large gap between the two is a file that was rewritten rather than edited.
 *   It changes no content and marks nothing modified: it only refuses to record the damage.
 *
 *   A DELIBERATE normalisation (`git add --renormalize`) is a real thing to want, so it has a way
 *   through: AIMEAT_ALLOW_EOL_CHURN=1. It has to be typed, which is the point.
 * @structure churnByFile() → per-file {raw, real} · main(): refuse when churn dominates
 * @usage  pnpm check:line-endings     (pre-commit; reads the INDEX, so it judges what you staged)
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial, after a 71-line change was committed as 2707 changed lines.
 */
import { execFileSync } from 'node:child_process';

/**
 * Churn is only worth refusing once it is big enough to hide a review. Below this, a couple of
 * lines of difference is noise from a mixed-ending file being edited normally.
 */
const MIN_CHURN_LINES = 20;

function numstat(extraArgs: string[]): Map<string, number> {
    const out = execFileSync('git', ['diff', '--cached', '--numstat', ...extraArgs], { encoding: 'utf-8' });
    const byFile = new Map<string, number>();
    for (const line of out.split('\n')) {
        const [add, del, file] = line.split('\t');
        if (!file) continue;
        // '-' in both columns is git's marker for a binary file; it has no lines to compare.
        if (add === '-' || del === '-') continue;
        byFile.set(file, Number(add) + Number(del));
    }
    return byFile;
}

export interface Churn { file: string; raw: number; real: number }

/** Per staged file: lines git reports changed, and lines that changed for a reason. */
export function churnByFile(): Churn[] {
    const raw = numstat([]);
    const real = numstat(['--ignore-cr-at-eol']);
    return [...raw.entries()].map(([file, rawLines]) => ({
        file, raw: rawLines, real: real.get(file) ?? 0,
    }));
}

function main(): void {
    if (process.env.AIMEAT_ALLOW_EOL_CHURN === '1') {
        console.log('  (line-ending churn allowed by AIMEAT_ALLOW_EOL_CHURN=1)');
        return;
    }

    const bad = churnByFile().filter(c => {
        const churn = c.raw - c.real;
        return churn >= MIN_CHURN_LINES && churn > c.real;
    });
    if (bad.length === 0) return;

    console.error('');
    console.error('  Line-ending churn in staged files');
    console.error('  ' + '─'.repeat(62));
    for (const c of bad) {
        console.error(`    ${c.file}`);
        console.error(`      ${c.raw} lines changed, ${c.real} of them for a reason — ${c.raw - c.real} are line endings only`);
    }
    console.error('');
    console.error('  Something rewrote the whole file instead of editing it. On Windows that is');
    console.error('  usually Python: read_text/write_text translate every newline to CRLF. Use the');
    console.error('  editor tool, or read and write BYTES (rb/wb) so endings survive.');
    console.error('');
    console.error('  To restore a file\'s endings and keep your edit:');
    console.error('    python -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b\'\\r\\n\',b\'\\n\'))" <file>');
    console.error('  (that makes it LF — check `git diff --stat` afterwards; a file that was CRLF in');
    console.error('   the repo needs the reverse, and the diff tells you which way is right)');
    console.error('');
    console.error('  A deliberate normalisation passes with AIMEAT_ALLOW_EOL_CHURN=1.');
    console.error('');
    process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-line-endings.ts')) main();
