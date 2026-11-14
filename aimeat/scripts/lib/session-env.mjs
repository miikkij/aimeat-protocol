/**
 * @file scripts/lib/session-env.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Says whether a commit or a push is an agent session's, for every hook rule that holds a
 *   session and never the developer: the 72/600 message limits and the approval line
 *   (check-commit-msg.ts), the refusal on a missing private-terms list (check-private-terms.mjs) and
 *   the refusal of a push on a red CI (ci-state.mjs). The shell hooks ask the same question through
 *   `.githooks/lib-session.sh`.
 *
 *   WHY TWO MARKERS. Claude Code puts CLAUDECODE=1 into every session's environment and nobody else
 *   has it, so the rules keyed on that alone. Codex, Cursor and the other agents AGENTS.md sends here
 *   do not set it, and the hooks treated them as the developer: no limit, no refusal (instruction
 *   review 2026-11-14, X2). AGENTS.md tells every agent to export AIMEAT_SESSION, which the commit
 *   hook stamps as the Session: trailer, so that name is the second marker. A commit from VS Code or
 *   a terminal carries neither and stays the developer's own.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */

/**
 * True when the environment belongs to an agent session: CLAUDECODE is set (Claude Code) or
 * AIMEAT_SESSION names a session (any agent that follows AGENTS.md).
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isAgentSession(env = process.env) {
    const claude = (env.CLAUDECODE ?? '').trim();
    return (claude !== '' && claude !== '0') || (env.AIMEAT_SESSION ?? '').trim() !== '';
}
