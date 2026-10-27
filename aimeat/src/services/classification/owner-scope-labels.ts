/**
 * @file src/services/classification/owner-scope-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The memory:read-as-owner rule (services/owner-scope-read.ts) applied to classification
 *   metadata. The scan, the explorer, the owner-level audit log, the owner-level exceptions list and
 *   the single-key label read cover every identity of one owner: the owner's GHII, every agent and
 *   every ecosystem app. A label row names a record's key, its label, the person's justification and
 *   their own words, and a scan answers which detection rule matched a record's text. So a caller
 *   that may not read a record with owner_scope must not learn these things about it either.
 *
 *   WHO READS EVERYTHING. The same callers as readsAsOwner: the owner in person (an owner-level
 *   personal access token too, as on the memory routes), an app grant of the owner, and a credential
 *   that holds memory:read-as-owner. A detection rule and the node's own classifier are not callers.
 *
 *   WHAT THE OTHERS SEE. Labels on their own content, and labels on another same-owner identity's
 *   memory record or stored file whose visibility admits a same-owner reader (owner, members,
 *   public; visibleToSameOwnerReader). A label on such a record that the caller may not read is left
 *   out, exactly as GET /v1/memory?owner_scope=true leaves the record out. A label row whose record
 *   does not exist (never written, or deleted) is not filtered: there is no record to protect, and
 *   the explorer, the audit log and the exceptions list kept showing such rows to the owner's agents
 *   before this file existed. Organism content and containers (organism, workspace, board, app) are
 *   not personal records and keep their own rules.
 *
 *   COST. Only a caller that does not read everything pays: one record read per distinct item in
 *   another identity's scope, cached for the call. The owner, an app and an agent with the word pay
 *   nothing extra.
 * @structure labelActorReadsAll(actor) · OwnerScopeLabelView · ownerScopeLabelView(storage, actor) ·
 *   READ_AS_OWNER_NOTE (re-exported)
 * @usage
 *   const view = ownerScopeLabelView(deps.storage, actor);
 *   const shown = []; for (const row of rows) if (!(await view.hidden(row))) shown.push(row);
 * @version-history
 *   v1.1.0 — 2026-10-27 — ReadAsOwnerRequired, the refusal of a label write on a hidden record
 *     (secaudit2026oct26).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v76 and v77).
 */
import type { Storage, ContentLabelKind } from '../../storage/interface.js';
import { READ_AS_OWNER_NOTE, visibleToSameOwnerReader } from '../owner-scope-read.js';
import { READ_AS_OWNER_SCOPE, scopeIsCovered } from '../../utils/scope-coverage.js';
import { isOwnerInPerson } from '../../utils/gaii.js';
import { rolesOf, ClassificationError, type LabelActor } from './label-core.js';
import { scopeOwner } from './policy.js';

export { READ_AS_OWNER_NOTE };

/**
 * The refusal of a label write on a record the caller may not read (setLabel, reviewLabel). It
 * carries the permission word, so the REST route answers it with the scope refusal that hands the
 * person the agent's page (auth/deny.ts denyScope403) and the MCP tool with the same ask
 * (mcp/scope-denied-answer.ts). It names no label, source or lock of the record (secaudit2026oct26,
 * classification-labels:label-write-ignores-read-as-owner).
 */
export class ReadAsOwnerRequired extends ClassificationError {
  readonly needed = [READ_AS_OWNER_SCOPE];
  constructor() {
    super('SCOPE_DENIED', 403, `Labelling this record needs the "${READ_AS_OWNER_SCOPE}" permission: the owner or another of their agents keeps it private, and reading it with owner_scope needs the same permission. The owner grants it per agent in Profile -> Agents -> this agent -> permissions -> Memory.`);
  }
}

/**
 * True when this label actor reads every same-owner record, private ones too: the same answer
 * readsAsOwner gives a CallerContext (an app grant, or a caller whose requireScope answer covers
 * memory:read-as-owner, which the owner in person always has). A rule and the node's own classifier
 * are the node itself.
 */
export function labelActorReadsAll(actor: LabelActor): boolean {
  if (actor.kind === 'rule' || actor.nodeOwn) return true;
  const roles = rolesOf(actor);
  // caller-context.ts kindOf: an ecosystem app is never an app grant, whatever else it carries.
  if (roles.includes('app') && !roles.includes('ecosystem')) return true;
  return isOwnerInPerson({ roles }) || scopeIsCovered(actor.scopes ?? [], READ_AS_OWNER_SCOPE);
}

/** What a label row, an audit row or an exception names. */
export interface LabelledItem {
  kind: ContentLabelKind | string;
  scope: string;
  key: string;
}

export interface OwnerScopeLabelView {
  /** The caller reads every same-owner record; `hidden` then always answers false. */
  readonly readsAll: boolean;
  /**
   * True when the item is a memory record or a stored file of another identity of the caller's
   * owner, it exists, and its visibility does not admit a same-owner reader.
   */
  hidden(item: LabelledItem): Promise<boolean>;
}

/** The view for one call. Each record is read at most once per call. */
export function ownerScopeLabelView(storage: Pick<Storage, 'getMemory' | 'getStorageFile'>, actor: LabelActor): OwnerScopeLabelView {
  const readsAll = labelActorReadsAll(actor);
  const seen = new Map<string, Promise<boolean>>();
  return {
    readsAll,
    hidden(item) {
      if (readsAll || (item.kind !== 'memory' && item.kind !== 'file')) return Promise.resolve(false);
      const holder = scopeOwner(item.scope);
      if (!holder || holder === actor.principal) return Promise.resolve(false);
      const id = `${item.kind}\u0000${holder}\u0000${item.key}`;
      let answer = seen.get(id);
      if (!answer) {
        answer = (async () => {
          const rec = item.kind === 'memory'
            ? await storage.getMemory(holder, item.key)
            : await storage.getStorageFile(holder, item.key);
          return !!rec && !visibleToSameOwnerReader({ ownerGaii: holder, visibility: String(rec.visibility) }, actor.principal);
        })();
        seen.set(id, answer);
      }
      return answer;
    },
  };
}
