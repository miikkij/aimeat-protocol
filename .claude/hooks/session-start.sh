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

# Claude Code hands the hook a JSON object on stdin, and its session_id is the one thing a session
# cannot find out about itself any other way. Lifecycle Central 3.3.0 turns it into a link that
# opens this conversation from the claim. Read only when stdin is not a terminal, so a person
# running the script by hand is not left waiting on it.
session_id=''
if [ ! -t 0 ]; then
  session_id=$(cat | tr -d '\r\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F-]\{36\}\)".*/\1/p')
fi

printf '=== AIMEAT session start ===\n\n'

if [ -n "${AIMEAT_SESSION:-}" ]; then
  printf 'Session name: %s (stamped on every commit as a Session: trailer)\n' "$AIMEAT_SESSION"
else
  printf 'Session name: NOT SET. Export AIMEAT_SESSION=cc-<owner>-<tag> before your first commit,\n'
  printf '  or the commit carries no Session: trailer and the claims board cannot match it.\n'
fi

if [ -n "$session_id" ]; then
  printf 'Claude Code session id: %s\n' "$session_id"
  printf '  Give it to claim_open or claim_heartbeat as sessionId, and the claim in Lifecycle Central opens\n'
  printf '  this conversation in VS Code on this machine. When Remote Control is on, give its\n'
  printf '  https://claude.ai/code/... address as sessionUrl as well, and the claim opens the running session\n'
  printf '  from any device. /clear starts a new id: heartbeat with the new one.\n'
fi

toplevel=$(git rev-parse --show-toplevel 2>/dev/null || echo '')
common=$(git rev-parse --git-common-dir 2>/dev/null || echo '')
case "$toplevel" in
  *".worktrees"*) printf 'Worktree: %s (your own — good)\n' "$toplevel" ;;
  '')             printf 'Worktree: not a git checkout\n' ;;
  *)
    if [ "$common" = ".git" ] || [ "$common" = "$toplevel/.git" ]; then
      printf 'Worktree: THE SHARED CHECKOUT (%s).\n' "$toplevel"
      printf '  That one is the developer'"'"'s. Before editing anything, move into your own worktree:\n'
      printf '    call the EnterWorktree tool with name cc-<owner>-<tag>\n'
      printf '  (or start the next session with: claude --worktree cc-<owner>-<tag>). The WorktreeCreate hook\n'
      printf '  makes .worktrees/<name> at origin/main with its own install and .env.test.*, and from then on\n'
      printf '  Claude Code refuses edits to this checkout.\n'
    else
      printf 'Worktree: %s\n' "$toplevel"
    fi
    ;;
esac

printf '\nShared checkout right now:\n'
git -C "${toplevel:-.}" log --oneline -1 2>/dev/null | sed 's/^/  HEAD  /'
dirty=$(git -C "${toplevel:-.}" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
printf '  %s uncommitted path(s)\n' "$dirty"
# A count, not the list: the list was two thirds of this output (36 lines on 2026-09-13) and
# grew with every worktree left behind, while who works where is the claims board's to say.
wt_all=$(git -C "${toplevel:-.}" worktree list --porcelain 2>/dev/null | grep -c '^worktree ')
wt_repo=$(git -C "${toplevel:-.}" worktree list --porcelain 2>/dev/null | grep '^worktree ' | grep -c '/\.worktrees/')
printf '  %s worktrees, %s of them under .worktrees/ (git worktree list names them; the claims board says whose)\n' "$wt_all" "$wt_repo"

# CodeQL decides whether `pnpm gate` is the whole CI check on this machine: check:field-reach needs
# it, and without it the gate refuses. Read the pointer `pnpm codeql:install` writes, the same file
# scripts/inventory/field-reach-facts.ts resolveCodeql() reads, and say which it is before any work.
codeql_ptr="$HOME/.aimeat/codeql.json"
codeql_cli=''
if [ -f "$codeql_ptr" ]; then
  codeql_cli=$(sed -n 's/.*"cli": *"\(.*\)".*/\1/p' "$codeql_ptr" | sed 's/\\\\/\\/g')
fi
if [ -n "$codeql_cli" ] && [ -f "$codeql_cli" ]; then
  printf '\nCodeQL: registered (%s). pnpm gate runs the whole CI check here; do not wait for GitHub.\n' "$codeql_cli"
else
  printf '\nCodeQL: MISSING on this machine. Install it FIRST, before any other work:\n'
  printf '    cd aimeat && pnpm codeql:install\n'
  printf '  Without it pnpm gate refuses check:field-reach, and the local CI run is not complete.\n'
fi

cat <<'RITUAL'

Before your first edit, in this order (skill `aimeat-dev-session` on the node has the detail,
read it with aimeat_skill_get):

  1. Read the incidents board — what is broken on main right now.
       organism da438a5f-609b-41e5-ad9f-8dd2cc76cbe1, workspace ws-mtnpi7c68e4
  2. Read the claims board — who holds which files and which E2E port.
       workspace ws-mtnphyhh8hc
  3. WRITE YOUR OWN CLAIM before editing: the area you will touch, the port you will run
     E2E on (any free one from 40251 up that no active claim names), your intent, and the
     session id printed above.
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
