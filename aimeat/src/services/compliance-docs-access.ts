/**
 * @file src/services/compliance-docs-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read and who may change a compliance document of a scope (plan
 *   doc-mvlftkh9zmc9, decisions 10.1, 10.6 and 10.10), decided once for the REST route and the MCP
 *   tool, as compliance-access.ts does for the AI use-case register.
 *
 *   THE RULE.
 *   - The node's documents: the operator, in person or through something acting for them that holds
 *     the exact word (compliance:read to read, compliance:write to write; no wildcard carries either).
 *   - An organism's: its active members read, its creator and admins write (isOrgManager), as an
 *     organism's classification. The operator reads every organism's, because the node processes
 *     their data, and writes only where they are a manager too. Anyone else gets 404, so an
 *     organism's existence is not told; an agent the organism does not admit, likewise.
 *   - An app's: its owner reads and writes; the operator reads. Anyone else, or an app the owner
 *     does not have, gets 404.
 *   - Anything acting for a person (an agent, an app grant, an ecosystem app) needs the exact word,
 *     whoever it acts for. A person in their own session is asked nothing more than the rule above.
 *   - A visitor from another node gets 403: nothing here is theirs.
 * @structure DocAccess · complianceDocAccess()
 * @usage
 *   const a = await complianceDocAccess(storage, { sub, owner, roles, scopes }, scope, 'write');
 *   if (!a.ok) return res.status(a.status).json(error(nodeId, a.code, a.message));
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1).
 */
import type { Storage } from '../storage/interface.js';
import { isForeignPrincipal, localAccountName } from '../utils/gaii.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE, scopeIsCovered } from '../utils/scope-coverage.js';
import { actsForSomeone, askOperator, type OperatorCaller } from './operator-principal.js';
import { agentBarred } from './organism-agent-access.js';
import { isOrgManager } from './workspace-access.js';
import type { ComplianceScope } from './compliance-docs.js';

export type DocAccess =
  | { ok: true; by: string; operator: boolean; ownerName: string }
  | { ok: false; status: 403 | 404; code: 'SCOPE_DENIED' | 'NOT_ALLOWED' | 'NOT_FOUND' | 'FOREIGN_VISITOR'; message: string };

const NOT_FOUND = (what: string): DocAccess => ({ ok: false, status: 404, code: 'NOT_FOUND', message: `No such ${what}, or it is not one whose compliance documents you may read.` });

export async function complianceDocAccess(
  storage: Storage, caller: OperatorCaller, scope: ComplianceScope, mode: 'read' | 'write',
): Promise<DocAccess> {
  if (isForeignPrincipal(caller)) {
    return { ok: false, status: 403, code: 'FOREIGN_VISITOR', message: 'A visitor from another node reads no compliance documents here.' };
  }
  const word = mode === 'read' ? COMPLIANCE_READ_SCOPE : COMPLIANCE_WRITE_SCOPE;
  if (actsForSomeone(caller) && !scopeIsCovered(caller.scopes ?? [], word)) {
    return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `This needs the "${word}" permission. The person grants it per agent, and "Full access" does not carry it.` };
  }
  const ownerName = localAccountName(caller.owner ?? caller.sub);
  if (!ownerName) return { ok: false, status: 403, code: 'NOT_ALLOWED', message: 'This session has no account to check.' };
  const operator = (await askOperator(storage, caller, word)).ok;
  const yes: DocAccess = { ok: true, by: caller.sub, operator, ownerName };

  if (scope.kind === 'node') {
    return operator ? yes : {
      ok: false, status: 403, code: 'NOT_ALLOWED',
      message: 'These are the compliance documents of the whole installation, and the account behind this session does not run it.',
    };
  }

  if (scope.kind === 'organism') {
    const organism = await storage.getOrganism(scope.organismId);
    if (!organism || agentBarred(organism, caller.sub)) return NOT_FOUND('organism');
    const m = await storage.getMembership(scope.organismId, ownerName);
    const member = !!m && m.status === 'active';
    if (mode === 'read') return member || operator ? yes : NOT_FOUND('organism');
    if (await isOrgManager(storage, scope.organismId, ownerName)) return yes;
    if (member || operator) {
      return { ok: false, status: 403, code: 'NOT_ALLOWED', message: "Only the organism's creator or an admin keeps its compliance documents, in person or through their agent." };
    }
    return NOT_FOUND('organism');
  }

  // An app: its owner's, or read by the operator.
  const mine = scope.ownerName === ownerName;
  if (!mine && !(operator && mode === 'read')) return NOT_FOUND('app');
  const app = await storage.getAppByOwnerName(scope.ownerName, scope.app);
  return app ? yes : NOT_FOUND('app');
}
