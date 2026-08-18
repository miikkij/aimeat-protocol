/**
 * @file src/services/workspace-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing one workspace record, and removing one, for every surface that does either.
 *
 *   WHY THIS FILE EXISTS. A workspace draft is a memory record, and it was written two ways. The
 *   browser and the `aimeat connect` bridge write it through POST /v1/memory, which is
 *   services/memory-write.ts. The node's own MCP tools wrote it with a private helper inside
 *   src/mcp/workspaces.ts that called storage.setMemory itself. The two copies agreed on the schema
 *   lock and the provenance stamp and on almost nothing after that: the browser's write fired
 *   Tracked Response evaluation, event-triggered workflows, ecosystem push, automation recipes,
 *   federation replication and the memory change event, while the identical write by that person's
 *   own agent reached storage and stopped there. The August 2026 drift map counted that as one
 *   record-shape and four side-effect differences on `aimeat_workspace_write` alone: a memory
 *   contract watching a draft key never fired when an agent wrote the draft, and an open memory view
 *   did not show the agent's work until a reload.
 *
 *   WHY IT IS NOT services/memory-write.ts. A workspace record obeys a rule a general memory write
 *   must not: ONE owner per key. Current state (`.draft`, `.latest`, the meta records) belongs to the
 *   member's GHII whoever wrote it, and a copy of the same key left under a second identity is
 *   collapsed away, because the workspace read path resolves a key across owners and a forked key
 *   makes it pick between two answers. writeMemoryRecord deliberately leaves both copies standing and
 *   reports the second as `shadowedBy`, so routing this path through it would undo the rule.
 *   services/memory-ceilings.ts and services/workspace-write-guards.ts both say so already; this file
 *   is where the write those two guard actually lives, so the fan-out can be shared even though the
 *   record shape cannot.
 *
 *   The delete is here for the same reason: `aimeat_workspace_object_delete` and
 *   POST /v1/organisms/:id/workspace/records/delete remove the same family of keys under the same
 *   own-or-same-owner rule, and the batch route still carries its own copy of the predicate.
 * @structure
 *   - findWorkspaceRecord() — the freshest record at an exact key, whichever identity owns it
 *   - writeWorkspaceRecord() — the one-owner-per-key write, the fork collapse, and the fan-out
 *   - deleteWorkspaceInstance() — one instance's whole family (bare / .draft / .latest / .version.N)
 * @usage
 *   const prev = await findWorkspaceRecord(storage, key);
 *   await writeWorkspaceRecord({ storage, config }, { key, value, owner: ownerGhii, prev });
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8). The write, the collapse and the family
 *     delete move out of src/mcp/workspaces.ts; the fan-out every other write surface runs
 *     (afterMemoryWrite) comes with them, so an agent's workspace write stops being silent.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { fresherRec, collapseKeyTo } from '../routes/organisms/record-helpers.js';
import { afterMemoryWrite } from './memory-write.js';
import { emitChange } from './event-bus.js';
import { isSameOwner } from '../utils/gaii.js';

export interface WorkspaceWriteDeps {
    storage: Storage;
    config: AimeatConfig;
}

export interface WorkspaceRecordWrite {
    key: string;
    value: unknown;
    /** The identity this key belongs to. One owner per key: content and current state use the
     *  member's GHII, and meta that must stay under a specific identity names it here. */
    owner: string;
    /**
     * The record this write replaces, when the caller already read it. Pass `null` to assert the key
     * is new (a fresh instance, a fresh workspace); leave it out and the lookup happens here.
     */
    prev?: MemoryRecord | null;
    /** The provenance record for THIS value. Attached, never inherited from `prev`: new bytes are a
     *  new claim, and content-free meta writes make no claim at all. */
    aiProvenanceId?: string;
}

/**
 * The freshest existing record at an EXACT key, whichever identity owns it.
 *
 * Memory is keyed by (ownerGaii, key), so a key ever written under two identities — a GHII and an
 * agent GAII — has duplicate copies. Every workspace read and write resolves across owners and
 * carries the freshest forward; {@link writeWorkspaceRecord} then collapses the rest.
 */
export async function findWorkspaceRecord(storage: Storage, key: string): Promise<MemoryRecord | null> {
    const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
    return items.filter(r => r.key === key).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);
}

/**
 * Write one workspace record under a single owner, collapse any copy of the key left under another
 * identity, then run everything a memory write sets off.
 *
 * Attribution costs nothing here: the immutable `.version.N` snapshots and the activity timeline
 * keep the writing agent's GAII, so holding current state under the member GHII loses no history.
 */
export async function writeWorkspaceRecord(
    deps: WorkspaceWriteDeps,
    input: WorkspaceRecordWrite,
): Promise<void> {
    const { storage } = deps;
    const prev = input.prev === undefined ? await findWorkspaceRecord(storage, input.key) : input.prev;
    const now = new Date().toISOString();
    await storage.setMemory({
        key: input.key,
        ownerGaii: input.owner,
        value: input.value,
        visibility: prev?.visibility ?? 'private',
        tags: prev?.tags ?? [],
        ttlHours: null,
        ...(input.aiProvenanceId ? { aiProvenanceId: input.aiProvenanceId } : {}),
        version: prev ? prev.version + 1 : 1,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
    });
    if (prev && prev.ownerGaii !== input.owner) await collapseKeyTo(storage, input.key, input.owner);

    // What the write sets off, which is the half this path used to skip. POST /v1/memory has emitted
    // the memory change and run the fan-out since both existed; a workspace draft written through a
    // tool call did neither, so a Tracked Response watching the key stayed quiet, an event-triggered
    // workflow never started, a subscribed ecosystem app was never told, and the record waited for
    // the next scheduled federation sync. Same act, same consequences, whichever door it came in.
    emitChange('memory');
    await afterMemoryWrite(deps, input.owner, input.key, !!prev);
}

/**
 * Delete one workspace instance's whole family: the bare key (an un-suffixed write, which the
 * workspace read surfaces as the current value), `.draft`, `.latest` and every `.version.N`.
 *
 * The prefix carries no trailing dot so the bare key is caught too; the per-row guard then excludes
 * sibling instances like `${base}0` or `${base}-x`, so only this exact id is ever touched. Records
 * owned by the caller or by one of their own agents go; another owner's do not — a member deletes
 * their own work and nobody else's.
 *
 * Returns how many keys were removed.
 */
export async function deleteWorkspaceInstance(
    storage: Storage,
    args: { base: string; callerGhii: string },
): Promise<number> {
    const { base, callerGhii } = args;
    const { items } = await storage.listAllMemory({ prefix: base, limit: 5000 });
    let deleted = 0;
    for (const r of items) {
        if (r.key !== base && !r.key.startsWith(`${base}.`)) continue;              // exclude sibling ids
        if (r.ownerGaii !== callerGhii && !isSameOwner(r.ownerGaii, callerGhii)) continue;
        const role = r.key === base ? '' : r.key.slice(base.length + 1);            // '' = the bare key
        if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
            if (await storage.deleteMemory(r.ownerGaii, r.key)) deleted++;
        }
    }
    return deleted;
}
