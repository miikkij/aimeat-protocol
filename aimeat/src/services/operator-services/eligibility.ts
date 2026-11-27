/**
 * @file src/services/operator-services/eligibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether POST /v1/agents/device-authorize approves a request at once because an
 *   operator service asks for a person's agent (agents.operator_services). It approves only when ALL
 *   hold:
 *     - the caller is an agent, and askOperator(…, 'operator:service-provision') says yes: an agent of
 *       an operator account that holds the exact word, and not itself an agent an operator service
 *       made (./agent-check.ts: such an agent is never an approver);
 *     - an entry exists whose `id` is the requested agent name and whose `credential_agent` is the
 *       caller's agent name, and it is enabled and its words pass the node now;
 *     - every requested word is one of the entry's words;
 *     - the named account is an active local person (services/colleagues.ts isActiveLocalPerson);
 *     - the account is in the entry's PRESENT audience ("all", or its list of accounts);
 *     - the operator has not switched the service off for that account (`operator_off` on the line);
 *     - the service's ledger does not say `removed` for that person, unless the entry is required now:
 *       then the approval goes on and tells the person it is required (`requiredNow`);
 *     - an agent of that name under that person, when there is one, is the one this service made: the
 *       line's proof matches the live agent (./proof.ts), never a person's own agent that shares the
 *       name.
 *   Otherwise the request falls through to the existing behaviour, and `note` says which condition
 *   failed. The checks about the caller come first and have their own words; every check about the
 *   named account answers one sentence, so a refusal tells nothing about another account's state.
 *   A line that says active while its agent is gone or is a different agent is answered with that
 *   sentence and repaired to `ended` (`repair` in the facts). Another approval for the same person in
 *   progress (a fresh reservation) is `busy`: the route answers 409 before anything is written.
 *
 *   decideProvision() is pure, for the unit test; provisionFacts() reads what it needs.
 * @structure ProvisionFacts · ProvisionDecision · ProvisionAuth · ACCOUNT_NOTE · SERVICE_AGENT_NOTE ·
 *   decideProvision · provisionFacts · operatorServiceDecision
 * @usage const d = await operatorServiceDecision(deps, { auth, agentName, ownerName, requested });
 * @version-history
 *   v1.3.1 — 2026-11-27 — ACCOUNT_NOTE says nothing was stored and where the answer is decided; it no
 *     longer points to an approval, since no request is kept.
 *   v1.3.0 — 2026-11-27 — A refusal of an entry's own credential asking for its own name carries `own`, so
 *     the route answers 403 OPERATOR_SERVICE_REFUSED and stores nothing.
 *   v1.2.0 — 2026-11-26 — The audience, the operator's per-account switch, and `required` over a person's
 *     off, all read from the present entry (operator services phase 2).
 *   v1.1.0 — 2026-11-26 — The proof (D2), the reservation (`busy`, D5), the repair of a line whose agent
 *     is not the service's, and the refusal of a caller that is itself a service's agent (D1b).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerKind } from '../caller-context.js';
import { askOperator, type OperatorAnswer } from '../operator/principal.js';
import { isActiveLocalPerson } from '../colleagues.js';
import { buildGAII, parseGaiiLoose } from '../../utils/gaii.js';
import { OPERATOR_SERVICE_PROVISION_SCOPE } from '../../utils/scope-coverage.js';
import { entriesNow, inAudience, isRequired, type ServiceEntryNow } from './entries.js';
import { readLine, markEnded, RESERVATION_TTL_MS, type LedgerLine } from './ledger.js';
import { isServicesAgent } from './proof.js';
import { isOperatorServiceAgent } from './agent-check.js';

/** What decideProvision() needs to know. */
export interface ProvisionFacts {
  /** The caller is an agent (CallerContext.kind). */
  callerIsAgent: boolean;
  /** The caller is itself an agent an operator service made: never an approver. */
  callerIsServiceAgent: boolean;
  /** askOperator's answer for operator:service-provision. */
  operator: OperatorAnswer;
  /** The caller's agent name, from its GAII. */
  callerAgentName: string | null;
  /** The requested agent name. */
  agentName: string;
  /** The setting's entries, as the node reads them now. */
  entries: ServiceEntryNow[];
  /** The words the request names, or undefined when it names none. */
  requested: string[] | undefined;
  /** The named account is an active person of this node. */
  ownerActive: boolean;
  /** The person's line in the entry's ledger. */
  line: LedgerLine | null;
  /** An agent of that name already exists under the person, and its GAII. */
  existingGaii: string | null;
  /** That agent is the one the line says the service made (./proof.ts). */
  madeByService: boolean;
  /** Another approval for this person holds a fresh reservation. */
  busy: boolean;
  /** The line said the service's agent exists while it is gone or a different agent (repaired to `ended`). */
  stale?: boolean;
  /** The named account's local name, for the entry's audience; absent reads as outside a list audience. */
  account?: string;
}

export type ProvisionDecision =
  /** The request is no operator service's: the branch does not apply and says nothing. */
  | { kind: 'not-service' }
  /**
   * `own`: the caller is a service's credential asking for its own entry's name. Such a request is
   * answered 403 OPERATOR_SERVICE_REFUSED and nothing is stored, so no request waits for the person to
   * approve (routes/agents/device-auth.ts). Any other refusal keeps the ordinary pending request.
   */
  | { kind: 'refused'; note: string; own?: boolean }
  /** Another approval for the same person is in progress: ask again in a moment. */
  | { kind: 'busy' }
  /**
   * `line`: the person's line as read, which the approval reserves over. `requiredNow`: the person had
   * turned the service off and the entry is required now, so the approval tells them it is required.
   */
  | { kind: 'approve'; entry: ServiceEntryNow; scopes: string[]; existing: boolean; line: LedgerLine | null; requiredNow: boolean };

/**
 * The one sentence every check about the named account answers. Nothing is stored for such a request
 * (routes/agents/device-auth.ts answers OPERATOR_SERVICE_REFUSED), so it points to no approval, and it
 * names no reason: it says where the answer is decided, the operator's setting and the person's own switch.
 */
export const ACCOUNT_NOTE = 'This operator service cannot set up an agent for that account now, and no request was kept for it. '
  + 'Whether it can is decided by the operator\'s setting of the service (agents.operator_services) and by the person\'s own switch for it; ask again when either changes.';

/** The note for an agent an operator service made, asking for another agent. */
export const SERVICE_AGENT_NOTE = 'An agent an operator service set up does not approve other agents. The account holder can approve this request in their profile under Agents.';

/** The decision itself. Pure: everything it reads is in `f`. */
export function decideProvision(f: ProvisionFacts): ProvisionDecision {
  if (!f.callerIsAgent) return { kind: 'not-service' };
  const named = f.entries.find((e) => e.id === f.agentName);
  const asCredential = f.entries.some((e) => e.credential_agent === f.callerAgentName);
  // A request that names no service and comes from no service's credential is someone else's.
  if (!named && !asCredential) return { kind: 'not-service' };

  if (f.callerIsServiceAgent) return { kind: 'refused', note: SERVICE_AGENT_NOTE };
  if (!f.operator.ok) {
    return { kind: 'refused', note: `Setting up an agent for another account through an operator service needs an operator's own agent with the ${OPERATOR_SERVICE_PROVISION_SCOPE} permission, which this one does not have.` };
  }
  if (!named || named.credential_agent !== f.callerAgentName) {
    return { kind: 'refused', note: `No operator service on this node gives this agent the agent name ${f.agentName}.` };
  }
  // From here the caller is the entry's own credential asking for its own name: every refusal is `own`.
  if (!named.usable) {
    return { kind: 'refused', own: true, note: named.enabled
      ? `The operator service ${named.id} cannot be used now: ${named.problem ?? 'its permissions do not pass this node.'}`
      : `The operator service ${named.id} is switched off.` };
  }
  const scopes = f.requested ?? named.allowedScopes;
  const outside = scopes.filter((s) => !named.allowedScopes.includes(s));
  if (outside.length > 0 || scopes.length === 0) {
    return { kind: 'refused', own: true, note: `The request asks for permissions the operator service ${named.id} may not hold (${outside.join(', ') || 'none named'}).` };
  }

  // The named account: one sentence for every reason, so the refusal tells nothing about the account.
  // The audience and `required` are the entry's PRESENT values; the ledger holds states only.
  if (!f.ownerActive) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  const covered = f.account !== undefined ? inAudience(named, f.account) : inAudience(named, '');
  if (!covered) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  // The operator's own switch for this account holds whatever the entry says.
  if (f.line?.operator_off) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  // The person's off (the state, or the flag a required entry kept) holds unless the entry is required
  // now; the notice that it is required goes once, when the line leaves `removed`.
  const personOff = f.line?.state === 'removed' || !!f.line?.person_off;
  if (personOff && !isRequired(named)) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  const requiredNow = f.line?.state === 'removed' && isRequired(named);
  if (f.busy) return { kind: 'busy' };
  if (f.stale) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  if (f.existingGaii && !f.madeByService) return { kind: 'refused', note: ACCOUNT_NOTE, own: true };
  return { kind: 'approve', entry: named, scopes, existing: !!f.existingGaii, line: f.line, requiredNow };
}

export interface ProvisionAuth {
  /** The caller's kind (CallerContext.kind): only an agent can be an operator service's credential. */
  kind: CallerKind;
  sub: string;
  owner: string;
  roles: readonly string[];
  scopes: readonly string[];
  federated?: boolean;
}

type Deps = { storage: Storage; config: AimeatConfig };

/**
 * Read the facts for one request. Reads the account and the ledger only for a usable request, and
 * repairs a line that says active (or holds a stale reservation) while its agent is not the service's.
 */
export async function provisionFacts(
  deps: Deps,
  input: { auth: ProvisionAuth | null | undefined; agentName: string; ownerName: string; requested: string[] | undefined },
): Promise<ProvisionFacts> {
  const { storage, config } = deps;
  const auth = input.auth;
  const callerIsAgent = auth?.kind === 'agent';
  const entries = entriesNow(config);
  const base: ProvisionFacts = {
    callerIsAgent, callerIsServiceAgent: false, operator: { ok: false, why: 'not-operator' }, callerAgentName: null,
    agentName: input.agentName, entries, requested: input.requested, ownerActive: false, line: null,
    existingGaii: null, madeByService: false, busy: false, account: input.ownerName,
  };
  if (!callerIsAgent || entries.length === 0 || !auth) return base;
  const callerAgentName = parseGaiiLoose(auth.sub).agent || null;
  const relevant = entries.some((e) => e.id === input.agentName || e.credential_agent === callerAgentName);
  if (!relevant) return { ...base, callerAgentName };
  const [operator, callerIsServiceAgent] = await Promise.all([
    askOperator(storage, {
      sub: auth.sub, owner: auth.owner, roles: auth.roles, scopes: auth.scopes,
      ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
    }, OPERATOR_SERVICE_PROVISION_SCOPE),
    isOperatorServiceAgent(storage, config, auth.sub),
  ]);
  const facts: ProvisionFacts = { ...base, callerAgentName, operator, callerIsServiceAgent };
  const named = entries.find((e) => e.id === input.agentName);
  if (callerIsServiceAgent || !operator.ok || !named || named.credential_agent !== callerAgentName || !named.usable) return facts;

  const ghii = `${input.ownerName}@${config.nodeId}`;
  const gaii = buildGAII(input.agentName, input.ownerName, config.nodeId);
  const [ownerActive, line, existing] = await Promise.all([
    isActiveLocalPerson(storage, config.nodeId, ghii),
    readLine(storage, config.nodeId, named.id, input.ownerName),
    storage.getAgent(gaii),
  ]);
  const busy = line?.state === 'pending' && !!line.reserved_at && Date.now() - Date.parse(line.reserved_at) < RESERVATION_TTL_MS;
  const madeByService = !!existing && isServicesAgent(line, existing);
  // A line that says the service's agent exists (active, or a reservation of an agent made before)
  // while that agent is gone or is a different agent: the service gets nothing, and the line is
  // repaired to `ended`. A stale reservation of an agent never made is cleared the same way and the
  // request goes on, as for a person with no line.
  const claimsAgent = !!line && !busy && (line.state === 'active' || (line.state === 'pending' && !!line.proof));
  const staleReservation = !!line && !busy && line.state === 'pending' && !line.proof && !madeByService;
  if ((claimsAgent && !madeByService) || staleReservation) {
    const seen = line!;
    await markEnded(storage, config.nodeId, named.id, input.ownerName,
      (l) => l.state === seen.state && l.at === seen.at && l.nonce === seen.nonce);
  }
  return {
    ...facts, ownerActive, line: staleReservation ? null : line, existingGaii: existing ? existing.gaii : null,
    madeByService, busy, stale: claimsAgent && !madeByService,
  };
}

/** The decision for one device-authorize request. */
export async function operatorServiceDecision(
  deps: Deps,
  input: { auth: ProvisionAuth | null | undefined; agentName: string; ownerName: string; requested: string[] | undefined },
): Promise<ProvisionDecision> {
  return decideProvision(await provisionFacts(deps, input));
}
