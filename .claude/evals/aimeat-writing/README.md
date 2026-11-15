# aimeat-writing eval suite

Three cases, run with `pnpm eval:skill aimeat-writing --model opus --max-cost-usd 10`. The decisions
and scores are in `aimeat/security/skill-evals.json`; how a suite is written and read is in
`.claude/rules/skills.md`.

## Graders shown to fail

A grader that has never failed has not been shown to work (`.claude/rules/skills.md`). This list
says which graders were made to fail on purpose, on what, and when.

**`commit-message/graders/within-hook-limits.md`**, 2026-11-15. It holds the same limits as the
`commit-msg` hook for a session's commit (`aimeat/scripts/check-commit-msg.ts`): the subject is the
first line with content, trimmed, at most 72 characters; the body is every later non-empty line,
trimmed, joined with one space, at most 600 characters. A code fence around the answer is not
counted, because it is not part of the commit. Two things the hook drops are not modelled: lines
that start with `#`, and trailer lines (`Session:`, `Project:` and the like). An eval answer has
neither.

It was checked against the hook's own `lintCommitMessage` with `session: true`:

- 20,000 generated messages (subjects of 60 to 79 characters, one to eight body lines, blank lines,
  leading and trailing spaces, CRLF, code fences, leading blank lines): the grader and the hook
  agreed on all of them, and the hook refused 3,881.
- At the limits, the grader passes a 72-character subject and a 600-character body (in one
  paragraph, in two, and inside a code fence), and fails a 73-character subject and a 601-character
  body in each of the same three shapes. The hook gives the same verdicts.
- The known-bad message: the subject `fix(webhooks): one retry path` with a 610-character body. The
  grader fails it and the hook refuses it. The grader before 2026-11-15 (a first line of 73 or more
  characters, or 700 or more characters in all) passed it, as it passed every body over 600
  characters while the whole message stayed under 700.
