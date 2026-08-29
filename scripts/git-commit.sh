#!/bin/sh
#
# Commit with a message that never passes through a shell.
#
#   bash scripts/git-commit.sh <message-file> [git commit args…]
#
# WHY. A multi-line commit message given as a shell ARGUMENT has to survive whichever shell is
# running, and this repo has two: PowerShell is primary on Windows, Bash sits beside it, and their
# multi-line string syntaxes are not the same. On 2026-08-13 a PowerShell here-string (@'…'@) was
# written in Bash, where `@'` is not syntax but the character `@` and a quote — and three commits
# reached main whose subject line was `@`. Everything downstream accepted it, because nothing was
# malformed; the message simply was not the message.
#
# `git commit -F <file>` removes the shell from that path entirely. Write the message with an
# editor or a file-writing tool, hand over the path, and no quoting rule applies to its content.
#
# The commit-msg hook checks the result either way. This script is how you stop needing it.
#
# Example:
#   cat > /tmp/msg.txt <<'EOF'
#   fix(auth): the session check now runs where the token is verified
#
#   It lived behind an early return that a globally-mounted middleware made unreachable.
#   EOF
#   bash scripts/git-commit.sh /tmp/msg.txt

set -e

MSG_FILE="$1"
if [ -z "$MSG_FILE" ]; then
  echo "usage: bash scripts/git-commit.sh <message-file> [git commit args…]" >&2
  exit 2
fi
if [ ! -f "$MSG_FILE" ]; then
  echo "no such message file: $MSG_FILE" >&2
  exit 2
fi
shift

# `--only -- <paths>` is how a session commits its own files while another session's staged work
# stays in the index (docs/pitfalls.md §32). Git's --only takes TRACKED paths: a new file named
# after `--` fails with "pathspec did not match any file(s) known to git" and nothing is committed
# (2026-08-29, five new files). So a path the caller named that git does not know yet is staged
# here first, by name — exactly the paths listed, never `-A` — and each one is announced.
if printf '%s\n' "$@" | grep -qx -- '--only'; then
  seen_dashes=0
  for arg in "$@"; do
    if [ "$seen_dashes" -eq 0 ]; then
      [ "$arg" = "--" ] && seen_dashes=1
      continue
    fi
    if [ -e "$arg" ] && ! git ls-files --error-unmatch -- "$arg" >/dev/null 2>&1; then
      echo "[git-commit] staging new file by name: $arg" >&2
      git add -- "$arg"
    fi
  done
fi

# No pre-flight check here on purpose. `git commit -F` copies this file to COMMIT_EDITMSG and runs
# the commit-msg hook on it before creating anything, so the gate already sees the real message and
# a refusal aborts the commit with the index untouched. A second copy of the check here would be a
# second place for it to drift.
git commit -F "$MSG_FILE" "$@"
