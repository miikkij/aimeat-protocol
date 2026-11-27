/**
 * @file src/services/operator-services/service-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The key of an agent an operator service made belongs to the service, required or not.
 *   The person's rekey (POST /v1/agents/:gaii/rekey), move (POST /v1/agents/v2/agents/:name/move) and
 *   migration (POST /v1/agents/v2/migrate, which skips it with the reason) would replace that key with
 *   one the person holds: the ledger's proof (./proof.ts) would stop matching, the agent would become
 *   the person's own with every word the entry gave, the required fence would stop applying, and the
 *   service would be refused for that person for good because the name is taken. So each is refused
 *   with 403 OPERATOR_SERVICE_KEY. The service's own reconnect through device authorization stays the
 *   one way its key changes (routes/agents/device-auth-operator-service.ts).
 *
 *   What the person can do instead is in the sentence: remove the agent, which turns the service off
 *   for them (a service that is not required), or ask the operators (a required one).
 *
 *   Signing out one of the agent's sessions is not refused here: on a service that is not required it
 *   is a short form of turning it off, and the service reconnects; on a required one
 *   DELETE /v1/auth/sessions/:id refuses it (./required.ts).
 * @structure OPERATOR_SERVICE_KEY_CODE · ServiceKeyRefusal · serviceNameRefusal · serviceKeyRefusal
 * @usage const refused = await serviceKeyRefusal(storage, config, gaii, 'rotating its key');
 * @version-history
 *   v1.1.0 — 2026-11-27 — serviceNameRefusal: an entry's id is its service's name while the entry exists.
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2, K1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { parseGAII } from '../../utils/gaii.js';
import { isOperatorServiceAgent } from './agent-check.js';
import { entriesNow, isRequired } from './entries.js';
import { OPERATOR_CONTACT } from './required.js';

export const OPERATOR_SERVICE_KEY_CODE = 'OPERATOR_SERVICE_KEY';

export interface ServiceKeyRefusal { ok: false; status: 403; code: typeof OPERATOR_SERVICE_KEY_CODE; message: string }

type Deps = Pick<AimeatConfig, 'nodeId' | 'operatorServices' | 'maxAgentScopes' | 'defaultAgentScopes'>;

/**
 * While an entry with this id exists (enabled or not), its id is its service's agent name: refused to
 * every way of making a NEW agent under it but the operator-service branch (device-authorize, POST
 * /v1/agents, a proposal, an import), so nobody occupies a service's name in advance. Null when the name
 * is no entry's id. A person's own agent that already has the name is not this function's.
 */
export function serviceNameRefusal(config: Pick<AimeatConfig, 'operatorServices'>, name: string): ServiceKeyRefusal | null {
  const entry = (config.operatorServices ?? []).find((e) => e.id === name);
  if (!entry) return null;
  return {
    ok: false, status: 403, code: OPERATOR_SERVICE_KEY_CODE,
    message: `The agent name ${name} belongs to the operator service ${entry.display_name} that the operator of this node set up, and only that service connects an agent under it. Choose another name.`,
  };
}

/** The refusal for doing `what` to the key of agent `gaii` (rotating it, moving it, …), or null when no operator service made it. */
export async function serviceKeyRefusal(storage: Storage, config: Deps, gaii: string, what: string): Promise<ServiceKeyRefusal | null> {
  if (!(await isOperatorServiceAgent(storage, config, gaii))) return null;
  const id = parseGAII(gaii)?.agent ?? '';
  const entry = entriesNow(config).find((e) => e.id === id);
  const name = entry?.display_name ?? id;
  const instead = entry && entry.enabled && isRequired(entry)
    ? `The operator requires ${name}; ask the operators with a message to ${OPERATOR_CONTACT}.`
    : `To stop it, remove the agent: that turns ${name} off for you. You can also ask the operators with a message to ${OPERATOR_CONTACT}.`;
  return {
    ok: false, status: 403, code: OPERATOR_SERVICE_KEY_CODE,
    message: `The operator service ${name} holds this agent's key, so ${what} is not yours to do. ${instead}`,
  };
}
