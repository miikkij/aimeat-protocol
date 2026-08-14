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

# No pre-flight check here on purpose. `git commit -F` copies this file to COMMIT_EDITMSG and runs
# the commit-msg hook on it before creating anything, so the gate already sees the real message and
# a refusal aborts the commit with the index untouched. A second copy of the check here would be a
# second place for it to drift.
git commit -F "$MSG_FILE" "$@"
