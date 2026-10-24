# Upstream

This skill is Cloudflare's `security-audit` skill, copied unchanged except for two edits and three added files (this one, `windows-validate.cjs` and `AIMEAT-PURPOSE.md`).

- Source: https://github.com/cloudflare/security-audit-skill, folder `skills/security-audit/`
- Pinned commit: `c1c8a8c` (2026-09-14, "Clarify guidance and full audit modes")
- Licence: MIT, Copyright (c) 2025-2026 Cloudflare, Inc. The licence text is in `LICENSE` beside this file.
- Copied on 2026-10-20 by session `cc-jouni-secaudit-oct`.

## The two local edits

1. `SKILL.md` had 17 em-dashes, and `pnpm check:instructions` refuses an em-dash in a project skill. Each ` — ` became `: `, and the two dashes that bracketed a clause became commas. No word changed.
2. `SKILL.md` has one added paragraph under its title, telling the parent to read `AIMEAT-PURPOSE.md` first and to name it in every delegated agent's brief. Until then the guard reached an audit only when the run's brief named it, and a session that loaded the skill alone never saw it (Jouni, 2026-10-22).

Every other upstream file is byte-identical to the pinned commit.

## The one local addition

The upstream validators refuse to open any file on Windows, because Node there has no `O_NOFOLLOW` or `O_NONBLOCK` (7 of the 65 upstream tests fail for that reason alone). `windows-validate.cjs` reads the file with an `lstat` check (no symlink, a regular file, under the upstream byte limit) and then calls the upstream module's own `validateDocument`, so the validation is unchanged:

```bash
node .claude/skills/security-audit/windows-validate.cjs findings <run>/findings.json
node .claude/skills/security-audit/windows-validate.cjs ledger <run>/coverage-ledger.json
```

On Linux or macOS, use the upstream CLIs as `SKILL.md` says.

## Updating

Copy the folder again from a newer commit, repeat both edits, change the commit line above, and read the diff before committing: the skill is instructions an agent follows, so a change upstream is a change in what our audits do.

## The purpose guard

`AIMEAT-PURPOSE.md` is a local companion, and the paragraph added under `SKILL.md`'s title points every audit to it. Every hunter, verifier, critic and fix agent of an AIMEAT audit reads it next to its own brief: it lists what AIMEAT is for (the uses a fix must keep), the two proofs every fix gives (the attack is refused, the legitimate use still works), and the steps before a fix round goes to main (a capability-loss review, a behaviour-change list the developer approves, then the full sweep once on green). It was written after the October 2026 audit's second wave, whose fixes removed designed uses with every suite green (`docs/pitfalls.md` §126). The same feedback went upstream as https://github.com/cloudflare/security-audit-skill/issues/88.

## How this project runs it

- Output goes to the Security register on aimeat.io (organism AIMEAT SECURITY, workspace `ws-mvkjtfqtfgn`; `AIMEAT-PURPOSE.md` says how). While a run is in progress, its working files may sit in the main checkout's `docs/internal/secaudit<yyyy><mon>/` (gitignored), never in the repo tree and never in a worktree's own `docs/internal/`, which is deleted with the worktree; the run is finished when they are in the register.
- The skill runs target code only inside an OS-enforced sandbox with no network. A Claude Code session on Windows has none, so hunters stay source-only and a claim that needs execution is recorded as `needs_validation`. Reproduction on a `pnpm sandbox` node is then a separate step, done by the parent after the run and written down as such in the report.
- Prior evidence for a run: the Security register (earlier runs, findings and their status, exceptions), the open incidents on the Lifecycle Central board, and `docs/coding-guidelines/security-development-dna.md`.
