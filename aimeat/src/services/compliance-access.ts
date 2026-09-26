/**
 * @file src/services/compliance-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read and who may change the node's compliance surface — the decision itself,
 *   in one place, so the HTTP door and the MCP tools cannot come to answer it differently.
 *
 *   WHY THIS EXISTS RATHER THAN A CHECK INSIDE EACH DOOR. The tool surface asking storage its own
 *   question is how 315 measured differences opened up between MCP and REST, and the compliance
 *   report is the worst possible place for the 316th: the read hands over every account's AI
 *   activity in one document. `aimeat/no-storage-in-mcp` refuses that shape outright, and it is
 *   right to.
 *
 *   THE TWO QUESTIONS, IN ORDER. Is the ACCOUNT behind this principal an operator, and does the
 *   principal carry this exact word. Account first, because the word means nothing on an account
 *   that does not run the node, and answering in the other order would leak whether a scope exists.
 *
 *   THE WORD IS DEMANDED BY WHO THE CALLER IS, NOT BY WHAT IT CARRIES. The first version demanded
 *   the scope only from callers whose scope list was non-empty, meaning it to exempt the operator
 *   in person (owner and PAT sessions arrive with an empty list) — but an agent with ZERO granted
 *   words arrives with an empty list too, so the emptiest principal passed the gate the fullest one
 *   was held at, and requireOperatorPrincipal() (the HTTP half of this pair) refused the same
 *   caller. The test is now the principal's SHAPE: a delegated identity (GAII or GEAI) must carry
 *   the exact word however short its list; a bare owner GHII is the person and is asked nothing.
 *   Audit AI-triage 2026-08-23, invariant 13.
 * @structure
 *   - ComplianceCaller — the caller as both doors can describe it
 *   - complianceRefusal(storage, caller, scope) — null when allowed, the sentence when not
 * @usage
 *   const refusal = await complianceRefusal(storage, { gaii, scopes }, COMPLIANCE_READ_SCOPE);
 *   if (refusal) return refuse(refusal);
 * @version-history
 *   v1.2.1 — 2026-09-26 — The identity check names the account with localAccountName (utils/gaii.ts),
 *     the one cut of an identity to an account name (secaudit 2026-09, F-1). Nothing it answers changed.
 *   v1.2.0 — 2026-09-24 — The decision is services/operator-principal.ts askOperator(), the one
 *     operator question every door asks; this file keeps its sentences. Nothing it answers changed.
 *   v1.1.0 — 2026-08-23 — SECURITY (audit AI-triage, invariant 13): the scope demand keys on the
 *     principal's shape (delegated GAII/GEAI vs the person's bare GHII), not on whether the scope
 *     list happens to be empty — a zero-scope agent of an operator passed the old gate.
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { askOperator } from './operator-principal.js';

export interface ComplianceCaller {
  /** The principal as it identifies itself: a GAII, a GEAI, or a bare owner GHII. */
  gaii: string;
  /** The granted scopes. Empty for an operator session in person; populated for everything else. */
  scopes?: string[];
}

/**
 * `null` when the caller may proceed, otherwise the sentence to give them.
 *
 * A sentence rather than a code, because both callers put it in front of a person or an agent that
 * has to decide what to do next, and "ACCESS_DENIED" tells neither of them anything.
 */
export async function complianceRefusal(
  storage: Storage, caller: ComplianceCaller, scope: string,
): Promise<string | null> {
  const ownerName = localAccountName(caller.gaii);
  if (!ownerName) {
    return 'This is for whoever runs this installation, and this session has no identity to check.';
  }
  // The operator question, asked the one way every door asks it (services/operator-principal.ts):
  // the account first, then the exact word from anything acting for it. A delegated principal, an
  // agent (GAII) or an ecosystem app (GEAI), must carry the word however short its grant list; only
  // the bare owner GHII is the operator in person.
  const answer = await askOperator(storage, { sub: caller.gaii, scopes: caller.scopes ?? [] }, scope);
  if (answer.ok) return null;
  if (answer.why === 'needs-word') {
    return `This needs the "${scope}" permission. Whoever runs this installation grants it per agent, `
      + 'and "Full access" does not carry it.';
  }
  return 'This is the compliance report for the whole installation. The account behind this session does not run it.';
}
