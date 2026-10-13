/**
 * @file services/memory-bin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deleting a memory record, and taking it back — the one implementation, so the HTTP
 *   route and the three tool surfaces cannot drift apart on who is allowed to remove what.
 *
 *   WHY A SERVICE RATHER THAN A TOOL CALLING STORAGE. Working out WHICH record a caller means is the
 *   hard half: an owner may delete anything under their own agents, an app grant reaches the same
 *   set only when it says so, and an operator may name someone else's namespace outright. Those
 *   three rules had already been fixed twice on the write path before the read path learned them.
 *   A tool that resolved them a fourth time would be the drift this codebase keeps paying for
 *   (`aimeat_memory_write`: schema locks, write target, provenance — the same defect three times in
 *   one tool), so the tools bring parameters and this brings the rules.
 *
 *   THE BIN, NOT THE DATABASE. `storage.deleteMemory` stamps a tombstone and the record leaves every
 *   read; `services/memory-bin-sweep.ts` removes it once `memoryDeleteGraceDays` has passed. This
 *   node had no delete at all before 2026-09-03 — a value could be emptied, never removed — and the
 *   grace window is how that principle survives having one.
 * @structure MemoryBinRefusal · binRefusal() · deleteMemoryRecord() · restoreMemoryRecord()
 * @usage const out = await deleteMemoryRecord({ storage, config }, { caller, ownerName, key });
 * @version-history
 *   v1.7.0 — 2026-10-13 — The organism namespace rule is asked with the session's scopes, which the
 *     fenced-space rule reads: a session that covers organism:direct removes and puts back a record
 *     of a space that names extensions (ruled by the developer on 2026-10-13).
 *   v1.6.0 — 2026-10-12 — With owner_scope an agent holding memory:write-as-owner deletes and
 *     restores a record stored under its owner's own identity (and memory:write-reserved for a
 *     reserved key), the two words the write under the owner asks. The lookup covered the caller and
 *     the owner's agents only, so the delete answered NOT_FOUND on a record the same agent had
 *     written with owner_scope. NOT_FOUND names the permission when the caller asked for owner_scope
 *     without holding it.
 *   v1.5.0 — 2026-10-11 — Delete and restore tell a private record's change to its owner's streams
 *     only; both were global events.
 *   v1.4.0 — 2026-10-09 — Delete and restore refuse a credential record (secret-records.ts) for every
 *     caller, the owner in person included: 403 SECRET_RECORD naming the record's own route (secrets
 *     audit 2026-10-09, item 10).
 *   v1.3.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2). The service still reads 'operator' from `roles`; the REST caller computes that list with rolesWithOperator.
 *   v1.2.0 — 2026-09-29 — Delete and restore refuse a service-owned key (utils/reserved-keys.ts
 *     SERVICE_OWNED_KEY_PREFIXES, the classification policy) for every caller, the owner and an
 *     operator included: 403 RESERVED_KEY (TARGET-082 review finding 2).
 *   v1.1.0 — 2026-09-24 — Restore asks the two refusals delete asks (A6-12), through one binRefusal():
 *     the organism namespace rule and the append-only guard. It asked neither, so a member who had
 *     left an organism put their own record back into it, and a record binned before its space
 *     became append-only could be put back past the space's write path.
 *   v1.0.0 — 2026-09-03 — Initial, with the delete and restore it exists to hold.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { emitRecordChange } from './event-bus.js';
import { checkDeleteGuard } from './write-guards.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { isServiceOwnedKey, isReservedServerKey, serverWrittenKeyRefusal } from '../utils/reserved-keys.js';
import { isGEAI, localAccountOf } from '../utils/gaii.js';
import { scopeIsCovered, WRITE_AS_OWNER_SCOPE, WRITE_RESERVED_SCOPE } from '../utils/scope-coverage.js';
import { isSecretRecordKey, secretRecordBinRefusal } from './secret-records.js';

export interface MemoryBinDeps { storage: Storage; config: AimeatConfig }

export interface MemoryBinRefusal {
  ok: false;
  code: 'NOT_FOUND' | 'NOT_RESTORABLE' | 'WRITE_CONFLICT' | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'CONSENT_REQUIRED' | 'RESERVED_KEY' | 'SECRET_RECORD';
  message: string;
  /** What the door should answer. 404 for the two original codes, so an old caller reads the same. */
  status?: number;
  /** The write guard's own list, for the door that carries it in `details`. */
  violations?: unknown[];
}
export type MemoryBinOutcome =
  | { ok: true; key: string; ownerGaii: string; restorableUntil: string | null; graceDays: number }
  | MemoryBinRefusal;

export interface MemoryBinRequest {
  /** The principal doing this — a GHII for a person, a GAII for an agent. Recorded as `deletedBy`. */
  caller: string;
  /** The human's account name, for the same-owner reach below. `req.auth.owner` on every principal. */
  ownerName: string;
  key: string;
  /**
   * Look under this owner's OTHER principals when the key is not the caller's own.
   *
   * True for an owner session without asking, because an owner deleting a key their agent wrote is
   * the ordinary case and a 404 there is a lie. Opt-in for everything else: an app the owner
   * authorised could LIST an agent-written key and then fail to remove it, which is how a delete
   * button came to point at a record it could never touch.
   */
  ownerScope?: boolean;
  /** An operator naming somebody else's namespace outright. Callers gate the role themselves. */
  ownerOverride?: string | null;
  /**
   * The caller's roles. The organism namespace check below reads them, and an operator who named
   * `ownerOverride` skips that check the way the admin route always has. A caller that passes
   * `ownerOverride` computes this list with rolesWithOperator (services/operator-override.ts), so
   * 'operator' in it is isOperatorCaller's answer: the operator, or the operator's agent holding
   * operator:admin, as on MCP. Absent means "no roles", which is the safe reading: an unnamed caller
   * is not an operator.
   */
  roles?: string[];
  /**
   * The caller's scopes. With `ownerScope`, an agent reaches a record stored under its owner's own
   * identity only when these carry `memory:write-as-owner` (mayActUnderOwner below). Absent means
   * none, so a caller that does not pass them keeps the reach it had: its own records and the
   * owner's agents'.
   */
  scopes?: string[];
}

/**
 * The account holder's own identity on this node, when the caller is another principal of that
 * account: an agent of it. Null for the account holder in person and for an app grant (both already
 * resolve to that identity), for an ecosystem app (it works in its `eco:` namespace) and for a
 * session of another node (it names no account here).
 */
function ownerIdentityBehind(deps: MemoryBinDeps, req: MemoryBinRequest): string | null {
  if (isGEAI(req.caller)) return null;
  const account = localAccountOf(req.caller);
  if (!account) return null;
  const ownerGhii = `${account}@${deps.config.nodeId}`;
  return ownerGhii === req.caller ? null : ownerGhii;
}

/**
 * Whether these scopes let the caller remove or put back THIS key under the owner's own identity.
 * The two words are the write's (routes/memory/owner-target.ts resolveMcpWriteTarget), so an agent
 * removes under its owner exactly what it may write there: `memory:write-as-owner`, and
 * `memory:write-reserved` as well for a key the server reads and trusts.
 */
function mayActUnderOwner(req: MemoryBinRequest): boolean {
  const scopes = req.scopes ?? [];
  if (!scopeIsCovered(scopes, WRITE_AS_OWNER_SCOPE)) return false;
  return !isReservedServerKey(req.key) || scopes.includes(WRITE_RESERVED_SCOPE);
}

/** Find the record this caller means, across the reach they are entitled to. Null when there is
 *  none — and the caller says NOT_FOUND without distinguishing "not there" from "not yours", which
 *  would turn either route into a way to ask whether somebody else's key exists. */
async function locate(
  deps: MemoryBinDeps, req: MemoryBinRequest, look: (gaii: string) => Promise<boolean>,
): Promise<string | null> {
  const first = req.ownerOverride || req.caller;
  if (await look(first)) return first;
  if (req.ownerOverride || !req.ownerScope) return null;
  // The owner's own identity before the agents, the order every owner-scope read uses
  // (services/owner-memory.ts), so the copy an agent reads with owner_scope is the copy it removes.
  // This lookup was missing until 2026-10-12: an agent that wrote records under its owner with
  // owner_scope could list and rewrite them and was answered NOT_FOUND on deleting them.
  const ownerGhii = ownerIdentityBehind(deps, req);
  if (ownerGhii && mayActUnderOwner(req) && await look(ownerGhii)) return ownerGhii;
  for (const agent of await deps.storage.getAgentsByOwner(req.ownerName)) {
    if (await look(agent.gaii)) return agent.gaii;
  }
  return null;
}

/**
 * What the bin refuses before it looks for anything, on the way in AND on the way out: the organism
 * namespace rule and the append-only guard. Both are about the key and the caller, never about
 * whether the record exists, so answering them first says nothing about somebody else's key.
 *
 * BOTH REFUSALS BELONG HERE, NOT ON ONE DOOR. DELETE /v1/memory/:key ran the organism namespace
 * check as middleware and the append-only write guard inline, and `aimeat_memory_delete` ran
 * neither: it called this function straight and this function asked nothing. So the MCP tool
 * removed a `.latest` or `.version` event out of a workspace whose manifest says create_only, and
 * reached an organism namespace the REST door would have refused. Found by the AI triage of
 * 2026-09-13. And restore asked neither (A6-12), though putting a record back is a write into the
 * same namespace: a member who had left an organism put their record back into it, and a record
 * binned before its space became append-only could be put back past the space's write path.
 */
async function binRefusal(deps: MemoryBinDeps, req: MemoryBinRequest, act: 'delete' | 'restore'): Promise<MemoryBinRefusal | null> {
  // A service-owned key (utils/reserved-keys.ts) is neither deleted nor put back by anyone, the
  // account owner and an operator naming another namespace included. Removing the classification
  // policy switched classification off for its owner without the proposal a person must accept
  // (TARGET-082 review finding 2), and putting an old copy back would restore a policy the person
  // has since changed. Asked first, so it says nothing about whether the record exists.
  if (isServiceOwnedKey(req.key)) {
    const refusal = serverWrittenKeyRefusal(req.key);
    return { ok: false, code: refusal.code, message: refusal.message, status: 403 };
  }
  // A credential record (services/secret-records.ts: the owner's AI keys, the decision model's key, a
  // seller's Stripe key) is neither removed nor put back here, by anyone: the generic write doors
  // already refuse it, and the bin was the way around them. Any principal holding memory:delete
  // could remove the owner's key, and memory:write could put a replaced key back. The owner acts on
  // the record's own route, which the refusal names (secrets audit 2026-10-09, item 10).
  if (isSecretRecordKey(req.key)) {
    const refusal = secretRecordBinRefusal(req.key, act);
    return { ok: false, code: 'SECRET_RECORD', message: refusal.message, status: 403 };
  }
  const operatorOverride = !!req.ownerOverride && (req.roles ?? []).includes('operator');
  if (!operatorOverride) {
    // The session's scopes ride along for the fenced-space rule (services/fenced-space.ts): a session
    // that covers organism:direct removes and puts back a record of a space that names extensions.
    // No value is handed over, so a workspace's manifest record that declares a fence is neither
    // removed nor put back by a caller that may not change one.
    const denied = await checkOrganismNamespaceAccess(deps, {
      principal: req.caller, owner: req.ownerName, roles: req.roles ?? [], scopes: req.scopes,
    }, req.key, 'write');
    if (denied) return { ok: false, code: denied.code, message: denied.message, status: denied.status };
  }

  // An append-only workspace namespace refuses .latest/.version deletes on every path — existing
  // events can never be erased, and that holds for an operator too. Its records are not put back
  // through the bin either: what enters an append-only space enters by its own write path.
  const guard = await checkDeleteGuard(req.key, deps.storage);
  if (!guard.valid) {
    return {
      ok: false, code: 'WRITE_CONFLICT', status: 409,
      message: act === 'delete'
        ? guard.errors?.[0]?.message ?? 'Delete refused by the workspace write guard'
        : 'This record belongs to an append-only space, and a record there is not put back through the bin: it enters by the space\'s own write path.',
      violations: guard.errors,
    };
  }
  return null;
}

/**
 * Into the bin. Answers with the moment it stops being takeable back, which is the one thing a
 * person needs after pressing delete and the one thing a "deleted: true" never told them.
 */
export async function deleteMemoryRecord(deps: MemoryBinDeps, req: MemoryBinRequest): Promise<MemoryBinOutcome> {
  const refused = await binRefusal(deps, req, 'delete');
  if (refused) return refused;

  // Its visibility is read on the way, because it decides who is told the record is gone.
  let visibility: string | undefined;
  const found = await locate(deps, req, async gaii => {
    const record = await deps.storage.getMemory(gaii, req.key);
    if (record) visibility = record.visibility;
    return !!record;
  });
  if (!found) {
    // The hint depends on the caller and the request alone, never on whether a record exists, so it
    // answers no question about the owner's keys. Without it an agent reads NOT_FOUND on a key it
    // has just listed with owner_scope and looks for a platform limit that is not there.
    const needsGrant = !!req.ownerScope && !req.ownerOverride
      && !!ownerIdentityBehind(deps, req) && !scopeIsCovered(req.scopes ?? [], WRITE_AS_OWNER_SCOPE);
    return {
      ok: false, code: 'NOT_FOUND',
      message: `Memory key not found: ${req.key}` + (needsGrant
        ? `. With owner_scope you reach your own records and the other agents' of your owner. A record stored under your owner's own identity also needs the ${WRITE_AS_OWNER_SCOPE} permission, which the owner grants per agent in Profile -> Agents.`
        : ''),
    };
  }
  const deleted = await deps.storage.deleteMemory(found, req.key, req.caller);
  if (!deleted) {
    return { ok: false, code: 'NOT_FOUND', message: `Memory key not found: ${req.key}` };
  }
  // THE VIEW LEARNS FROM HERE, not from each door. The REST route emitted and the MCP tools did
  // not, which is the drift the SSE parity gate exists to catch: the same capability, and only one
  // of its doors told the screen anything. A record only its owner read is told to that owner's
  // streams alone (event-bus.ts emitRecordChange).
  emitRecordChange('memory', found, visibility);
  const graceDays = deps.config.memoryDeleteGraceDays;
  return {
    ok: true, key: req.key, ownerGaii: found, graceDays,
    restorableUntil: graceDays > 0 ? new Date(Date.now() + graceDays * 86_400_000).toISOString() : null,
  };
}

/**
 * Out of the bin.
 *
 * ONE REFUSAL FOR THREE CAUSES, said as the one thing a person can act on: it was never deleted, it
 * was never theirs, or the window closed and it is genuinely gone. Telling the first two apart would
 * answer a question nobody is entitled to ask, and the third is the only one that changes what they
 * do next — so the sentence names it.
 */
export async function restoreMemoryRecord(deps: MemoryBinDeps, req: MemoryBinRequest): Promise<MemoryBinOutcome> {
  // The same two refusals as the delete, asked before the bin is even read (binRefusal says why).
  const refused = await binRefusal(deps, req, 'restore');
  if (refused) return refused;

  // The bin is invisible to getMemory by design, so "is it in there" is a bin read, not a key read.
  let visibility: string | undefined;
  const inBin = async (gaii: string) => {
    const record = (await deps.storage.listDeletedMemory(gaii)).find(r => r.key === req.key);
    if (record) visibility = record.visibility;
    return !!record;
  };
  const found = await locate(deps, req, inBin);
  if (!found || !(await deps.storage.restoreMemory(found, req.key))) {
    return {
      ok: false, code: 'NOT_RESTORABLE',
      message: 'There is nothing of that name waiting to be put back. Either it was never deleted, or it has already been removed for good.',
    };
  }
  emitRecordChange('memory', found, visibility);
  return { ok: true, key: req.key, ownerGaii: found, restorableUntil: null, graceDays: deps.config.memoryDeleteGraceDays };
}
