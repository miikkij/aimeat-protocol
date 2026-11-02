/**
 * @file src/services/dataspace/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where DSP negotiations and transfers are kept (plan doc-mvwxcas3dom3, D8.3): one memory
 *   record per process under the owner of the package, `dsp.negotiations.<hex>` and
 *   `dsp.transfers.<hex>` (./contract.ts), each changed on its version (services/record-cas.ts), so a
 *   consumer message and the owner's approval that arrive together both land in order.
 *
 *   THE KEY BUDGET. A process that ended (a negotiation TERMINATED, or FINALIZED with its agreement
 *   ended; a transfer COMPLETED or TERMINATED) more than ARCHIVE_AFTER_DAYS ago is folded into the
 *   owner's monthly archive `dsp.archive.<yyyy-mm>` (a summary line each, at most 2000 a month) and its
 *   record deleted. The sweep runs at most once an hour per owner, when a new process is made. An owner
 *   holds at most MAX_LIVE_PROCESSES live records; a new request past it is refused, so the 1000-key
 *   budget of an account is never spent by strangers.
 *
 *   THE ROOM (processRoom). A process that ended takes no room: when the owner's records reach
 *   MAX_LIVE_PROCESSES, the ones that ended longest ago fold into the archive at once, so the records
 *   stay within the budget and only live processes refuse a request. One participant holds at most
 *   AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT live ones with one owner, so it cannot take the whole
 *   room and lock the other participants out.
 * @structure readNegotiation · readTransfer · createNegotiation · createTransfer · changeNegotiation ·
 *   changeTransfer · listNegotiations · listTransfers · liveProcessCount · processRoom · sweepArchive ·
 *   readArchive
 * @usage const n = await changeNegotiation(storage, owner, hex, cur => ({ ...cur, state: 'AGREED' }));
 * @version-history
 *   v1.1.0 — 2026-11-02 — processRoom: ended processes take no room and one participant takes a share of
 *     it only (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { Storage } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';
import {
    ARCHIVE_AFTER_DAYS, MAX_LIVE_PROCESSES, NEGOTIATIONS_PREFIX, TRANSFERS_PREFIX, archiveKey, negotiationKey, transferKey,
    type NegotiationRecord, type TransferRecord,
} from './contract.js';

const asNegotiation = (v: unknown): NegotiationRecord | null =>
    v && typeof v === 'object' && typeof (v as NegotiationRecord).providerPid === 'string' ? v as NegotiationRecord : null;
const asTransfer = (v: unknown): TransferRecord | null =>
    v && typeof v === 'object' && typeof (v as TransferRecord).providerPid === 'string' ? v as TransferRecord : null;

export async function readNegotiation(storage: Storage, ownerGhii: string, hex: string): Promise<NegotiationRecord | null> {
    return asNegotiation((await storage.getMemory(ownerGhii, negotiationKey(hex)))?.value);
}

export async function readTransfer(storage: Storage, ownerGhii: string, hex: string): Promise<TransferRecord | null> {
    return asTransfer((await storage.getMemory(ownerGhii, transferKey(hex)))?.value);
}

/** Write a new process record; false when one with the key exists already. */
async function createOnce(storage: Storage, ownerGhii: string, key: string, value: object, tag: string): Promise<boolean> {
    let made = false;
    await updateRecord<object | null>(storage, ownerGhii, key, v => (v && typeof v === 'object' ? v : null), cur => {
        if (cur) { made = false; return UNCHANGED; }
        made = true;
        return value;
    }, { tag });
    return made;
}

export const createNegotiation = (storage: Storage, n: NegotiationRecord, hex: string) =>
    createOnce(storage, n.ownerGhii, negotiationKey(hex), n, 'dsp-negotiation');
export const createTransfer = (storage: Storage, t: TransferRecord, hex: string) =>
    createOnce(storage, t.ownerGhii, transferKey(hex), t, 'dsp-transfer');

/**
 * Change a process record with `change`, which answers the new record or UNCHANGED. Answers the record
 * as written (or as it was, for UNCHANGED), or null when there is none.
 */
async function changeOne<T>(
    storage: Storage, ownerGhii: string, key: string, parse: (v: unknown) => T | null, tag: string,
    change: (cur: T) => T | typeof UNCHANGED,
): Promise<T | null> {
    let after: T | null = null;
    await updateRecord(storage, ownerGhii, key, parse, cur => {
        if (!cur) { after = null; return UNCHANGED; }
        const next = change(cur);
        after = next === UNCHANGED ? cur : next;
        return next === UNCHANGED ? UNCHANGED : next;
    }, { tag });
    return after;
}

export const changeNegotiation = (storage: Storage, ownerGhii: string, hex: string, change: (cur: NegotiationRecord) => NegotiationRecord | typeof UNCHANGED) =>
    changeOne(storage, ownerGhii, negotiationKey(hex), asNegotiation, 'dsp-negotiation', change);
export const changeTransfer = (storage: Storage, ownerGhii: string, hex: string, change: (cur: TransferRecord) => TransferRecord | typeof UNCHANGED) =>
    changeOne(storage, ownerGhii, transferKey(hex), asTransfer, 'dsp-transfer', change);

/** Every negotiation of the owner, newest first. */
export async function listNegotiations(storage: Storage, ownerGhii: string): Promise<NegotiationRecord[]> {
    const rows = await storage.listMemory(ownerGhii, { prefix: NEGOTIATIONS_PREFIX });
    return rows.map(r => asNegotiation(r.value)).filter((n): n is NegotiationRecord => !!n)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every transfer of the owner, newest first. */
export async function listTransfers(storage: Storage, ownerGhii: string): Promise<TransferRecord[]> {
    const rows = await storage.listMemory(ownerGhii, { prefix: TRANSFERS_PREFIX });
    return rows.map(r => asTransfer(r.value)).filter((t): t is TransferRecord => !!t)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many process records the owner holds now, live or waiting for the sweep. */
export async function liveProcessCount(storage: Storage, ownerGhii: string): Promise<number> {
    const [n, t] = await Promise.all([
        storage.listMemoryMeta(ownerGhii, { prefix: NEGOTIATIONS_PREFIX }),
        storage.listMemoryMeta(ownerGhii, { prefix: TRANSFERS_PREFIX }),
    ]);
    return n.length + t.length;
}

/** One line of the monthly archive. */
export interface ArchiveLine {
    kind: 'negotiation' | 'transfer';
    providerPid: string;
    consumerPid: string;
    participantId: string;
    state: string;
    datasetId?: string;
    agreementId?: string;
    shareId?: string;
    createdAt: string;
    endedAt: string;
}

const MAX_ARCHIVE_PER_MONTH = 2000;
const parseArchive = (v: unknown): { lines: ArchiveLine[] } => ({ lines: Array.isArray((v as { lines?: unknown })?.lines) ? (v as { lines: ArchiveLine[] }).lines : [] });
const lastSweep = new Map<string, number>();

/** When a record ended, or null while it is live. */
function endedAt(rec: NegotiationRecord | TransferRecord, kind: 'negotiation' | 'transfer'): string | null {
    if (kind === 'negotiation') {
        const n = rec as NegotiationRecord;
        if (n.state === 'TERMINATED') return n.updatedAt;
        if (n.state === 'FINALIZED' && n.agreementEndedAt) return n.agreementEndedAt;
        return null;
    }
    const t = rec as TransferRecord;
    return t.state === 'COMPLETED' || t.state === 'TERMINATED' ? t.updatedAt : null;
}

/**
 * Fold the owner's processes that ended more than ARCHIVE_AFTER_DAYS ago into the monthly archive and
 * delete their records. At most once an hour per owner unless `force`. Answers how many moved.
 */
export async function sweepArchive(storage: Storage, ownerGhii: string, opts: { force?: boolean; nowMs?: number } = {}): Promise<number> {
    const now = opts.nowMs ?? Date.now();
    if (!opts.force && (lastSweep.get(ownerGhii) ?? 0) > now - 3_600_000) return 0;
    lastSweep.set(ownerGhii, now);
    const cutoff = now - ARCHIVE_AFTER_DAYS * 86_400_000;
    const batches = (await processRows(storage, ownerGhii)).filter(r => r.line && Date.parse(r.line.endedAt) <= cutoff)
        .map(r => ({ key: r.key, line: r.line! }));
    return foldIntoArchive(storage, ownerGhii, batches);
}

/** One process record of the owner: its key, its participant, and its archive line once it ended. */
interface ProcessRow { key: string; participantId: string; line: ArchiveLine | null }

/** Every process record of the owner, each with its archive line when it ended. */
async function processRows(storage: Storage, ownerGhii: string): Promise<ProcessRow[]> {
    const out: ProcessRow[] = [];
    for (const [prefix, kind] of [[NEGOTIATIONS_PREFIX, 'negotiation'], [TRANSFERS_PREFIX, 'transfer']] as const) {
        for (const row of await storage.listMemory(ownerGhii, { prefix })) {
            const rec = kind === 'negotiation' ? asNegotiation(row.value) : asTransfer(row.value);
            if (!rec) continue;
            const ended = endedAt(rec, kind);
            const n = rec as NegotiationRecord;
            out.push({
                key: row.key, participantId: rec.participantId, line: !ended ? null : {
                    kind, providerPid: rec.providerPid, consumerPid: rec.consumerPid, participantId: rec.participantId, state: rec.state,
                    ...(kind === 'negotiation' ? { datasetId: n.datasetId, ...(n.agreementId ? { agreementId: n.agreementId } : {}), ...(n.materialised ? { shareId: n.materialised.shareId } : {}) } : { agreementId: (rec as TransferRecord).agreementId }),
                    createdAt: rec.createdAt, endedAt: ended,
                },
            });
        }
    }
    return out;
}

/**
 * Is there room for one more process of `participantId` with this owner? A process that ended does
 * not take room: when the owner's records reach MAX_LIVE_PROCESSES, the ones that ended longest ago are
 * folded into the archive at once (a summary line each, as the 90-day sweep does), so the key budget
 * stays bounded. Answers null when there is room, 'provider' when the owner holds MAX_LIVE_PROCESSES
 * live ones, and 'participant' when this participant holds `perParticipant` live ones (0: no limit).
 */
export async function processRoom(
    storage: Storage, ownerGhii: string, participantId: string, perParticipant: number,
): Promise<{ full: 'provider' | 'participant'; live: number } | null> {
    const rows = await processRows(storage, ownerGhii);
    const live = rows.filter(r => !r.line);
    const liveOf = live.filter(r => r.participantId === participantId).length;
    if (perParticipant > 0 && liveOf >= perParticipant) return { full: 'participant', live: liveOf };
    if (live.length >= MAX_LIVE_PROCESSES) return { full: 'provider', live: live.length };
    const over = rows.length - MAX_LIVE_PROCESSES + 1;
    if (over > 0) {
        const ended = rows.filter(r => r.line).sort((a, b) => a.line!.endedAt.localeCompare(b.line!.endedAt)).slice(0, over);
        await foldIntoArchive(storage, ownerGhii, ended.map(r => ({ key: r.key, line: r.line! })));
    }
    return null;
}

/** Fold ended processes into the monthly archive and delete their records. Answers how many moved. */
async function foldIntoArchive(storage: Storage, ownerGhii: string, batches: Array<{ key: string; line: ArchiveLine }>): Promise<number> {
    let moved = 0;
    for (const b of batches) {
        const month = b.line.endedAt.slice(0, 7);
        let kept = false;
        await updateRecord(storage, ownerGhii, archiveKey(month), parseArchive, cur => {
            if (cur.lines.some(l => l.providerPid === b.line.providerPid)) { kept = true; return UNCHANGED; }
            kept = cur.lines.length < MAX_ARCHIVE_PER_MONTH;
            // A full month keeps its first lines; the record is deleted either way, and the log says so.
            return kept ? { lines: [...cur.lines, b.line] } : UNCHANGED;
        }, { tag: 'dsp-archive' });
        if (!kept) logger.warn('dataspace: the monthly archive is full, a finished process is deleted without a line', { owner: ownerGhii, month, pid: b.line.providerPid });
        await storage.deleteMemory(ownerGhii, b.key, 'dataspace-archive');
        moved++;
    }
    return moved;
}

export async function readArchive(storage: Storage, ownerGhii: string, month: string): Promise<ArchiveLine[]> {
    return parseArchive((await storage.getMemory(ownerGhii, archiveKey(month)))?.value).lines;
}
