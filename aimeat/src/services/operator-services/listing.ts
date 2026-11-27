/**
 * @file src/services/operator-services/listing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GET /v1/operator-services and GET /v1/operator-services/{id}/accounts answer, and
 *   what the MCP tool aimeat_admin_service_access answers with the same functions. Who may read what:
 *     - the operator in person, or an operator's agent holding operator:admin (the word every operator
 *       read tool asks): every entry, with how many accounts are active, removed and pending, and the
 *       operator's own account's state;
 *     - anyone else of this node: the enabled entries, each with the caller's own account's state;
 *     - the accounts of one entry: the operator in person, an operator's agent holding operator:admin,
 *       or that entry's own credential agent holding operator:service-provision (never another
 *       entry's). Names only what the service needs to enrol: the account name and GHII, the state
 *       and its time.
 *   A visitor from another node is refused every one of them. askOperator() asks the account as well
 *   as the word, so a non-operator's agent holding either word string is no operator here.
 *
 *   STATES AND POLICY. A line holds a state; the entry holds the policy, read now. The state the views
 *   name is `operator_off` (the operator's switch for that account), `active`, `removed` (the person
 *   turned it off; read as `pending` while the entry is required, since the next request sets the
 *   agent up again) or `pending`. Both views carry `required`, `private_read`, `private_read_reason`
 *   and `how_to_help`; the operator's view also `audience` and counts per state over the people in the
 *   audience; the person's view `in_audience` and `may_turn_off`, and lists an entry outside their
 *   audience only while they still have a line in it. The accounts route lists the audience only.
 * @structure ACCOUNTS_PAGE_DEFAULT · ACCOUNTS_PAGE_MAX · ServiceCaller · AccessRefusal · AccountState ·
 *   stateOf · policyView · operatorServicesView · operatorServiceAccounts
 * @usage const out = await operatorServicesView({ storage, config }, caller);
 * @version-history
 *   v1.6.0 — 2026-11-27 — The operator's switch is read back: `by` and `reason` per account in state
 *     operator_off (with `at`), and the person's `operator_off_reason` (B2).
 *   v1.5.0 — 2026-11-26 — Phase 2: the audience, `operator_off`, required, the private read and how to
 *     help, in both views and the accounts route.
 *   v1.4.0 — 2026-11-26 — The operator's reads ask operator:admin, the word of the other operator read
 *     tools: its agent reads the operator view and any entry's accounts. operator:service-provision now
 *     reads only its own entry's accounts.
 *   v1.3.0 — 2026-11-26 — The operator's view carries the operator's own state with each service too
 *     (`state`, `at`, `agent`), as the person's view does, for the Agents page's "turn on again".
 *   v1.2.0 — 2026-11-26 — Both views carry `write_prefixes`.
 *   v1.1.0 — 2026-11-26 — Reads the sharded ledger: one line for a person, every record for a list.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { askOperator, type OperatorCaller } from '../operator/principal.js';
import { nodeColleagues } from '../colleagues.js';
import { parseGaiiLoose, localAccountOf, isForeignPrincipal } from '../../utils/gaii.js';
import { OPERATOR_ADMIN_SCOPE, OPERATOR_SERVICE_PROVISION_SCOPE } from '../../utils/scope-coverage.js';
import { entriesNow, entryById, inAudience, isRequired, privateReadGranted, type ServiceEntryNow } from './entries.js';
import { readLedger, readLine, type LedgerLine } from './ledger.js';

export const ACCOUNTS_PAGE_DEFAULT = 100;
export const ACCOUNTS_PAGE_MAX = 500;

/** The caller as the routes and the MCP tool describe it (CallerContext.auth plus its kind). */
export interface ServiceCaller extends OperatorCaller {
  kind: string;
}

export interface AccessRefusal { ok: false; status: number; code: string; message: string }

type Deps = { storage: Storage; config: AimeatConfig };

/** A person's state with one service, as the routes name it. */
export type AccountState = 'pending' | 'active' | 'removed' | 'operator_off';

/**
 * The state the routes name, from the line (states only) and the entry's PRESENT policy: the
 * operator's switch first; a person's `removed` reads as `pending` while the entry is required,
 * because the next request sets the agent up again.
 */
function stateOf(line: LedgerLine | null | undefined, entry: Pick<ServiceEntryNow, 'required'>): { state: AccountState; at: string | null; agent: string | null } {
  if (line?.operator_off) return { state: 'operator_off', at: line.operator_off.at, agent: null };
  // The person's own off, kept as a flag while the entry was required (S9): off again once it is not.
  if (line?.person_off && !isRequired(entry)) return { state: 'removed', at: line.removed_at ?? line.person_off.at, agent: null };
  if (line?.state === 'active') return { state: 'active', at: line.at, agent: line.gaii };
  if (line?.state === 'removed' && !isRequired(entry)) return { state: 'removed', at: line.removed_at ?? line.at, agent: null };
  return { state: 'pending', at: null, agent: null };
}

/** The policy fields both views carry, read from the present entry. */
function policyView(e: ServiceEntryNow) {
  const privateRead = privateReadGranted(e);
  return {
    required: isRequired(e),
    private_read: privateRead,
    private_read_reason: privateRead ? e.private_read_reason ?? null : null,
    how_to_help: e.how_to_help ?? null,
  };
}

/** The operator in person, or an operator's agent holding operator:admin. */
async function isOperatorReader(storage: Storage, caller: ServiceCaller): Promise<boolean> {
  return (await askOperator(storage, caller, OPERATOR_ADMIN_SCOPE)).ok;
}

const VISITOR: AccessRefusal = { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Operator services are read by the people of this node.' };

/** GET /v1/operator-services: the operator's view of every entry, or a person's own state. */
export async function operatorServicesView(deps: Deps, caller: ServiceCaller) {
  const { storage, config } = deps;
  if (isForeignPrincipal(caller)) return VISITOR;
  const entries = entriesNow(config);
  if (await isOperatorReader(storage, caller)) {
    const people = entries.length ? await nodeColleagues(storage, config.nodeId) : [];
    // The operator is a person of this node too: their own state with each service, so the Agents page
    // can offer them the same "turn on again" as anyone else.
    const self = localAccountOf(caller.owner ?? caller.sub);
    const services = [];
    for (const e of entries) {
      const ledger = await readLedger(storage, config.nodeId, e.id);
      const own = self ? stateOf(ledger[self], e) : { state: 'pending' as const, at: null, agent: null };
      // Counted over the people in the entry's PRESENT audience, one state each.
      const covered = people.filter((p) => inAudience(e, p.ownerName));
      const counts = { covered: covered.length, active: 0, removed: 0, pending: 0, operator_off: 0 };
      for (const p of covered) counts[stateOf(ledger[p.ownerName], e).state]++;
      services.push({
        id: e.id, display_name: e.display_name, description: e.description ?? null,
        credential_agent: e.credential_agent, scopes: e.scopes, allowed_scopes: e.allowedScopes, write_prefixes: e.write_prefixes ?? [],
        enabled: e.enabled, usable: e.usable, problem: e.problem ?? null,
        audience: e.audience ?? 'all', ...policyView(e),
        counts,
        state: own.state, at: own.at, agent: own.agent,
      });
    }
    return { ok: true as const, data: { view: 'operator' as const, services } };
  }
  const account = localAccountOf(caller.owner ?? caller.sub);
  const services = [];
  for (const e of entries.filter((x) => x.enabled)) {
    const line = account ? await readLine(storage, config.nodeId, e.id, account) : null;
    const covered = !!account && inAudience(e, account);
    // An entry that does not cover this person and never did is none of theirs; one that left them
    // (a line remains) stays listed, so they can see what ended.
    if (!covered && !line) continue;
    const own = stateOf(line, e);
    const policy = policyView(e);
    services.push({
      id: e.id, display_name: e.display_name, description: e.description ?? null, scopes: e.allowedScopes,
      // What the service may write in the person's memory as the person, and nothing else.
      write_prefixes: e.write_prefixes ?? [],
      ...policy,
      in_audience: covered,
      state: own.state, at: own.at, agent: own.agent,
      // Why the operator switched it off for this person, in the operator's words; null otherwise.
      operator_off_reason: own.state === 'operator_off' ? line?.operator_off?.reason ?? null : null,
      // Whether DELETE /v1/operator-services/{id}/me is theirs to use: not on a required service, and not
      // while the operator has switched it off for them.
      may_turn_off: covered && !policy.required && own.state !== 'operator_off',
    });
  }
  return { ok: true as const, data: { view: 'person' as const, services } };
}

/**
 * GET /v1/operator-services/{id}/accounts: the accounts the service covers, in account-name order,
 * `limit` at a time after `cursor` (the last account name of the page before).
 */
export async function operatorServiceAccounts(
  deps: Deps, caller: ServiceCaller, id: string, page: { limit?: unknown; cursor?: unknown } = {},
) {
  const { storage, config } = deps;
  if (isForeignPrincipal(caller)) return VISITOR;
  const entry = entryById(config, id);
  const reader = await isOperatorReader(storage, caller);
  const op = reader ? null : await askOperator(storage, caller, OPERATOR_SERVICE_PROVISION_SCOPE);
  const isCredential = !!op?.ok && !op.inPerson && caller.kind === 'agent' && !!entry
    && parseGaiiLoose(caller.sub).agent === entry.credential_agent;
  if (!reader && !isCredential) {
    return { ok: false as const, status: 403, code: 'ACCESS_DENIED',
      message: `The accounts of an operator service are read by the operator or an operator's agent with ${OPERATOR_ADMIN_SCOPE}, or by that service's own agent with ${OPERATOR_SERVICE_PROVISION_SCOPE}.` };
  }
  if (!entry) return { ok: false as const, status: 404, code: 'NOT_FOUND', message: `No operator service ${id} on this node.` };

  const raw = Number(page.limit);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, ACCOUNTS_PAGE_MAX) : ACCOUNTS_PAGE_DEFAULT;
  const cursor = typeof page.cursor === 'string' ? page.cursor : '';
  // Only the accounts in the entry's PRESENT audience: the service enrols no one outside it.
  const people = (await nodeColleagues(storage, config.nodeId))
    .filter((p) => inAudience(entry, p.ownerName))
    .map((p) => ({ account: p.ownerName, ghii: p.ghii }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const after = cursor ? people.filter((p) => p.account > cursor) : people;
  const slice = after.slice(0, limit);
  const ledger = await readLedger(storage, config.nodeId, entry.id);
  const accounts = slice.map((p) => {
    const line = ledger[p.account];
    const s = stateOf(line, entry);
    // The operator's switch: who turned it off, when (`at`) and why, as they wrote it (at most 300 characters).
    const off = s.state === 'operator_off' && line?.operator_off ? { by: line.operator_off.by, reason: line.operator_off.reason ?? null } : {};
    return { account: p.account, ghii: p.ghii, state: s.state, at: s.at, ...off };
  });
  const more = after.length > slice.length;
  return {
    ok: true as const,
    data: { service: entry.id, enabled: entry.enabled, accounts, next_cursor: more ? slice[slice.length - 1].account : null, total: people.length },
  };
}
