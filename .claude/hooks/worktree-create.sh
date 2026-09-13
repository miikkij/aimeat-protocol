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

common=$(git -C "$from" rev-parse --path-format=absolute --git-common-dir)
repo=$(dirname "$common")
dir="$repo/.worktrees/$name"

if git -C "$repo" worktree list --porcelain | grep -qx "worktree $dir"; then
  echo "worktree-create: reusing $dir" >&2
else
  if [ -e "$dir" ]; then echo "worktree-create: $dir exists and is not a registered worktree" >&2; exit 1; fi
  git -C "$repo" fetch origin --quiet >&2 || echo "worktree-create: fetch failed, using the cached origin/main" >&2
  git -C "$repo" worktree add --detach "$dir" origin/main >&2
  (cd "$dir/aimeat" && pnpm install --frozen-lockfile >&2)
  (cd "$dir/aimeat" && pnpm test:env:init >&2) || echo "worktree-create: test:env:init did not finish; run it in aimeat/ before E2E" >&2
fi

if command -v cygpath >/dev/null 2>&1; then cygpath -w "$dir"; else printf '%s\n' "$dir"; fi
