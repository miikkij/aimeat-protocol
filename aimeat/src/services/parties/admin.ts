/**
 * @file src/services/parties/admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of outside parties (plan doc-mvwxcas3dom3, D2.9; regulation (EU)
 *   2022/868 art. 12 (g)): stop any party for abuse and resume it, and the counts the Security page
 *   shows. A party the operator stopped is not resumed by its owner (./service.ts answers 409
 *   STOPPED_BY_OPERATOR). The routes ask requireOperator and the MCP tool askOperator before these run.
 * @structure operatorSetStop · partySecurityCounts
 * @usage await operatorSetStop(deps, 'alice', 'matti', true, 'scraping');
 * @version-history
 *   2026-11-04 — No zero counts for a storage without getMemoryByKeysAnyOwner: it is required on
 *     Storage (codebase analysis 2026-11-03, item D-e).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.9).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { emitChange } from '../event-bus.js';
import { UNCHANGED } from '../record-cas.js';
import { localAccountName } from '../../utils/gaii.js';
import { PARTIES_KEY, parsePartiesValue, partyRefOf, partyView } from './contract.js';
import { changeParty } from './store.js';
import { flushAll, parseReadLog, readLogKey } from './activity.js';
import type { PartyAnswer } from './service.js';

/** Stop (or resume) the party `name` of the account `owner` as the operator. */
export async function operatorSetStop(
    deps: { storage: Storage; config: AimeatConfig }, owner: string, name: string, stop: boolean, reason?: string,
): Promise<PartyAnswer<Record<string, unknown>>> {
    const account = localAccountName(owner.includes('@') ? owner : `${owner}@${deps.config.nodeId}`);
    if (!account) return { ok: false, status: 404, code: 'NOT_FOUND', message: `No account ${owner} on this node.` };
    const ownerGhii = `${account}@${deps.config.nodeId}`;
    const after = await changeParty(deps.storage, ownerGhii, name, p => {
        if (stop) {
            if (p.status === 'stopped' && p.stoppedBy === 'operator') return UNCHANGED;
            return { ...p, status: 'stopped', stoppedBy: 'operator', stoppedAt: new Date().toISOString(), ...(reason ? { stopReason: reason.slice(0, 500) } : {}) };
        }
        if (p.status === 'active') return UNCHANGED;
        return { ...p, status: 'active', stoppedBy: undefined, stoppedAt: undefined, stopReason: undefined };
    });
    if (!after) return { ok: false, status: 404, code: 'NOT_FOUND', message: `The account ${account} has no party called "${name}".` };
    emitChange('consent', ownerGhii);
    return { ok: true, data: { owner: account, party: partyView(after, partyRefOf(account, name, deps.config.nodeId)) } };
}

/**
 * The node-wide counts for the Security page: how many parties there are, how many are stopped (and
 * by the operator), the wrong keys presented, and the refused reads of the last seven days.
 */
export async function partySecurityCounts(storage: Storage): Promise<Record<string, number>> {
    const counts = { total: 0, stopped: 0, stopped_by_operator: 0, failed_key_attempts: 0, refused_reads_7d: 0, served_reads_7d: 0 };
    await flushAll();
    for (const rec of await storage.getMemoryByKeysAnyOwner([PARTIES_KEY])) {
        for (const p of parsePartiesValue(rec.value).parties) {
            counts.total++;
            if (p.status === 'stopped') counts.stopped++;
            if (p.stoppedBy === 'operator') counts.stopped_by_operator++;
            counts.failed_key_attempts += p.failedAttempts ?? 0;
        }
    }
    const now = new Date();
    const since = now.getTime() - 7 * 86_400_000;
    const months = [readLogKey(now), readLogKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)))];
    for (const rec of await storage.getMemoryByKeysAnyOwner(months)) {
        for (const e of parseReadLog(rec.value, '').entries) {
            if (Date.parse(e.at) < since) continue;
            if (e.verdict === 'refused') counts.refused_reads_7d++; else counts.served_reads_7d++;
        }
    }
    return counts;
}
