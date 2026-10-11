/**
 * @file src/services/crew-def-warnings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a crew definition would do that its author very likely did not intend, said at
 *   the moment it is proposed or published. A warning never refuses: the definition can run, and
 *   the runtime's own validator stays the authority on whether it is valid.
 *
 *   WHY. A definition that listens for direct messages and gives no member the tool that sends one
 *   is valid and runs: the agent wakes on the message, does its work, and the person who wrote to it
 *   hears nothing. Measured on aimeat.io on 2026-10-11: an always-on agent proposed that way picked
 *   its first message up at once, filed its output 9.3 seconds later, and sent no reply. Nothing on
 *   the proposal, the approval or the run said why. The home page's own "when someone writes to it"
 *   choice produced the same definition.
 *
 *   ONE RULE SO FAR, and a rule joins only with a measured case like the one above.
 *
 *     DM_WITHOUT_REPLY_TOOL   `listen_for` holds `dms`, and no member's `tools` holds `dm`.
 *
 *   The tool ids are the crewaimeat runtime's (`dm`: read and reply to the agent's inbox). A runtime
 *   with another vocabulary gets a warning it can ignore, which is why this warns and does not refuse.
 * @structure CrewDefWarning · crewDefWarnings(def)
 * @usage const warnings = crewDefWarnings(body.crew_def);   // [] when there is nothing to say
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */

export interface CrewDefWarning {
  /** Stable, for a caller that acts on it. */
  code: string;
  /** For the person or the AI that wrote the definition: what happens, and the one change that fixes it. */
  message: string;
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function crewDefWarnings(def: unknown): CrewDefWarning[] {
  if (!def || typeof def !== 'object') return [];
  const doc = def as { listen_for?: unknown; agents?: unknown };
  const warnings: CrewDefWarning[] = [];

  const members = Array.isArray(doc.agents) ? doc.agents as Array<{ tools?: unknown } | null> : [];
  const canReply = members.some(m => listOf(m?.tools).includes('dm'));
  if (listOf(doc.listen_for).includes('dms') && !canReply) {
    warnings.push({
      code: 'DM_WITHOUT_REPLY_TOOL',
      message: 'This agent wakes when someone sends it a direct message, and no member of its crew has the dm tool. It reads the message and cannot answer. Give one member the dm tool.',
    });
  }
  return warnings;
}
