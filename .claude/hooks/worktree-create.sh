#!/bin/sh
# worktree-create.sh — Claude Code's WorktreeCreate hook: make the worktree this repo expects.
#
# `claude --worktree <name>`, a subagent with `isolation: worktree`, and a backgrounded session all
# ask Claude Code for a worktree. Its default is a bare checkout under .claude/worktrees/<name> on a
# new branch, with no dependencies and no test environment: four such copies were abandoned there
# on 2026-08-24, and every session since has made its worktree by hand instead, following the
# recipe in CLAUDE.md. This hook runs that recipe, so the flag and the recipe produce the same
# thing: .worktrees/<name> at origin/main, detached, with its own aimeat/node_modules and its own
# .env.test.* from `pnpm test:env:init`.
#
# Why it matters beyond tidiness: a session STARTED inside its worktree loads that worktree's
# CLAUDE.md, rules and settings, runs its hooks, and is refused by Claude Code when it edits or runs
# git in the main checkout. A session started in the main checkout and working in a worktree by
# path gets none of that, and loads a second copy of CLAUDE.md when it reads worktree files.
#
# Contract (Claude Code hooks): JSON on stdin, the absolute worktree path as the ONLY stdout,
# exit 0. Any non-zero exit aborts the creation. Everything else goes to stderr.
# Never links into another node_modules (docs/pitfalls.md section 13): each worktree installs its own.
#
# 2026-10-16 — Sets core.hooksPath so a commit in the new worktree runs the pre-commit hook (QA audit
# W09, P2-07).
set -eu

input=$(cat)
field() {
  printf '%s' "$input" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const j = JSON.parse(s); const v = process.argv.slice(1).map((k) => j[k]).find((x) => typeof x === "string" && x);
      process.stdout.write(v ?? "");
    });' "$@"
}

if [ -n "${AIMEAT_WORKTREE_HOOK_LOG:-}" ]; then printf '%s\n' "$input" >> "$AIMEAT_WORKTREE_HOOK_LOG"; fi

name=$(field worktree_name name)
from=$(field cwd)
[ -n "$from" ] || from=$(pwd)
case "$name" in
  ''|*[!A-Za-z0-9._-]*|.*) echo "worktree-create: refusing name '$name' (letters, digits, . _ - only)" >&2; exit 1 ;;
esac

# pnpm, or corepack's when pnpm is not on PATH. Decided BEFORE `git worktree add`: a missing pnpm
# used to fail the install after the worktree was registered, and the next attempt took the
# "reusing" branch and skipped the install (QA audit P9, 2026-10-16).
if command -v pnpm >/dev/null 2>&1; then pm="pnpm"
elif command -v corepack >/dev/null 2>&1; then pm="corepack pnpm"
else echo "worktree-create: neither pnpm nor corepack is on PATH; see docs/coding-guidelines/getting-started.md (A new machine)" >&2; exit 1
fi

common=$(git -C "$from" rev-parse --path-format=absolute --git-common-dir)
repo=$(dirname "$common")
dir="$repo/.worktrees/$name"

if git -C "$repo" worktree list --porcelain | grep -qx "worktree $dir"; then
  echo "worktree-create: reusing $dir" >&2
  # A worktree an earlier attempt registered but never installed gets its install now.
  if [ ! -d "$dir/aimeat/node_modules" ]; then (cd "$dir/aimeat" && $pm install --frozen-lockfile >&2); fi
else
  if [ -e "$dir" ]; then echo "worktree-create: $dir exists and is not a registered worktree" >&2; exit 1; fi
  git -C "$repo" fetch origin --quiet >&2 || echo "worktree-create: fetch failed, using the cached origin/main" >&2
  git -C "$repo" worktree add --detach "$dir" origin/main >&2
  # AIMEAT_WORKTREE_HOOK_SKIP_INSTALL=1 is for the hook's own test, which has no package to install.
  if [ "${AIMEAT_WORKTREE_HOOK_SKIP_INSTALL:-}" != "1" ]; then
    (cd "$dir/aimeat" && $pm install --frozen-lockfile >&2)
    (cd "$dir/aimeat" && $pm test:env:init >&2) || echo "worktree-create: test:env:init did not finish; run it in aimeat/ before E2E" >&2
  fi
fi

# The git hooks run only when core.hooksPath names .githooks. The root package's prepare script sets
# it, and this recipe installs in aimeat/ only, so a clone made this way committed and pushed with no
# hook at all (QA audit 2026-10-16, P2-07). The setting is in the clone's shared config: setting it
# here turns the hooks on for every worktree of the clone. A relative path resolves against the
# worktree a hook runs in, so each worktree runs its own .githooks.
if [ "$(git -C "$dir" config --get core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then
  git -C "$dir" config core.hooksPath .githooks
  echo "worktree-create: git hooks turned on (core.hooksPath .githooks)" >&2
fi

if command -v cygpath >/dev/null 2>&1; then cygpath -w "$dir"; else printf '%s\n' "$dir"; fi
