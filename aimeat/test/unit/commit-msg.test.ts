/**
 * @file test/unit/commit-msg.test.ts
 * @description The commit-message gate, on the exact wreckage that made it necessary.
 *
 *   Three commits reached main on 2026-08-13 carrying a stray `@` as their first line, because a
 *   PowerShell here-string (@'…'@) was written in Bash. A sweep afterwards found the same damage in
 *   seven commits across the repo's history, so this is a recurring failure and not one bad day.
 *
 *   The cases below are split deliberately between what MUST be refused and what must NOT be: a
 *   gate on prose earns its place only if it stays quiet on the prose people actually write, and
 *   the first version of this one rejected a real 131-character subject from the repo's own log.
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial, with the gate.
 */
import { describe, it, expect } from 'vitest';
import { lintCommitMessage } from '../../scripts/check-commit-msg.js';

describe('commit message gate', () => {
    it('refuses the here-string wreckage that started this', () => {
        const problems = lintCommitMessage([
            '@',
            'feat(agents): a fleet runtime can end the agents it created',
            '',
            'A body that is perfectly fine.',
            "'@",
        ].join('\n'));

        expect(problems.join(' ')).toContain('shell quoting');
        // Line 2 carries the real subject, which is how git ends up showing "@ feat(agents): …".
        expect(problems.some(p => p.includes('Line 2 must be blank'))).toBe(true);
        expect(problems.some(p => p.includes('closing half'))).toBe(true);
    });

    it('catches the closing half on its own', () => {
        const problems = lintCommitMessage('fix(auth): a good subject\n\nA body.\n@\n');
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('closing half');
    });

    it('catches a body glued to the subject', () => {
        const problems = lintCommitMessage('fix(auth): a good subject\nthe body starts immediately\n');
        expect(problems.some(p => p.includes('Line 2 must be blank'))).toBe(true);
    });

    it('refuses an empty message', () => {
        expect(lintCommitMessage('\n\n  \n')).toEqual(['The commit message is empty.']);
        expect(lintCommitMessage('# a comment git would strip\n')).toHaveLength(1);
    });

    it('refuses the Co-Authored-By trailer this project does not use', () => {
        const problems = lintCommitMessage(
            'feat(x): a subject\n\nA body.\n\nCo-Authored-By: Somebody <nobody@example.com>\n');
        expect(problems.some(p => p.includes('Co-Authored-By'))).toBe(true);
    });

    it('accepts an ordinary message', () => {
        expect(lintCommitMessage('feat(agents): a subject\n\nA body, several lines long.\nAnd another.\n')).toEqual([]);
    });

    it('accepts a subject-only message', () => {
        expect(lintCommitMessage('chore: bump the thing\n')).toEqual([]);
    });

    it('accepts a long subject, because the repo writes them', () => {
        // 131 characters, taken from the shape of a real commit in this history. A gate that refuses
        // the repo's own log gets bypassed, and then it protects nothing.
        const subject = 'feat(i18n): Spanish 37% — offers, apps, schedules and the rest of the tabs, with the calques from the first pass taken back out';
        expect(subject.length).toBeGreaterThan(120);
        expect(lintCommitMessage(`${subject}\n\nA body.\n`)).toEqual([]);
    });

    it('ignores git comment lines and the verbose diff below the scissors', () => {
        const raw = [
            'fix(x): a subject',
            '',
            'A body.',
            '# Please enter the commit message for your changes.',
            '# ------------------------ >8 ------------------------',
            'diff --git a/x b/x',
            '@',
        ].join('\n');
        expect(lintCommitMessage(raw)).toEqual([]);
    });
});

describe('commit message gate, for a Claude Code session', () => {
    const session = { session: true };
    const TRAILERS = '\n\nSession: cc-jouni-example\nProject: aimeat-protocol\n';

    it('refuses a subject over 72 characters', () => {
        const subject = 'fix(apps): the sign-in library sends no AI-state request for a token without ai:use';
        expect(subject.length).toBeGreaterThan(72);
        const problems = lintCommitMessage(`${subject}\n`, session);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('72');
        // The developer's own commit is not held to it.
        expect(lintCommitMessage(`${subject}\n`)).toEqual([]);
    });

    it('refuses a body over 600 characters, and does not count the trailers', () => {
        const sentence = 'The delete left rows behind because nothing read them afterwards. ';
        const fits = sentence.repeat(9).trim();
        const tooLong = sentence.repeat(10).trim();
        expect(fits.length).toBeLessThanOrEqual(600);
        expect(tooLong.length).toBeGreaterThan(600);

        expect(lintCommitMessage(`fix(x): a subject\n\n${fits}${TRAILERS}`, session)).toEqual([]);
        const problems = lintCommitMessage(`fix(x): a subject\n\n${tooLong}${TRAILERS}`, session);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('600');
        expect(lintCommitMessage(`fix(x): a subject\n\n${tooLong}${TRAILERS}`)).toEqual([]);
    });

    it('refuses a line that says who approved the change', () => {
        // The shape that reached main on 2026-11-11.
        const raw = 'fix(apps): a subject\n\nApproved by Jouni ("Tee") on wish-example, after an app went out twice with defects.' + TRAILERS;
        const problems = lintCommitMessage(raw, session);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('who approved');
        expect(lintCommitMessage(raw)).toEqual([]);
    });

    it('refuses "approved by the developer" as well', () => {
        const raw = 'fix(apps): a subject\n\nItems 2 and 3 of the audit, approved by the developer the same day.\n';
        expect(lintCommitMessage(raw, session).some(p => p.includes('who approved'))).toBe(true);
    });

    it('accepts the session trailer, whose value carries the owner name in lower case', () => {
        expect(lintCommitMessage('fix(x): a subject\n\nA body.' + TRAILERS, session)).toEqual([]);
    });

    it('accepts the product sense of approval', () => {
        const raw = 'fix(agents): an agent approved by another agent of its owner keeps its scopes\n';
        expect(lintCommitMessage(raw.slice(0, 72), session)).toEqual([]);
        expect(lintCommitMessage('fix(agents): a subject\n\nAn agent approved by its owner keeps the scopes the owner picked.\n', session)).toEqual([]);
    });

    it('leaves the subjects git writes alone', () => {
        const merge = "Merge remote-tracking branch 'origin/main' into a-branch-with-a-long-name-that-git-wrote-by-itself";
        const revert = 'Revert "fix(organisms): deleting an organism or a workspace removes its rows and row revisions"';
        expect(merge.length).toBeGreaterThan(72);
        expect(revert.length).toBeGreaterThan(72);
        expect(lintCommitMessage(`${merge}\n`, session)).toEqual([]);
        expect(lintCommitMessage(`${revert}\n\nThis reverts commit 0123456789abcdef.\n`, session)).toEqual([]);
    });
});
