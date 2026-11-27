/**
 * @file src/services/operator-services/marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which of a person's agents an operator service set up: the agent list answer
 *   (GET /v1/agents) carries `set_by_operator: { service, display_name, description, required,
 *   private_read, private_read_reason, how_to_help, given }` for each, read from the service's ledger rather than from the
 *   agent's `registeredBy`, which names the credential agent and is cleared when that agent is deleted.
 *   One ledger read per entry whose id is the name of one of the listed agents; none on a node without
 *   operator services.
 *
 *   `required` is the entry's PRESENT value (only the operator removes or limits the agent while it is
 *   true). `private_read` says the agent holds memory:read-as-owner BECAUSE the entry gave it: the
 *   word is in the line's `given`, the record of what the service gave, and the entry still names it
 *   with its reason (services/operator-services/entries.ts privateReadGranted). A word the person added
 *   themselves is not counted.
 * @structure SetByOperator · operatorServiceMarks
 * @usage const marks = await operatorServiceMarks(storage, config, owner, agents);
 * @version-history
 *   v1.5.0 — 2026-11-27 — `given`: the words the entry gave this agent, from the ledger line.
 *   v1.4.0 — 2026-11-26 — `how_to_help`, so the agent card needs no second request.
 *   v1.3.0 — 2026-11-26 — `required`, `private_read` and `private_read_reason` (operator services phase 2).
 *   v1.2.0 — 2026-11-26 — `set_by_operator` carries the operator's `description`, so a person's AI answers
 *     what the agent is from the agent list alone (GET /v1/agents, aimeat_agents_list).
 *   v1.1.0 — 2026-11-26 — One line read per entry, and the proof decides (security review, D2).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { PRIVATE_READ_WORD } from '../../config/operator-services.js';
import { readLine } from './ledger.js';
import { isServicesAgent } from './proof.js';
import { isRequired, privateReadGranted } from './entries.js';

/** `description`: the operator's own sentence, what the service does for the person and why it is on. */
export interface SetByOperator {
  service: string; display_name: string; description: string;
  /** The entry is required now: the person sees the agent, and only the operator removes or limits it. */
  required: boolean;
  /** The agent reads the person's private records because the entry gave it memory:read-as-owner. */
  private_read: boolean;
  /** Why, in the operator's words, when `private_read`; otherwise null. */
  private_read_reason: string | null;
  /** How the person can help the service, in the operator's words; null when the entry has none. */
  how_to_help: string | null;
  /**
   * The words the ledger says the entry gave this agent (the line's `given`, the list the sweep narrows
   * by and a re-approval rebuilds), so a page can mark exactly those; the agent's other words are the person's.
   */
  given: string[];
}

/** GAII → the service that set it up, for the agents of `owner` an operator service made. */
export async function operatorServiceMarks(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'operatorServices'>, owner: string,
  agents: readonly Pick<AgentRecord, 'name' | 'gaii' | 'createdAt' | 'publicKey' | 'registeredBy'>[],
): Promise<Map<string, SetByOperator>> {
  const out = new Map<string, SetByOperator>();
  const names = new Set(agents.map((a) => a.name));
  for (const e of (config.operatorServices ?? []).filter((x) => names.has(x.id))) {
    const line = await readLine(storage, config.nodeId, e.id, owner);
    const agent = line?.state === 'active' ? agents.find((a) => a.gaii === line.gaii) : undefined;
    // The proof decides, so a person's own agent under the service's name is never marked as the operator's.
    if (!line || !agent || !isServicesAgent(line, agent)) continue;
    const privateRead = privateReadGranted(e) && (line.given ?? []).includes(PRIVATE_READ_WORD);
    out.set(line.gaii, {
      service: e.id, display_name: e.display_name, description: e.description ?? '',
      required: e.enabled && isRequired(e),
      private_read: privateRead,
      private_read_reason: privateRead ? e.private_read_reason ?? null : null,
      how_to_help: e.how_to_help ?? null,
      // A line from before `given` was kept counts the entry's words as given, as the sweep reads it.
      given: [...(line.given ?? e.scopes)],
    });
  }
  return out;
}
