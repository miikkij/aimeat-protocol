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
 * @structure DataWalletService.overview(ownerGaii, auditDays?) → { consents, audit, permSummary }
 * @usage const ov = await createDataWalletService(storage).overview(resolve(req), 30);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Data Wallet tab's 3 reads into one composite (memory = meta-only).
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { getPendingConsentAudit } from '../consent-audit-buffer.js';

export interface DataWalletOverview {
  consents: { consents: Array<Record<string, unknown>>; total: number };
  audit: { entries: Array<Record<string, unknown>>; total: number; period_days: number };
  permSummary: {
    total_memory_keys: number;
    total_storage_files: number;
    active_consents: number;
    rules_by_recipient_type: Record<string, number>;
    data_patterns: unknown[];
  };
}

export class DataWalletService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Data Wallet mount for one owner in a single read scope. Mirrors the three folded endpoints' `.data`
   * exactly. The audit merges the pending (not-yet-flushed) buffer ahead of persisted rows, same as GET
   * /v1/consent/audit. The permission summary is derived from the SAME consent list (active subset) plus
   * memory-key and storage-file counts.
   */
  overview(ownerGaii: string, auditDays = 30): Promise<DataWalletOverview> {
    return runInReadScope(async () => {
      const [consents, storedAudit, memoryMeta, storageFiles] = await Promise.all([
        this.storage.listConsents(ownerGaii),
        this.storage.listConsentAudit(ownerGaii, { days: auditDays }),
        this.storage.listMemoryMeta(ownerGaii, {}),
        this.storage.listStorageFiles(ownerGaii),
      ]);

      const pending = getPendingConsentAudit(ownerGaii, { days: auditDays })
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
      const auditEntries = [...pending, ...storedAudit];

      // Permission summary — derived from the active subset of the SAME consent list (no re-read).
      const active = consents.filter(c => c.status === 'active');
      const byType: Record<string, number> = { wildcard: 0, gaii: 0, ghii: 0, organism: 0, domain: 0, node: 0 };
      for (const c of active) {
        if (c.recipient === '*') byType.wildcard++;
        else if (c.recipient.startsWith('ghii:')) byType.ghii++;
        else if (c.recipient.startsWith('organism.')) byType.organism++;
        else if (c.recipient.startsWith('domain:')) byType.domain++;
        else if (c.recipient.startsWith('node:')) byType.node++;
        else byType.gaii++;
      }

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
          entries: auditEntries.map(e => ({
            id: e.id, consent_id: e.consentId, accessor_gaii: e.accessorGaii, memory_key: e.memoryKey,
            action: e.action, timestamp: e.timestamp, allowed: e.allowed,
          })),
          total: auditEntries.length,
          period_days: auditDays,
        },
        permSummary: {
          total_memory_keys: memoryMeta.length,
          total_storage_files: storageFiles.length,
          active_consents: active.length,
          rules_by_recipient_type: byType,
          data_patterns: [...new Set(active.map(c => c.dataPattern))],
        },
      };
    });
  }
}

/** Assemble the Data Wallet composite over the given storage. */
export function createDataWalletService(storage: Storage): DataWalletService {
  return new DataWalletService(storage);
}
