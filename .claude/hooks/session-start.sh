#!/bin/sh
# session-start.sh — the coordination ritual, triggered instead of remembered.
#
# Eight Claude Code sessions, several machines and more than one account develop this repo at
# once, and the rules for that live in skill `aimeat-dev-session` on the node. A skill is read
# when a session thinks to read it. On 2026-09-05 two sessions did not: one worked eighteen
# hours before writing its claim, and the same session's heartbeat then stood four hours stale
# while it edited the git hooks, CI and CLAUDE.md — the exact files the claims board exists to
# keep two sessions off. Both times the developer noticed before the session did.
#
# So this prints, into the session's own first context: the ritual, whether the session is
# named, whether it sits in its own worktree, and what the shared checkout looks like right
# now. It asserts nothing and blocks nothing — a hook that refuses work at startup would be
# worse than the problem. Everything it prints, it measured.
set -u

printf '=== AIMEAT session start ===\n\n'

if [ -n "${AIMEAT_SESSION:-}" ]; then
  printf 'Session name: %s (stamped on every commit as a Session: trailer)\n' "$AIMEAT_SESSION"
else
  printf 'Session name: NOT SET. Export AIMEAT_SESSION=cc-<owner>-<tag> before your first commit,\n'
  printf '  or the commit carries no Session: trailer and the claims board cannot match it.\n'
fi

toplevel=$(git rev-parse --show-toplevel 2>/dev/null || echo '')
common=$(git rev-parse --git-common-dir 2>/dev/null || echo '')
case "$toplevel" in
  *".worktrees"*) printf 'Worktree: %s (your own — good)\n' "$toplevel" ;;
  '')             printf 'Worktree: not a git checkout\n' ;;
  *)
    if [ "$common" = ".git" ] || [ "$common" = "$toplevel/.git" ]; then
      printf 'Worktree: THE SHARED CHECKOUT (%s).\n' "$toplevel"
      printf '  That one is the developer'"'"'s. Before editing anything:\n'
      printf '    git worktree add .worktrees/<session> origin/main && cd .worktrees/<session> && pnpm install\n'
      printf '  then copy aimeat/.env.test.* into it.\n'
    else
      printf 'Worktree: %s\n' "$toplevel"
    fi
    ;;
esac

printf '\nShared checkout right now:\n'
git -C "${toplevel:-.}" log --oneline -1 2>/dev/null | sed 's/^/  HEAD  /'
dirty=$(git -C "${toplevel:-.}" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
printf '  %s uncommitted path(s)\n' "$dirty"
printf '  worktrees:\n'
git -C "${toplevel:-.}" worktree list 2>/dev/null | sed 's/^/    /'

cat <<'RITUAL'

Before your first edit, in this order (skill `aimeat-dev-session` on the node has the detail,
read it with aimeat_skill_get):

  1. Read the incidents board — what is broken on main right now.
       organism da438a5f-609b-41e5-ad9f-8dd2cc76cbe1, workspace ws-mtnpi7c68e4
  2. Read the claims board — who holds which files and which E2E port.
       workspace ws-mtnphyhh8hc
  3. WRITE YOUR OWN CLAIM before editing: the area you will touch, the port you will run
     E2E on (any free one from 40251 up that no active claim names), and your intent.
     A claim written afterwards is a claim that protected nobody.
  4. Heartbeat it at least hourly, and whenever the area changes. Three hours old reads
     as stale to everyone else.
  5. Release or hand off when you stop.

And two rules this repo learned the hard way, both on 2026-09-05:

  - VERIFY THE SIGNED-IN PATH BEFORE CALLING ANYTHING DONE. An app's write path was
    "verified" five times against production while signed out, and the one interaction
    nobody could run — a person pressing a button while logged in — was the broken one.
    `pnpm sandbox` gives you a node with real owners and real passwords in ten seconds.
  - COORDINATION NOISE DOES NOT REACH THE DEVELOPER. A peer session's port fix, a rebase,
    a claim update: do it, do not report it. He reads what changed for him.

RITUAL

exit 0
