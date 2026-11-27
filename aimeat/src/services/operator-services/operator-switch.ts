/**
 * @file src/services/operator-services/operator-switch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's switch for one operator service and one account:
 *   PUT /v1/operator-services/{id}/accounts/{account} { on, reason? }, and the actions `account_off`
 *   and `account_on` of the MCP tool aimeat_admin_service_access, which call this function.
 *
 *   WHO. The operator in person, or an operator's agent holding operator:admin (askOperator). Never an
 *   entry's credential agent, whatever words it holds: the service does not decide whom it reaches.
 *   Never a visitor from another node.
 *
 *   OFF. The line gets `operator_off` { at, by, reason? } in one compare-and-set that answers the line
 *   it replaced, and from then on no approval reserves it (ledger.ts reserve). When the replaced line
 *   named the service's agent (the proof matches the live agent, ./proof.ts), that agent is ended as
 *   the sweep ends one (./sweep.ts endAgent): credentials first, then removeAgent. The state becomes
 *   `ended`, or stays `removed` when the person had turned it off: neither clears the other. A failure
 *   after the flag leaves a line the sweep ends at the next run (an `ended` line with a live agent).
 *
 *   ON. Only the flag goes: the state stays `ended` (the service may ask again) or `removed` (the
 *   person's off is not overridden).
 *
 *   Each switch is one operator action in the person's account feed and one operator-services event.
 * @structure SwitchCaller · setServiceForAccount
 * @usage const out = await setServiceForAccount(deps, caller, 'desk-helper', 'alice', { on: false, reason });
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { askOperator } from '../operator/principal.js';
import { recordOperatorAction } from '../operator/access-audit.js';
import { isActiveLocalPerson } from '../colleagues.js';
import { emitChange } from '../event-bus.js';
import { buildGAII, isForeignPrincipal, parseGaiiLoose, ownerGhiiOf } from '../../utils/gaii.js';
import { OPERATOR_ADMIN_SCOPE } from '../../utils/scope-coverage.js';
import { entriesNow, entryById } from './entries.js';
import { setOperatorOff, clearOperatorOff } from './ledger.js';
import { isServicesAgent } from './proof.js';
import { endAgent } from './sweep.js';
import { announceOperatorServices } from './events.js';
import type { ServiceCaller } from './listing.js';
import { CREDENTIAL_SWITCH_REFUSAL } from './config-write.js';

/** The caller, as the route and the MCP tool describe it (CallerContext.auth plus its kind and principal). */
export interface SwitchCaller extends ServiceCaller {
  /** The exact principal that acts (resolveIdentity): the operator's GHII, or their agent's GAII. */
  principal: string;
}

type Deps = { storage: Storage; config: AimeatConfig; closeMcpSessions?: (gaii: string) => number };

const REASON_MAX = 300;
const ACCOUNT = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const refuse = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });

/** The operator turns service `id` off (`on: false`) or back on for `account`. */
export async function setServiceForAccount(
  deps: Deps, caller: SwitchCaller, id: string, account: string, input: { on?: unknown; reason?: unknown },
) {
  const { storage, config } = deps;
  if (isForeignPrincipal(caller)) return refuse(403, 'ACCESS_DENIED', 'Operator services are switched by the operators of this node.');
  const op = await askOperator(storage, caller, OPERATOR_ADMIN_SCOPE);
  if (!op.ok) {
    return refuse(403, 'ACCESS_DENIED', `Switching an operator service for one account is the operator's, or an operator's agent's with ${OPERATOR_ADMIN_SCOPE}.`);
  }
  // A credential agent of any entry is the service itself: it does not decide whom it reaches.
  const agentName = caller.kind === 'agent' ? parseGaiiLoose(caller.sub).agent : '';
  if (agentName && entriesNow(config).some((e) => e.credential_agent === agentName)) {
    return refuse(403, 'ACCESS_DENIED', CREDENTIAL_SWITCH_REFUSAL);
  }
  if (typeof input.on !== 'boolean') return refuse(400, 'INVALID_INPUT', 'Send on: true to switch the service back on for the account, or on: false to switch it off.');
  if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > REASON_MAX)) {
    return refuse(400, 'INVALID_INPUT', `reason is text of at most ${REASON_MAX} characters.`);
  }
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : undefined;
  const entry = entryById(config, id);
  if (!entry) return refuse(404, 'NOT_FOUND', `No operator service ${id} on this node.`);
  if (!ACCOUNT.test(account) || !(await isActiveLocalPerson(storage, config.nodeId, `${account}@${config.nodeId}`))) {
    return refuse(404, 'NOT_FOUND', `No account ${account} on this node.`);
  }

  const gaii = buildGAII(entry.id, account, config.nodeId);
  let agentEnded = false;
  let changed: boolean;
  if (input.on === false) {
    // The flag first: from this moment no approval reserves the line.
    const c = await setOperatorOff(storage, config.nodeId, entry.id, account, gaii, caller.principal, reason);
    changed = c.changed;
    const before = c.before;
    if (before && (before.state === 'active' || before.state === 'pending')) {
      const agent = await storage.getAgent(before.gaii);
      if (agent && isServicesAgent(before, agent)) {
        await endAgent({ storage, config, closeMcpSessions: deps.closeMcpSessions, actor: caller.principal }, account, before.gaii, entry.id);
        agentEnded = true;
      }
    }
  } else {
    changed = (await clearOperatorOff(storage, config.nodeId, entry.id, account)).changed;
  }

  if (changed) {
    await recordOperatorAction(storage, config, {
      operatorGhii: `${op.name}@${config.nodeId}`, actorGaii: caller.principal, ownerOf: `${account}@${config.nodeId}`,
      area: 'operator-service', action: input.on ? 'account-on' : 'account-off', subject: entry.id,
      data: { ...(reason ? { reason } : {}), ...(agentEnded ? { agent_ended: 'true' } : {}) },
    });
    emitChange('agents', ownerGhiiOf(gaii));
    await announceOperatorServices(storage, config);
  }
  return {
    ok: true as const,
    data: { service: entry.id, account, on: input.on, changed, agent_ended: agentEnded, ...(reason && !input.on ? { reason } : {}) },
  };
}
