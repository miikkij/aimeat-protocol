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
 *   v1.1.0 — 2026-09-24 — Restore asks the two refusals delete asks (A6-12), through one binRefusal():
 *     the organism namespace rule and the append-only guard. It asked neither, so a member who had
 *     left an organism put their own record back into it, and a record binned before its space
 *     became append-only could be put back past the space's write path.
 *   v1.0.0 — 2026-09-03 — Initial, with the delete and restore it exists to hold.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { checkDeleteGuard } from './write-guards.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';

export interface MemoryBinDeps { storage: Storage; config: AimeatConfig }

export interface MemoryBinRefusal {
  ok: false;
  code: 'NOT_FOUND' | 'NOT_RESTORABLE' | 'WRITE_CONFLICT' | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'CONSENT_REQUIRED';
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
   * The caller's roles as the token carries them. The organism namespace check below reads them,
   * and an operator who named `ownerOverride` skips that check the way the admin door always has.
   * Absent means "no roles", which is the safe reading: an unnamed caller is not an operator.
   */
  roles?: string[];
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
  const operatorOverride = !!req.ownerOverride && (req.roles ?? []).includes('operator');
  if (!operatorOverride) {
    const denied = await checkOrganismNamespaceAccess(deps, {
      principal: req.caller, owner: req.ownerName, roles: req.roles ?? [],
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

  const found = await locate(deps, req, async gaii => !!(await deps.storage.getMemory(gaii, req.key)));
  if (!found) {
    return { ok: false, code: 'NOT_FOUND', message: `Memory key not found: ${req.key}` };
  }
  const deleted = await deps.storage.deleteMemory(found, req.key, req.caller);
  if (!deleted) {
    return { ok: false, code: 'NOT_FOUND', message: `Memory key not found: ${req.key}` };
  }
  // THE VIEW LEARNS FROM HERE, not from each door. The REST route emitted and the MCP tools did
  // not, which is the drift the SSE parity gate exists to catch: the same capability, and only one
  // of its doors told the screen anything.
  emitChange('memory');
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
  const inBin = async (gaii: string) => (await deps.storage.listDeletedMemory(gaii)).some(r => r.key === req.key);
  const found = await locate(deps, req, inBin);
  if (!found || !(await deps.storage.restoreMemory(found, req.key))) {
    return {
      ok: false, code: 'NOT_RESTORABLE',
      message: 'There is nothing of that name waiting to be put back. Either it was never deleted, or it has already been removed for good.',
    };
  }
  emitChange('memory');
  return { ok: true, key: req.key, ownerGaii: found, restorableUntil: null, graceDays: deps.config.memoryDeleteGraceDays };
}
