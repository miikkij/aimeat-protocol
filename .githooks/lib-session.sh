# Sourced by the hooks that hold an agent session to rules the developer is not held to
# (prepare-commit-msg, pre-push); not a hook itself.
#
# A commit or a push is an agent session's when CLAUDECODE is set (every Claude Code session has it)
# or AIMEAT_SESSION names a session (AGENTS.md tells Codex, Cursor and the other agents to export it).
# A commit from VS Code or a terminal carries neither and is the developer's own. The Node scripts ask
# the same question through aimeat/scripts/lib/session-env.mjs, so the two answers stay one rule.
agent_session() {
  case "${CLAUDECODE:-}" in
    ''|0) ;;
    *) return 0 ;;
  esac
  [ -n "${AIMEAT_SESSION:-}" ]
}
