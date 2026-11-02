/**
 * @file src/services/parties/read-stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the owner reads of the party read log (plan doc-mvwxcas3dom3, D3.5): the entries
 *   of one party, and per share the last served read and the served reads of the last seven days, from
 *   this month's and last month's `party-reads.<yyyy-mm>` records. Pending entries are written first
 *   (./activity.ts flushOwner), so the owner sees a read made a second ago.
 * @structure readLogsOf · shareReadStats · ReadStats30 · readStats30 · partyReads
 * @usage const stats = await shareReadStats(storage, ownerGhii);  stats.get(shareId)?.reads_7d
 * @version-history
 *   v1.1.0 — 2026-11-02 — readStats30: the served reads of 30 days per share, per package and per reader,
 *     for the owner's "Data you share" and the operator's list (WP11).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D3.5).
 */
import type { Storage } from '../../storage/interface.js';
import { flushOwner, parseReadLog, readLogKey, type PartyReadEntry, type PartyReadLog } from './activity.js';

/** This month's and last month's read logs of the owner, newest month first. */
export async function readLogsOf(storage: Storage, ownerGhii: string, now = new Date()): Promise<PartyReadLog[]> {
    await flushOwner(ownerGhii);
    const thisMonth = readLogKey(now);
    const lastMonth = readLogKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
    const out: PartyReadLog[] = [];
    for (const key of [thisMonth, lastMonth]) {
        const rec = await storage.getMemory(ownerGhii, key);
        if (rec) out.push(parseReadLog(rec.value, key.slice(key.indexOf('.') + 1)));
    }
    return out;
}

/** Per share: the last served read and how many served reads the last seven days hold. */
export async function shareReadStats(storage: Storage, ownerGhii: string): Promise<Map<string, { last_read_at: string | null; reads_7d: number }>> {
    const since = Date.now() - 7 * 86_400_000;
    const stats = new Map<string, { last_read_at: string | null; reads_7d: number }>();
    for (const log of await readLogsOf(storage, ownerGhii)) {
        for (const e of log.entries) {
            if (!e.share || e.verdict !== 'served') continue;
            const s = stats.get(e.share) ?? { last_read_at: null, reads_7d: 0 };
            if (!s.last_read_at || e.at > s.last_read_at) s.last_read_at = e.at;
            if (Date.parse(e.at) >= since) s.reads_7d++;
            stats.set(e.share, s);
        }
    }
    return stats;
}

/** The served reads of the last 30 days, per share, per package and per reader. */
export interface ReadStats30 {
    byShare: Map<string, { last_read_at: string; reads_30d: number }>;
    byPackage: Map<string, { last_read_at: string; reads_30d: number }>;
    /** One row per reader and package: the reader's uid (`visitor:<ghii>` for a visitor) and name in the log. */
    readers: Array<{ uid: string; party: string; package: string; last_read_at: string; reads_30d: number; what: string[] }>;
}

/**
 * The served reads of the last 30 days from this month's and last month's logs, which hold at least
 * that long: per share, per package (the `what` up to its first slash), and per reader and package with
 * the endpoint kinds it read through (descriptor, versions, odps, rows, odata, file).
 */
export async function readStats30(storage: Storage, ownerGhii: string, now = new Date()): Promise<ReadStats30> {
    const since = now.getTime() - 30 * 86_400_000;
    const out: ReadStats30 = { byShare: new Map(), byPackage: new Map(), readers: [] };
    const readers = new Map<string, ReadStats30['readers'][number] & { kinds: Set<string> }>();
    const bump = (m: Map<string, { last_read_at: string; reads_30d: number }>, k: string, at: string) => {
        const s = m.get(k) ?? { last_read_at: at, reads_30d: 0 };
        if (at > s.last_read_at) s.last_read_at = at;
        s.reads_30d++;
        m.set(k, s);
    };
    for (const log of await readLogsOf(storage, ownerGhii, now)) {
        for (const e of log.entries) {
            if (e.verdict !== 'served' || Date.parse(e.at) < since) continue;
            const pkg = String(e.what || '').split('/')[0] ?? '';
            const kind = String(e.what || '').split('/')[1] ?? '';
            if (e.share) bump(out.byShare, e.share, e.at);
            if (pkg) bump(out.byPackage, pkg, e.at);
            const key = `${e.uid}|${pkg}`;
            const r = readers.get(key) ?? { uid: e.uid, party: e.party, package: pkg, last_read_at: e.at, reads_30d: 0, what: [], kinds: new Set<string>() };
            if (e.at > r.last_read_at) r.last_read_at = e.at;
            r.reads_30d++;
            if (kind) r.kinds.add(kind);
            readers.set(key, r);
        }
    }
    out.readers = [...readers.values()].map(({ kinds, ...r }) => ({ ...r, what: [...kinds].sort() }))
        .sort((a, b) => (a.last_read_at < b.last_read_at ? 1 : -1));
    return out;
}

/** One party's read log entries (served and refused), newest first, with the entries the months could not keep. */
export async function partyReads(storage: Storage, ownerGhii: string, uid: string, limit = 500): Promise<{ entries: PartyReadEntry[]; dropped: number }> {
    const logs = await readLogsOf(storage, ownerGhii);
    const entries = logs.flatMap(l => l.entries).filter(e => e.uid === uid).sort((a, b) => (a.at < b.at ? 1 : -1));
    return { entries: entries.slice(0, Math.max(1, Math.min(limit, 2000))), dropped: logs.reduce((n, l) => n + l.dropped, 0) };
}
