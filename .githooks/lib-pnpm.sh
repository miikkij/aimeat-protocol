# Sourced by the hooks that run pnpm (pre-commit, commit-msg, pre-push); not a hook itself.
#
# A machine with Node and corepack but no pnpm on PATH ran no hook command at all: each one stopped
# at "pnpm: command not found". Corepack ships with Node and runs the pnpm version package.json pins,
# so the hooks use it when pnpm itself is missing, and say so plainly when neither is there.
# (QA audit 2026-10-16, P2-07: hooks on, on a new machine.)
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    pnpm() { corepack pnpm "$@"; }
  else
    echo "[hooks] pnpm is not on PATH and neither is corepack, so this hook cannot run its checks." >&2
    echo "[hooks] Install Node 24 (it carries corepack) or pnpm, then commit again." >&2
    exit 1
  fi
fi
