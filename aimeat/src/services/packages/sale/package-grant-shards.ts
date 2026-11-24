/**
 * @file services/packages/sale/package-grant-shards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a package group's grants are stored: shards of bounded size and an index that
 *   lists them, not one memory record (Jouni, 2026-11-24, decision
 *   decision-paketin-myynti-nelj-rakennusp-t-st-vahvistettu-ja-k-ytt-oike, part b). The grants of one
 *   group were one record, `entitlements.<groupId>`, and one memory value is capped at 1024 kB
 *   (config.memoryMaxValueSizeKb): a sold grant takes 500 to 550 bytes, so the record outgrew the cap at
 *   about 2,000 installs (2,500 sold grants measured 1,357 kB). One record per install is not the answer either, because the default node
 *   allows 1000 keys per principal (.claude/rules/namespaces-memory.md, a memory value is a record).
 *
 *   THE SHAPE. The index stays at `entitlements.<groupId>`: `{ groupId, shards: [0, 1, ...] }`. Shard n
 *   is `entitlement-shards.<groupId>.<n>`: `{ groupId, shard: n, nodes: { <nodeId>: grant } }`. A shard
 *   takes a new grant while it holds fewer than GRANTS_PER_SHARD and stays under SHARD_MAX_BYTES, so a
 *   value stays at half the cap even when every grant carries a long note. Both keys are in the
 *   system namespace `package-entitlements`, a literal with no `@`, which no principal can address.
 *
 *   EVERY READ AND WRITE GOES THROUGH THIS FILE: readGrants() for one group, listAllGrants() for every
 *   group, writeGrant() to set or remove one node's grant. Each write is a compare-and-swap on the
 *   record version (record-cas.ts updateRecord), so concurrent grants do not wipe each other (secaudit
 *   2026-10, PKG-7).
 *
 *   AN OLD SINGLE RECORD keeps working. A record with `nodes` and no `shards` is read as it is. The
 *   first write to its group converts it: the nodes go to shards 0..k (each written only if absent),
 *   then the record becomes the index, on the version that was read and only while it still holds the
 *   same nodes. Nothing is converted at boot, and nothing is removed: the conversion only writes what
 *   the old record already held.
 *
 *   ORDER OF WRITES. The index lists a shard before the shard is written, and a reader takes an absent
 *   shard as empty, so no grant sits in a shard the index does not list. Two concurrent writers that
 *   place one new node in two shards leave two copies; the reader keeps the newer one, and the next
 *   write of that node removes the other.
 * @structure NS_PACKAGE_ENTITLEMENTS · GRANTS_PER_SHARD · SHARD_MAX_BYTES · StoredGrant · readGrants()
 *   · listAllGrants() · writeGrant()
 * @usage
 *   const grants = await readGrants<PackageEntitlement>(storage, groupId);
 *   await writeGrant(storage, groupId, nodeId, entitlement);   // null removes it
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial: the grants record of a package group becomes shards with an index
 *     (package sale design, decision part b).
 */
import type { Storage } from '../../../storage/interface.js';
import { updateRecord, UNCHANGED, CAS_ATTEMPTS } from '../../record-cas.js';

export const NS_PACKAGE_ENTITLEMENTS = 'package-entitlements';

/** A shard takes a new grant while it holds fewer than this many. */
export const GRANTS_PER_SHARD = 1000;
/** ...and while its grants stay under this many bytes of JSON: half the 1024 kB value cap. */
export const SHARD_MAX_BYTES = 512 * 1024;

const TAG = 'package-entitlements';
const INDEX_PREFIX = 'entitlements.';
const SHARD_PREFIX = 'entitlement-shards.';
const indexKey = (groupId: string): string => `${INDEX_PREFIX}${groupId}`;
const shardKey = (groupId: string, n: number): string => `${SHARD_PREFIX}${groupId}.${n}`;

/** What every stored grant has: the node it names and when it last changed. */
export interface StoredGrant { nodeId: string; updatedAt?: string }

type Nodes<G> = Record<string, G>;
interface Index { groupId: string; shards: number[] }

function isIndex(v: unknown): v is Index {
    return !!v && typeof v === 'object' && Array.isArray((v as Index).shards);
}

/** The nodes of an old single record or of a shard; null for an index or nothing. */
function nodesOf<G>(v: unknown): Nodes<G> | null {
    if (!v || typeof v !== 'object' || isIndex(v)) return null;
    const nodes = (v as { nodes?: unknown }).nodes;
    return nodes && typeof nodes === 'object' ? nodes as Nodes<G> : null;
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** The bytes one more node adds to a shard's JSON: its key, its grant, a colon and a comma. */
const entryBytes = (nodeId: string, grant: unknown): number => bytes(nodeId) + bytes(grant) + 2;

/** Whether a shard holding `nodes` (`size` bytes of JSON) takes `grant` as a new node. */
function hasRoom(nodes: Nodes<unknown>, nodeId: string, grant: unknown, size = bytes(nodes)): boolean {
    return Object.keys(nodes).length < GRANTS_PER_SHARD && size + entryBytes(nodeId, grant) <= SHARD_MAX_BYTES;
}

/** Own keys only: a node id such as "constructor" is not on every object's prototype chain here. */
const holds = (nodes: Nodes<unknown>, nodeId: string): boolean => Object.hasOwn(nodes, nodeId);

/** One grant per node: of two copies the newer one, as the order of writes above can leave two. */
function merge<G extends StoredGrant>(parts: Array<Nodes<G> | null>): G[] {
    const out = new Map<string, G>();
    for (const nodes of parts) {
        for (const [nodeId, g] of Object.entries(nodes ?? {})) {
            const had = out.get(nodeId);
            if (!had || Date.parse(g.updatedAt ?? '') > Date.parse(had.updatedAt ?? '')) out.set(nodeId, g);
        }
    }
    return [...out.values()];
}

async function readShards<G>(storage: Storage, groupId: string, shards: number[]): Promise<Array<{ n: number; nodes: Nodes<G> }>> {
    const recs = await Promise.all(shards.map(n => storage.getMemory(NS_PACKAGE_ENTITLEMENTS, shardKey(groupId, n))));
    return shards.map((n, i) => ({ n, nodes: nodesOf<G>(recs[i]?.value) ?? {} }));
}

/** Every grant of one group, one per node: from its shards, or from an old single record. */
export async function readGrants<G extends StoredGrant>(storage: Storage, groupId: string): Promise<G[]> {
    const v = (await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, indexKey(groupId)))?.value;
    if (!isIndex(v)) return merge([nodesOf<G>(v)]);
    return merge((await readShards<G>(storage, groupId, v.shards)).map(s => s.nodes));
}

/** Every group's grants, in two listings: the indexes (and old records), and the shards. */
export async function listAllGrants<G extends StoredGrant>(storage: Storage): Promise<Array<{ groupId: string; grants: G[] }>> {
    const [heads, shards] = await Promise.all([
        storage.listMemory(NS_PACKAGE_ENTITLEMENTS, { prefix: INDEX_PREFIX }),
        storage.listMemory(NS_PACKAGE_ENTITLEMENTS, { prefix: SHARD_PREFIX }),
    ]);
    const shardValue = new Map(shards.map(r => [r.key, r.value]));
    const out: Array<{ groupId: string; grants: G[] }> = [];
    for (const head of heads) {
        const v = head.value as { groupId?: unknown } | null | undefined;
        const groupId = typeof v?.groupId === 'string' ? v.groupId : head.key.slice(INDEX_PREFIX.length);
        const grants = isIndex(v)
            ? merge(v.shards.map(n => nodesOf<G>(shardValue.get(shardKey(groupId, n)))))
            : merge([nodesOf<G>(v)]);
        out.push({ groupId, grants });
    }
    return out;
}

/**
 * Write the shards of an old single record and turn the record into the index. A shard that exists
 * already is left as it is: an earlier conversion of the same record wrote it, and a grant may have
 * changed it since. The index is written only while the record still holds the nodes that were split.
 */
async function convertLegacy<G>(storage: Storage, groupId: string, legacy: Nodes<G>): Promise<void> {
    const chunks: Array<Nodes<G>> = [];
    let cur: Nodes<G> = {};
    let size = 2;
    for (const [nodeId, g] of Object.entries(legacy)) {
        if (Object.keys(cur).length && !hasRoom(cur, nodeId, g, size)) { chunks.push(cur); cur = {}; size = 2; }
        cur[nodeId] = g;
        size += entryBytes(nodeId, g);
    }
    if (Object.keys(cur).length) chunks.push(cur);
    for (const [n, nodes] of chunks.entries()) {
        await updateRecord<unknown>(storage, NS_PACKAGE_ENTITLEMENTS, shardKey(groupId, n), v => v ?? null,
            stored => stored === null ? { groupId, shard: n, nodes } : UNCHANGED, { tag: TAG });
    }
    const was = JSON.stringify(legacy);
    await updateRecord<unknown>(storage, NS_PACKAGE_ENTITLEMENTS, indexKey(groupId), v => v ?? null,
        stored => {
            const nodes = nodesOf<G>(stored);
            return nodes && JSON.stringify(nodes) === was ? { groupId, shards: chunks.map((_, n) => n) } : UNCHANGED;
        }, { tag: TAG });
}

/** The group's index, after converting an old record; with `create`, a new one when there is none. */
async function indexOf(storage: Storage, groupId: string, create: boolean): Promise<Index | null> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const v = (await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, indexKey(groupId)))?.value;
        if (isIndex(v)) return v;
        const legacy = nodesOf<StoredGrant>(v);
        if (legacy) { await convertLegacy(storage, groupId, legacy); continue; }
        if (!create) return null;
        const made = await updateRecord<unknown>(storage, NS_PACKAGE_ENTITLEMENTS, indexKey(groupId), x => x ?? null,
            stored => stored === null ? { groupId, shards: [] } satisfies Index : UNCHANGED, { tag: TAG });
        if (isIndex(made)) return made;
    }
    throw new Error(`${NS_PACKAGE_ENTITLEMENTS} ${indexKey(groupId)} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
}

/**
 * List a new shard in the index: the one after every shard `seen` names. Two writers that saw the
 * same shards add the same number, once. Null when the index is not an index any more.
 */
async function addShard(storage: Storage, groupId: string, seen: number[]): Promise<number | null> {
    const n = Math.max(-1, ...seen) + 1;
    const stored = await updateRecord<unknown>(storage, NS_PACKAGE_ENTITLEMENTS, indexKey(groupId), v => v ?? null,
        cur => isIndex(cur) && !cur.shards.includes(n) ? { ...cur, shards: [...cur.shards, n] } : UNCHANGED, { tag: TAG });
    return isIndex(stored) && stored.shards.includes(n) ? n : null;
}

/**
 * Set `nodeId`'s grant in shard n (null removes it). False when the shard is full for a new node,
 * which the caller answers by choosing another shard.
 */
async function setInShard<G>(storage: Storage, groupId: string, n: number, nodeId: string, grant: G | null): Promise<boolean> {
    let full = false;
    await updateRecord<unknown>(storage, NS_PACKAGE_ENTITLEMENTS, shardKey(groupId, n), v => v ?? null,
        stored => {
            full = false;
            const nodes: Nodes<G> = { ...(nodesOf<G>(stored) ?? {}) };
            if (grant === null) {
                if (!holds(nodes, nodeId)) return UNCHANGED;
                delete nodes[nodeId];
            } else {
                if (!holds(nodes, nodeId) && !hasRoom(nodes, nodeId, grant)) { full = true; return UNCHANGED; }
                nodes[nodeId] = grant;
            }
            return { groupId, shard: n, nodes };
        }, { tag: TAG });
    return !full;
}

/**
 * Set one node's grant (null removes it) and leave every other node as it is NOW. The node's grant
 * stays in the shard that holds it; a new node goes to the first shard with room, or to a new one.
 */
export async function writeGrant<G extends StoredGrant>(storage: Storage, groupId: string, nodeId: string, grant: G | null): Promise<void> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const index = await indexOf(storage, groupId, grant !== null);
        if (!index) return;
        const shards = await readShards<G>(storage, groupId, index.shards);
        const holders = shards.filter(s => holds(s.nodes, nodeId)).map(s => s.n);
        if (grant === null) {
            for (const n of holders) await setInShard(storage, groupId, n, nodeId, null);
            return;
        }
        const target = holders[0] ?? shards.find(s => hasRoom(s.nodes, nodeId, grant))?.n ?? await addShard(storage, groupId, index.shards);
        if (target === null || !await setInShard(storage, groupId, target, nodeId, grant)) continue;
        for (const n of holders) if (n !== target) await setInShard(storage, groupId, n, nodeId, null);
        return;
    }
    throw new Error(`${NS_PACKAGE_ENTITLEMENTS} ${groupId}: no shard took ${nodeId} in ${CAS_ATTEMPTS} attempts; try again`);
}
