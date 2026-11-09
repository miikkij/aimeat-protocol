/**
 * @file src/services/db/data-wallet-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the profile **Data Wallet** tab — the ONE call
 *   behind GET /v1/data-wallet. The tab mounted three requests: GET /v1/consent (consents), GET
 *   /v1/consent/audit (audit log + not-yet-flushed buffer), and GET /v1/permissions/summary (which
 *   independently re-read the active consents + counted memory keys + storage files). This composes all
 *   three in one read scope, reading the consent list ONCE (the summary derives the active subset from it
 *   in memory) and counting memory via metadata only (no values loaded). Single-master: the Data Wallet
 *   mount only. The individual endpoints stay for interactive re-fetch (grant/revoke, audit day-range).
 *
 *   The audit comes back GROUPED (who × what × outcome → count, first, last, keys) with only the newest
 *   rows verbatim, and the response carries the NAMES of every organism and workspace the consents and
 *   the audit keys point at, so the page says "HeroPlay · Kehitys" instead of a pattern. Both were the
 *   two server additions the Tietolompakko design canvas asked for: aimeat.io served 2 856 audit rows on
 *   a 30-day mount and 1.4 MB on 90 days, and the page had no name for any of its 13 organisms.
 *
 * @structure DataWalletService.overview(ownerGaii, auditDays?, entryLimit?) → { consents, audit, permSummary, names }
 * @usage const ov = await createDataWalletService(storage).overview(resolve(req), 30);
 * @version-history
 *   2026-11-09 — The key and file totals are counted (countMemory with excludeExpired,
 *     sumStorageBytesForOwners) instead of listed and measured; the same numbers.
 *   2026-11-09 — The organism names come from one query (storage.organismNames), not one whole record
 *     per organism.
 *   2026-11-04 — No per-organism scan for a storage without getMemoryByKeysAnyOwner: it is required on
 *     Storage (codebase analysis 2026-11-03, item D-e).
 *   v1.1.0 — 2026-09-04 — Audit grouped (consent-audit-groups.ts), newest rows only (entry_limit),
 *     organism + workspace names, the consent quota in the summary.
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Data Wallet tab's 3 reads into one composite (memory = meta-only).
 */
import { countConsentRecipients } from '../../storage/consent-recipient.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { getPendingConsentAudit } from '../consent-audit-buffer.js';
import { groupConsentAudit, organismIdsIn, type AuditGroup } from '../consent-audit-groups.js';
import { CONSENT_QUOTA } from '../consent-write.js';

export interface DataWalletOverview {
  consents: { consents: Array<Record<string, unknown>>; total: number };
  audit: {
    entries: Array<Record<string, unknown>>;
    total: number;
    period_days: number;
    entry_limit: number;
    groups: AuditGroup[];
  };
  permSummary: {
    total_memory_keys: number;
    total_storage_files: number;
    active_consents: number;
    consent_quota: number;
    rules_by_recipient_type: Record<string, number>;
    data_patterns: unknown[];
  };
  names: {
    organisms: Record<string, string>;
    workspaces: Record<string, Record<string, string>>;
  };
}

const DEFAULT_ENTRY_LIMIT = 20;
const wsRegistryKey = (orgId: string) => `organism.${orgId}.meta.workspaces`;

export class DataWalletService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Data Wallet mount for one owner in a single read scope. The consents and the permission summary
   * mirror the folded endpoints' `.data`; the audit merges the pending (not-yet-flushed) buffer ahead of
   * persisted rows, same as GET /v1/consent/audit, then groups every row and returns only the newest
   * `entryLimit` verbatim (the rows of one group are read on demand through GET /v1/consent/audit with
   * `key_prefix`). The names cover every organism the consents or the audit keys point at.
   */
  overview(ownerGaii: string, auditDays = 30, entryLimit = DEFAULT_ENTRY_LIMIT): Promise<DataWalletOverview> {
    return runInReadScope(async () => {
      // The two totals are counted, not listed: listing 17 782 keys and 1 275 files to take their
      // length cost about 75 ms on PostgreSQL at a heavy account's size (2026-11-09). The same rows:
      // live keys that are not archived or in the bin, and every stored file.
      const [consents, storedAudit, memoryKeys, fileTotals] = await Promise.all([
        this.storage.listConsents(ownerGaii),
        this.storage.listConsentAudit(ownerGaii, { days: auditDays }),
        this.storage.countMemory([ownerGaii], { excludeExpired: true }),
        this.storage.sumStorageBytesForOwners([ownerGaii]),
      ]);

      const pending = getPendingConsentAudit(ownerGaii, { days: auditDays })
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
      const auditEntries = [...pending, ...storedAudit];

      // Permission summary — derived from the active subset of the SAME consent list (no re-read).
      const active = consents.filter(c => c.status === 'active');
      const byType = countConsentRecipients(active);

      const names = await this.namesFor(organismIdsIn(
        consents.flatMap(c => [c.dataPattern, c.recipient]),
        auditEntries.map(e => e.memoryKey),
      ));

      return {
        consents: {
          consents: consents.map(c => ({
            id: c.id, data_pattern: c.dataPattern, recipient: c.recipient, purpose: c.purpose,
            scope: c.scope, expires: c.expires, status: c.status, granted_at: c.grantedAt,
            revoked_at: c.revokedAt, metadata: c.metadata,
          })),
          total: consents.length,
        },
        audit: {
          entries: auditEntries.slice(0, Math.max(0, entryLimit)).map(e => ({
            id: e.id, consent_id: e.consentId, accessor_gaii: e.accessorGaii, memory_key: e.memoryKey,
            action: e.action, timestamp: e.timestamp, allowed: e.allowed,
          })),
          total: auditEntries.length,
          period_days: auditDays,
          entry_limit: Math.max(0, entryLimit),
          groups: groupConsentAudit(auditEntries),
        },
        permSummary: {
          total_memory_keys: memoryKeys,
          total_storage_files: fileTotals.count,
          active_consents: active.length,
          consent_quota: CONSENT_QUOTA,
          rules_by_recipient_type: byType,
          data_patterns: [...new Set(active.map(c => c.dataPattern))],
        },
        names,
      };
    });
  }

  /**
   * The organism names (from the organism records) and the workspace names (from each organism's
   * workspace registry record, whoever owns it) for the given organism ids. An organism that no
   * longer exists, or one without a registry, is simply absent; the page falls back to the id.
   */
  private async namesFor(orgIds: string[]): Promise<DataWalletOverview['names']> {
    const organisms: Record<string, string> = {};
    const workspaces: Record<string, Record<string, string>> = {};
    if (orgIds.length === 0) return { organisms, workspaces };
    // The names only, in one query: each organism read whole was 51 queries at 51 organisms.
    const names = await this.storage.organismNames(orgIds);
    for (const id of orgIds) if (names[id]) organisms[id] = names[id];
    const keyToOrg = new Map(orgIds.map(id => [wsRegistryKey(id), id]));
    const regs: MemoryRecord[] = await this.storage.getMemoryByKeysAnyOwner([...keyToOrg.keys()]);
    for (const rec of regs) {
      const orgId = keyToOrg.get(rec.key);
      if (!orgId) continue;
      const list = (rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [];
      const names = workspaces[orgId] ?? (workspaces[orgId] = {});
      for (const w of list) if (w.id && !(w.id in names)) names[w.id] = w.name ?? w.id;
    }
    return { organisms, workspaces };
  }
}

/** Assemble the Data Wallet composite over the given storage. */
export function createDataWalletService(storage: Storage): DataWalletService {
  return new DataWalletService(storage);
}
