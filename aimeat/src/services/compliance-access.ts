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
 *   AN OPERATOR IN PERSON CARRIES NO SCOPE LIST. Owner and PAT sessions arrive with an empty one, so
 *   the word is demanded only from principals that HAVE a list — which is exactly the set that is
 *   acting on somebody's behalf. Same rule as requireOperatorPrincipal() in auth/middleware.ts,
 *   which is the HTTP half of this pair.
 * @structure
 *   - ComplianceCaller — the caller as both doors can describe it
 *   - complianceRefusal(storage, caller, scope) — null when allowed, the sentence when not
 * @usage
 *   const refusal = await complianceRefusal(storage, { gaii, scopes }, COMPLIANCE_READ_SCOPE);
 *   if (refusal) return refuse(refusal);
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

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
  const parsed = parseGAII(caller.gaii);
  const ownerName = parsed?.owner ?? caller.gaii.split('@')[0];
  if (!ownerName) {
    return 'This is for whoever runs this installation, and this session has no identity to check.';
  }
  const owner = await storage.getOwner(ownerName);
  if (!owner?.roles.includes('operator')) {
    return 'This is the compliance report for the whole installation. The account behind this session does not run it.';
  }
  const scopes = caller.scopes ?? [];
  // scopeIsCovered() rather than includes(): it is the one place that knows these words are outside
  // every wildcard, and restating that rule is how three copies of it came to disagree in
  // auth/middleware.ts.
  if (scopes.length && !scopeIsCovered(scopes, scope)) {
    return `This needs the "${scope}" permission. Whoever runs this installation grants it per agent, `
      + 'and "Full access" does not carry it.';
  }
  return null;
}
