/**
 * @file check-commit-msg.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Guard for the commit MESSAGE, run from the `commit-msg` hook.
 *
 *   WHY THIS EXISTS. On 2026-08-13 three commits landed on main whose subject line was the single
 *   character `@`, with the real subject pushed down to line two. The cause is worth stating plainly,
 *   because it will happen again and it is invisible until someone looks at `git log --oneline`:
 *
 *     git commit -m @'
 *     feat(agents): …
 *     '@
 *
 *   That is PowerShell here-string syntax. This repo has two shells — PowerShell is the primary one
 *   on Windows and Bash is beside it — and in Bash `@'` is not syntax, it is the character `@`
 *   followed by a quote. The shell dutifully passed a message that begins and ends with `@`. Nothing
 *   was malformed enough to fail: git accepted it, the pre-commit hook passed, the push worked, and
 *   the damage was a history where three commits are titled `@`.
 *
 *   The durable answer is not "remember which shell you are in". It is to stop routing multi-line
 *   text through a shell at all (scripts/git-commit.sh writes a file and uses `git commit -F`), and
 *   to have a gate that reads the message AFTER every quoting layer has had its say — which is what
 *   this file is. It runs on the real thing: the file git is about to commit from, whatever produced
 *   it, whichever shell, whether a person or an assistant typed it.
 *
 *   For every commit the checks are structural, never stylistic: they refuse only the shapes that
 *   mean something upstream mangled the text.
 *
 *   A CLAUDE CODE SESSION'S COMMIT gets three more (CLAUDECODE=1, the key every session-only rule
 *   uses; a commit from VS Code or a terminal is never held to them): a subject of at most 72
 *   characters, a body of at most 600, and no line that says who approved or asked for the change.
 *   The written rule had asked for a 72-character subject since 2026-09-27 and 230 of the 300
 *   subjects after it were longer; bodies ran to 3,400 characters and carried the developer's
 *   one-word approvals as quotes. A rule nothing holds is not kept.
 * @structure lintCommitMessage(raw, { session }) → string[] of problems · main(): reads argv[2],
 *   passes session when CLAUDECODE=1, exits 1 on any
 * @usage
 *   pnpm check:commit-msg .git/COMMIT_EDITMSG    # what the hook runs
 *   Unit-tested in test/unit/commit-msg.test.ts — the validator is a pure function on purpose.
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial, after three `@`-titled commits reached main.
 *   v1.1.0 -- 2026-11-11 -- A session's commit: subject at most 72 characters, body at most 600,
 *     no approval line.
 */
import { readFileSync } from 'node:fs';

/**
 * Runaway guard, not a style rule.
 *
 * A short subject is better writing and this is not the place to enforce it: swept over the last
 * forty commits, a real one runs to 131 characters, and a gate that refuses the repo's own history
 * teaches people to bypass the gate. What this catches is a whole MESSAGE collapsed onto one line,
 * which is what a lost newline looks like — hundreds of characters, not a hundred and thirty.
 */
const MAX_SUBJECT = 250;

/**
 * Quoting wreckage: a line that is nothing but the leftovers of a shell string form. Each of these
 * is a character sequence that carries meaning in one shell and none in another, so seeing one
 * ALONE on a line means the text arrived through the wrong one.
 */
const QUOTING_WRECKAGE = /^\s*(@['"]|['"]@|@|EOF|['"`]|\\)\s*$/;

/** A session's subject: the length `git log --oneline`, commit lists and GitHub show uncut. */
const SESSION_MAX_SUBJECT = 72;

/**
 * A session's body, trailers not counted: room for why the change exists, in four or five
 * sentences. Test results, how the defect was found and the per-file list belong in the report and
 * the development notes; the diff shows what changed.
 */
const SESSION_MAX_BODY = 600;

/** A subject git wrote by itself is not the session's writing. */
const GIT_WRITTEN_SUBJECT = /^(Merge |Revert "|fixup! |squash! |amend! )/;

/** The trailers the hooks and the board read. They are not body text. */
const TRAILER = /^(Session|Project|Wish|Red-CI|Red-Nightly|Signed-off-by): /;

/**
 * Who approved or asked for the change. That is on the wish or the decision record. The name is
 * matched with its capital, so a session name in a path (cc-jouni-…) passes, and "approved by" is
 * matched only with the developer after it, because an owner approving an agent is product
 * vocabulary.
 */
const APPROVAL_LINE = /\bJouni\b|\b([Aa]pproved|[Aa]ccepted|[Rr]uled|[Rr]equested|[Oo]rdered|[Aa]sked for)\s+by\s+the\s+developer\b/;

export interface LintOptions {
    /** The commit is made by a Claude Code session (CLAUDECODE=1). */
    session?: boolean;
}

/**
 * Read one commit message and list everything wrong with it.
 *
 * Comment lines (`#`) and everything from the scissors line down are dropped first, exactly as git
 * does, so a template or a verbose diff never counts as content.
 */
export function lintCommitMessage(raw: string, opts: LintOptions = {}): string[] {
    const problems: string[] = [];

    const scissors = raw.indexOf('\n# ------------------------ >8 ------------------------');
    const body = scissors === -1 ? raw : raw.slice(0, scissors);
    const lines = body.split('\n').filter(l => !l.startsWith('#'));

    // Leading blank lines are not an error on their own (git strips them), but they must not hide a
    // wrecked first line, so find the first line with content and judge THAT as the subject.
    const firstIndex = lines.findIndex(l => l.trim() !== '');
    if (firstIndex === -1) {
        return ['The commit message is empty.'];
    }
    const subject = lines[firstIndex].trim();

    if (QUOTING_WRECKAGE.test(subject)) {
        problems.push(
            `The subject line is "${subject}", which is shell quoting, not a subject.\n` +
            '    This is the 2026-08-13 failure: PowerShell here-string syntax (@\'…\'@) used in Bash,\n' +
            '    where it is not syntax. Write the message to a file and use scripts/git-commit.sh,\n' +
            '    or `git commit -F <file>` — a multi-line message should never be a shell argument.');
    }

    if (subject.length > MAX_SUBJECT) {
        problems.push(`The subject line is ${subject.length} characters; keep it under ${MAX_SUBJECT}.`);
    }

    // A body must be separated from the subject by ONE blank line. Without it, `git log --oneline`
    // and every tool that reads a subject swallow the first sentence of the body.
    const second = lines[firstIndex + 1];
    if (second !== undefined && second.trim() !== '') {
        problems.push('Line 2 must be blank: the subject is the first line, the body starts on line 3.');
    }

    // The same wreckage at the END is the closing half of the same mistake, and it is easy to miss
    // because nothing displays the last line of a commit message.
    const lastIndex = lines.map(l => l.trim()).reduce((acc, l, i) => (l !== '' ? i : acc), -1);
    if (lastIndex > firstIndex && QUOTING_WRECKAGE.test(lines[lastIndex])) {
        problems.push(`The last line is "${lines[lastIndex].trim()}" — the closing half of a shell quote, not part of the message.`);
    }

    // CLAUDE.md: no Co-Authored-By trailer on this project.
    if (lines.some(l => /^\s*Co-Authored-By:/i.test(l))) {
        problems.push('Remove the Co-Authored-By trailer — this project does not use it.');
    }

    if (opts.session) problems.push(...lintSessionMessage(subject, lines.slice(firstIndex + 1)));

    return problems;
}

/** The three checks a Claude Code session's commit gets on top of the structural ones. */
function lintSessionMessage(subject: string, rest: string[]): string[] {
    const problems: string[] = [];
    const bodyLines = rest.map(l => l.trim()).filter(l => l !== '' && !TRAILER.test(l));

    if (subject.length > SESSION_MAX_SUBJECT && !GIT_WRITTEN_SUBJECT.test(subject)) {
        problems.push(
            `The subject line is ${subject.length} characters; a session's subject is at most ${SESSION_MAX_SUBJECT}.\n` +
            '    Name the one thing that changed. The reason goes in the body.');
    }

    const bodyLength = bodyLines.join(' ').length;
    if (bodyLength > SESSION_MAX_BODY) {
        problems.push(
            `The body is ${bodyLength} characters; a session's body is at most ${SESSION_MAX_BODY}.\n` +
            '    Say why the change exists. Test results, how the defect was found and the list of\n' +
            '    files go to the report and the development notes; the diff shows what changed.');
    }

    if ([subject, ...bodyLines].some(l => APPROVAL_LINE.test(l))) {
        problems.push(
            'The message says who approved or asked for the change. Take that line out:\n' +
            '    it is on the wish or the decision record, and a commit message does not repeat it.');
    }

    return problems;
}

function main(): void {
    const path = process.argv[2];
    if (!path) {
        console.error('usage: check-commit-msg <path to commit message file>');
        process.exit(2);
    }
    const problems = lintCommitMessage(readFileSync(path, 'utf-8'), { session: process.env.CLAUDECODE === '1' });
    if (problems.length === 0) return;

    console.error('');
    console.error('  Commit message rejected');
    console.error('  ' + '─'.repeat(62));
    for (const p of problems) console.error(`    • ${p}`);
    console.error('');
    console.error('  The message is still in ' + path + ' — fix it and commit again, or use:');
    console.error('    bash scripts/git-commit.sh <message-file>');
    console.error('');
    process.exit(1);
}

// Only run when invoked directly, so the unit test can import the validator.
if (process.argv[1] && process.argv[1].endsWith('check-commit-msg.ts')) main();
