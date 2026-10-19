# Upstream

This skill is Cloudflare's `security-audit` skill, copied unchanged except for one edit and two added files (this one and `windows-validate.cjs`).

- Source: https://github.com/cloudflare/security-audit-skill, folder `skills/security-audit/`
- Pinned commit: `c1c8a8c` (2026-09-14, "Clarify guidance and full audit modes")
- Licence: MIT, Copyright (c) 2025-2026 Cloudflare, Inc. The licence text is in `LICENSE` beside this file.
- Copied on 2026-10-20 by session `cc-jouni-secaudit-oct`.

## The one local edit

`SKILL.md` had 17 em-dashes, and `pnpm check:instructions` refuses an em-dash in a project skill. Each ` — ` became `: `, and the two dashes that bracketed a clause became commas. No word changed. Every other upstream file is byte-identical to the pinned commit.

## The one local addition

The upstream validators refuse to open any file on Windows, because Node there has no `O_NOFOLLOW` or `O_NONBLOCK` (7 of the 65 upstream tests fail for that reason alone). `windows-validate.cjs` reads the file with an `lstat` check (no symlink, a regular file, under the upstream byte limit) and then calls the upstream module's own `validateDocument`, so the validation is unchanged:

```bash
node .claude/skills/security-audit/windows-validate.cjs findings <run>/findings.json
node .claude/skills/security-audit/windows-validate.cjs ledger <run>/coverage-ledger.json
```

On Linux or macOS, use the upstream CLIs as `SKILL.md` says.

## Updating

Copy the folder again from a newer commit, repeat the em-dash edit, change the commit line above, and read the diff before committing: the skill is instructions an agent follows, so a change upstream is a change in what our audits do.

## How this project runs it

- Output goes to the main checkout's `docs/internal/secaudit<yyyy><mon>/` (gitignored), never to the repo tree and never to a worktree's own `docs/internal/`, which is deleted with the worktree.
- The skill runs target code only inside an OS-enforced sandbox with no network. A Claude Code session on Windows has none, so hunters stay source-only and a claim that needs execution is recorded as `needs_validation`. Reproduction on a `pnpm sandbox` node is then a separate step, done by the parent after the run and written down as such in the report.
- Prior evidence for a run: the last audit folder in `docs/internal/`, the open incidents on the Lifecycle Central board, and `docs/coding-guidelines/security-development-dna.md`.
