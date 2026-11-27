/**
 * @file src/services/operator-services/write-fence.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The key fence on an operator service's writes as the person. memory:write-as-owner for
 *   every account with nobody approving is the largest power an entry holds: a service whose credential
 *   leaked could overwrite any record of any person. So an agent an operator service made (the ledger's
 *   proof, ./agent-check.ts) writes under the person's own identity, or another of the person's
 *   principals, only when the key starts with one of the entry's PRESENT `write_prefixes`, read at the
 *   request, so narrowing them binds at once and no sweep is needed. The fence is the entry's: a word
 *   the person adds to that agent later does not lift it while the agent is the service's, and the
 *   person's own agents are never fenced by it. An entry without prefixes fences every such write.
 *
 *   Asked on every path that writes as the owner: POST /v1/memory and the MCP memory write with
 *   owner_scope, PUT /v1/memory/:key reaching another principal's record, the patch service (REST and
 *   MCP), the bin's delete and restore under another principal (REST and MCP), the AI settings write
 *   (POST /v1/ai/settings, aimeat_operator_ai_config), the calibrator's writes and a package's memory
 *   components.
 * @structure OPERATOR_SERVICE_PREFIX_CODE · WriteFenceRefusal · operatorServiceWriteRefusal ·
 *   operatorServiceWholeRefusal · operatorServiceAreaRefusal
 * @usage const fenced = await operatorServiceWriteRefusal(storage, config, principal, key);
 *   if (fenced) return res.status(403).json(error(nodeId, fenced.code, fenced.message));
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services: writes as the person fenced by key, F2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { parseGAII } from '../../utils/gaii.js';
import { isOperatorServiceAgent } from './agent-check.js';

/** The refusal's code. */
export const OPERATOR_SERVICE_PREFIX_CODE = 'OPERATOR_SERVICE_PREFIX';

export interface WriteFenceRefusal { status: 403; code: typeof OPERATOR_SERVICE_PREFIX_CODE; message: string }

type Deps = Pick<AimeatConfig, 'nodeId' | 'operatorServices'>;

/** The present prefixes of the entry whose id is the agent's name; [] when there is none or it names none. */
function prefixesOf(config: Deps, agentName: string): string[] {
  return (config.operatorServices ?? []).find((e) => e.id === agentName)?.write_prefixes ?? [];
}

function refusal(agentName: string, prefixes: readonly string[], what: string): WriteFenceRefusal {
  return {
    status: 403, code: OPERATOR_SERVICE_PREFIX_CODE,
    message: prefixes.length
      ? `The operator service ${agentName} writes in a person's memory only under ${prefixes.map((p) => `"${p}"`).join(', ')}, so ${what} is refused.`
      : `The operator service ${agentName} does not write in a person's memory as the person, so ${what} is refused.`,
  };
}

/**
 * The refusal for `principal` writing `key` outside its own namespace, or null. Null for every
 * principal that is not an agent an operator service made.
 */
export async function operatorServiceWriteRefusal(
  storage: Storage, config: Deps, principal: string, key: string,
): Promise<WriteFenceRefusal | null> {
  const parsed = parseGAII(principal);
  if (!parsed || !(await isOperatorServiceAgent(storage, config, principal))) return null;
  const prefixes = prefixesOf(config, parsed.agent);
  return prefixes.some((p) => key.startsWith(p)) ? null : refusal(parsed.agent, prefixes, `the key "${key}"`);
}

/**
 * For a door whose keys no prefix can name in advance (a package's memory components): the refusal for
 * an agent an operator service made, whatever its prefixes, or null for every other principal.
 */
export async function operatorServiceWholeRefusal(
  storage: Storage, config: Deps, principal: string, what: string,
): Promise<WriteFenceRefusal | null> {
  const parsed = parseGAII(principal);
  if (!parsed || !(await isOperatorServiceAgent(storage, config, principal))) return null;
  return refusal(parsed.agent, prefixesOf(config, parsed.agent), what);
}

/**
 * For a door that writes a whole area of keys at once (the calibrator's `calibrator.` records): the
 * refusal unless one present prefix covers every key under `area`, or null.
 */
export async function operatorServiceAreaRefusal(
  storage: Storage, config: Deps, principal: string, area: string,
): Promise<WriteFenceRefusal | null> {
  const parsed = parseGAII(principal);
  if (!parsed || !(await isOperatorServiceAgent(storage, config, principal))) return null;
  const prefixes = prefixesOf(config, parsed.agent);
  return prefixes.some((p) => area.startsWith(p)) ? null : refusal(parsed.agent, prefixes, `a write under "${area}"`);
}
