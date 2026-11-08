/**
 * @file src/services/receivers/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where receivers are kept: one record per receiver, `receivers.<name>`, in the owner's
 *   service namespace (services/service-records.ts), so no memory route and no principal writing as
 *   the owner can reach a key hash. Reads go through serviceRecords(); a change goes through
 *   updateRecord() on the record's version (services/record-cas.ts), so two changes made at once (a
 *   rotation and a pause) never overwrite each other unseen. The record is the account's: the data
 *   export carries it and the account erasure removes it, as every service record.
 * @structure ReceiverError · listReceivers · getReceiver · createReceiverRecord · updateReceiver ·
 *   deleteReceiverRecord · listAllReceivers
 * @usage const r = await getReceiver(storage, 'alice@node', 'ruuvi');
 * @version-history
 *   v1.0.1 — 2026-11-08 — The refusal messages say incoming webhook; every code stays
 *     (secaudit2026nov08b round 15b).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { serviceRecords, serviceNamespaceOf, ownerOfServiceNamespace, SERVICE_NAMESPACE_PREFIX } from '../service-records.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { RECEIVER_RECORD_PREFIX, MAX_RECEIVERS, parseReceiver, type ReceiverRecord } from './contract.js';

/** A refusal a receiver call answers with: the REST status and code, and a sentence for the caller. */
export class ReceiverError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string, public readonly extra?: Record<string, unknown>) {
        super(message);
        this.name = 'ReceiverError';
    }
}

const records = (storage: Storage) => serviceRecords<ReceiverRecord>(storage, RECEIVER_RECORD_PREFIX, { parse: parseReceiver });

/** Every receiver of the owner, in name order. */
export async function listReceivers(storage: Storage, ownerGhii: string): Promise<ReceiverRecord[]> {
    return (await records(storage).list(ownerGhii)).map(r => r.value);
}

/** One receiver of the owner, or null. */
export async function getReceiver(storage: Storage, ownerGhii: string, name: string): Promise<ReceiverRecord | null> {
    return records(storage).get(ownerGhii, name);
}

/**
 * Store a new receiver. Refused when the owner already holds one of that name (409) or holds the most
 * an owner may (MAX_RECEIVERS). createMemoryIfAbsent decides the name, so two makers at once cannot
 * both take it.
 */
export async function createReceiverRecord(storage: Storage, ownerGhii: string, record: ReceiverRecord): Promise<void> {
    const existing = await listReceivers(storage, ownerGhii);
    if (existing.some(r => r.name === record.name)) {
        throw new ReceiverError(409, 'NAME_TAKEN', `You already have an incoming webhook called "${record.name}". Choose another name, or change that one.`);
    }
    if (existing.length >= MAX_RECEIVERS) {
        throw new ReceiverError(409, 'TOO_MANY', `An account holds at most ${MAX_RECEIVERS} incoming webhooks. Delete one you no longer use first.`);
    }
    const ns = serviceNamespaceOf(ownerGhii);
    const at = new Date().toISOString();
    const row: MemoryRecord = {
        key: `${RECEIVER_RECORD_PREFIX}${record.name}`, ownerGaii: ns, value: record as unknown as MemoryRecord['value'],
        visibility: 'private', tags: ['receiver'], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
    };
    if (!(await storage.createMemoryIfAbsent(row))) {
        throw new ReceiverError(409, 'NAME_TAKEN', `You already have an incoming webhook called "${record.name}". Choose another name, or change that one.`);
    }
}

/**
 * Change one receiver on its version. `mutate` gets the record as stored and returns the new one, or
 * UNCHANGED. A missing receiver is 404 NOT_FOUND.
 */
export async function updateReceiver(
    storage: Storage, ownerGhii: string, name: string,
    mutate: (cur: ReceiverRecord) => ReceiverRecord | typeof UNCHANGED,
): Promise<ReceiverRecord> {
    let missing = false;
    const out = await updateRecord<ReceiverRecord | null>(
        storage, serviceNamespaceOf(ownerGhii), `${RECEIVER_RECORD_PREFIX}${name}`, parseReceiver,
        cur => {
            if (!cur) { missing = true; return UNCHANGED; }
            return mutate(cur);
        },
        { tag: 'receiver' },
    );
    if (missing || !out) throw new ReceiverError(404, 'NOT_FOUND', `You have no incoming webhook called "${name}".`);
    return out;
}

/** Remove one receiver. True when there was one. */
export async function deleteReceiverRecord(storage: Storage, ownerGhii: string, name: string): Promise<boolean> {
    return records(storage).delete(ownerGhii, name);
}

/** Every receiver on this node with its owner's GHII, for the operator. Read page by page. */
export async function listAllReceivers(storage: Storage): Promise<Array<{ ownerGhii: string; receiver: ReceiverRecord }>> {
    const out: Array<{ ownerGhii: string; receiver: ReceiverRecord }> = [];
    for (let offset = 0; ; offset += 500) {
        const page = await storage.listAllMemoryMeta({
            prefix: RECEIVER_RECORD_PREFIX, ownerPrefix: SERVICE_NAMESPACE_PREFIX, limit: 500, offset, excludeVersionRows: true,
        });
        for (const row of page.items) {
            const ownerGhii = ownerOfServiceNamespace(row.ownerGaii);
            if (!ownerGhii || !row.key.startsWith(RECEIVER_RECORD_PREFIX)) continue;
            const rec = await storage.getMemory(row.ownerGaii, row.key);
            const receiver = parseReceiver(rec?.value);
            if (receiver) out.push({ ownerGhii, receiver });
        }
        if (page.items.length < 500) break;
    }
    return out;
}
