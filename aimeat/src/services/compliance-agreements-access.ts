/**
 * @file src/services/compliance-agreements-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read and who may act on a data processing agreement (plan doc-mvmr4i2wdk0p).
 *   Decided once for the REST routes and the MCP tool.
 *
 *   TWO KINDS OF CALLER.
 *   - The operator, who keeps the node's agreements: the same rule as the node's compliance documents
 *     (compliance-docs-access.ts, node scope), so compliance:read to read and compliance:write to act,
 *     which no wildcard carries, for anything acting for them.
 *   - The counterparty, when it has an account on this node (`counterparty.account`): that person, in
 *     their own session, or something acting for them that holds the same word. They read their own
 *     agreements, sign, send a signed copy back and object to a change; they never edit one.
 *   Anyone else is told the agreement does not exist (404), so its existence is not told.
 * @structure AgreementRole · operatorAccess() · counterpartyHolds() · agreementAccess() · ownerGhiiOf()
 * @usage const who = await agreementAccess(deps, caller, agreement, 'read');
 * @version-history
 *   2026-10-27 — The counterparty is the account that held the name when the operator named it
 *     (counterpartyHolds); a later holder of a released name gets 404 (secaudit2026oct26,
 *     compliance-agreements:counterparty-bound-by-reusable-account-name).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isForeignPrincipal, localAccountName } from '../utils/gaii.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE, scopeIsCovered } from '../utils/scope-coverage.js';
import { actsForSomeone, type OperatorCaller } from './operator-principal.js';
import { complianceDocAccess } from './compliance-docs-access.js';
import type { Agreement } from './compliance-agreements-schemas.js';
import { heldSince } from './account-instance.js';

type Deps = { storage: Storage; config: AimeatConfig };

export class AgreementError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'AgreementError'; }
}

export type AgreementRole = { role: 'operator' | 'counterparty'; by: string; ownerGhii: string };

/** The account behind a caller, as name@node. */
export function ownerGhiiOf(caller: OperatorCaller, nodeId: string): string | null {
  const name = localAccountName(caller.owner ?? caller.sub);
  return name ? `${name}@${nodeId}` : null;
}

/** The operator, or a refusal. */
export async function operatorAccess(deps: Deps, caller: OperatorCaller, mode: 'read' | 'write'): Promise<AgreementRole> {
  const a = await complianceDocAccess(deps.storage, caller, { kind: 'node' }, mode);
  if (!a.ok) throw new AgreementError(a.status, a.code, a.message);
  return { role: 'operator', by: a.by, ownerGhii: ownerGhiiOf(caller, deps.config.nodeId) ?? a.by };
}

/**
 * Whether the account that holds `counterparty.account` now is the one the operator named: registered
 * at or before the naming. A name is released for reuse when its account is erased, and a later holder
 * is not the counterparty (secaudit2026oct26). An agreement from before the naming time was kept is
 * dated by its latest 'created' or 'edited' history entry, the last moment the operator could have
 * named the account.
 */
export async function counterpartyHolds(storage: Storage, a: Agreement): Promise<boolean> {
  if (!a.counterparty.account) return false;
  const named = a.counterpartyNamedAt
    ?? a.history.filter(h => h.event === 'created' || h.event === 'edited').map(h => h.at).sort().pop()
    ?? a.createdAt;
  return heldSince(storage, a.counterparty.account, named);
}

/** The operator or this agreement's counterparty, or 404. */
export async function agreementAccess(deps: Deps, caller: OperatorCaller, a: Agreement, mode: 'read' | 'write'): Promise<AgreementRole> {
  if (isForeignPrincipal(caller)) throw new AgreementError(403, 'FOREIGN_VISITOR', 'A visitor from another node reads no agreements here.');
  const ownerGhii = ownerGhiiOf(caller, deps.config.nodeId);
  if (a.counterparty.account && ownerGhii === a.counterparty.account && await counterpartyHolds(deps.storage, a)) {
    const word = mode === 'read' ? COMPLIANCE_READ_SCOPE : COMPLIANCE_WRITE_SCOPE;
    if (actsForSomeone(caller) && !scopeIsCovered(caller.scopes ?? [], word)) {
      throw new AgreementError(403, 'SCOPE_DENIED', `This needs the "${word}" permission. The person grants it per agent, and "Full access" does not carry it.`);
    }
    return { role: 'counterparty', by: caller.sub, ownerGhii };
  }
  const op = await complianceDocAccess(deps.storage, caller, { kind: 'node' }, mode);
  if (op.ok) return { role: 'operator', by: op.by, ownerGhii: ownerGhii ?? op.by };
  if (op.code === 'SCOPE_DENIED') throw new AgreementError(op.status, op.code, op.message);
  throw new AgreementError(404, 'NOT_FOUND', 'No such agreement, or it is not one of yours.');
}
