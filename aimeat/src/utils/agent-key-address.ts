/**
 * @file src/utils/agent-key-address.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address rule for a memory key under `agents.`: the segment after `agents.` is an
 *   agent's NAME, never its identity. `agents.joker.offers` is read by the offers page, the agent's
 *   own page and the runtime; `agents.joker#alice@node-id.offers` is read by nothing.
 *
 *   WHY. On 2026-10-11 a crew runtime built its keys from the agent's full identity. The node stored
 *   every one of them (`agents.<name>#<owner>@<node>.offers`, `.readme`, `.statistics.…`,
 *   `.tasks.<id>.live`) and answered 201, so the writer logged a published offer and the owner's
 *   offers page showed none. Production held 21 such records under four agents before anybody
 *   looked. A write the node refuses is found at the first call; a write it stores under an address
 *   nothing reads is found when a person misses the result.
 *
 *   WHAT IS REFUSED. A key whose first segment is `agents` and whose second segment holds `#` or
 *   `@`. Neither character can be in an agent name (lowercase letters, digits and hyphens), and both
 *   are in every GAII, so the test has no false positive on a name and needs no parse of the
 *   identity. A node id may contain dots, which would split the identity over several segments; the
 *   `#` is always in the second one, so the test still holds.
 *
 *   WHAT IS NOT. Reading, listing and deleting such a key: the records already written have to stay
 *   reachable so they can be removed. Other prefixes: `@` is ordinary in a key elsewhere (an email
 *   address as a contact's key).
 * @structure identityInAgentKey(key) · agentKeyRefusal(key)
 * @usage
 *   const refusal = agentKeyRefusal(key);
 *   if (refusal) return res.status(400).json(error(config.nodeId, refusal.code, refusal.message));
 * @version-history
 *   v1.0.0 -- 2026-10-11 -- Initial.
 */

const AGENTS_PREFIX = 'agents.';

/**
 * The agent name inside a misaddressed key, or null when the key is addressed correctly or is not an
 * `agents.` key at all. `agents.joker#alice@node.offers` gives `joker`.
 */
export function identityInAgentKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key.startsWith(AGENTS_PREFIX)) return null;
  const rest = key.slice(AGENTS_PREFIX.length);
  const dot = rest.indexOf('.');
  const segment = dot === -1 ? rest : rest.slice(0, dot);
  if (!/[#@]/.test(segment)) return null;
  return segment.split(/[#@]/)[0];
}

/** What a memory write route answers for such a key: 400, with the address that would have worked. */
export function agentKeyRefusal(key: unknown): { code: 'AGENT_KEY_NOT_A_NAME'; message: string } | null {
  const name = identityInAgentKey(key);
  if (name === null) return null;
  const right = name ? `"agents.${name}."` : '"agents.<agent name>."';
  return {
    code: 'AGENT_KEY_NOT_A_NAME',
    message: `The part of this key after "agents." has to be the agent's name alone, and here it holds an identity `
      + `(a "#" or an "@"). Nothing reads a record stored under that address. Write it under ${right} instead: `
      + 'the name is the part of the identity before the "#".',
  };
}
