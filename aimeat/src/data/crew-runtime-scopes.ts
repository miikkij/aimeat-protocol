/**
 * @file src/data/crew-runtime-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permissions a crew runtime writes with for ITSELF, whatever the agent's job is.
 *
 *   crewaimeat makes these calls on every run of every agent it serves, before and after the work
 *   the definition describes:
 *     - memory:write  `aimeat_memory_write` of the agent's README (`agents.<name>.readme`), of its
 *                     runtime status (`crews.runtime.<name>`) and of the result it delivers;
 *     - no scope      `aimeat_agent_tags_set` on the agent's OWN record (PATCH /v1/agents/:name/tags),
 *                     the identity push on every start. A sibling's tags need agent:write; the agent's
 *                     own do not (auth/self-or-scope.ts, ruled by Jouni on 2026-10-02);
 *     - no scope      the model-usage report (POST /v1/agents/:name/telemetry) and the refusal read
 *                     (GET /v1/agents/:name/refusals), fenced by ownership.
 *
 *   WHY A MISSING ONE FAILS EVERY TASK. Since aimeat-crewai 0.31.0 the daemon asks the node after
 *   each run which calls it refused, and a run with any refusal ends as refused. So a missing word
 *   here does not cost one feature: every task fails at the end, after the crew did the work.
 *   Measured 2026-10-02 on a hosted place: workflow-manager, made by the basic-agents button, failed
 *   its first task on the tags call, which then needed agent:write.
 *
 *   WHY NOT agent:write. It is also the word that lets an agent approve a new agent by itself and
 *   change a sibling's settings, and the basic agents (the concierge reads messages from strangers)
 *   are kept without it on purpose since 2026-09-01. So the node asks for no word on the agent's own
 *   tags rather than every crew agent asking for that one.
 *
 *   ONE COPY. The basic-agent templates take these words from here. When the runtime's own
 *   `crew.menu` answers `required_scopes`, that answer is the authority and this list is the
 *   fallback for a node with no runtime to ask, which is exactly the moment the button creates its
 *   agents.
 * @structure CREW_RUNTIME_SCOPES · withCrewRuntimeScopes(jobScopes)
 * @usage scopes: withCrewRuntimeScopes(['task:read', 'task:write'])
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial: memory:write, the one word the runtime writes with.
 */

export const CREW_RUNTIME_SCOPES: readonly string[] = ['memory:write'];

/** The scopes an agent's job needs, plus the ones its runtime writes with. Each word once, job's order first. */
export function withCrewRuntimeScopes(jobScopes: readonly string[]): string[] {
  const out = [...jobScopes];
  for (const s of CREW_RUNTIME_SCOPES) if (!out.includes(s)) out.push(s);
  return out;
}
