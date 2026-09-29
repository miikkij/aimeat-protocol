/**
 * @file src/storage/repositories/classification-audit.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for the classification audit log (TARGET-082 V4). Rows arrive in
 *   batches from the in-memory buffer (services/classification/audit.ts), never one per request, and
 *   a row that already exists for (minute, reader, action, scope, kind, key) has its count added to,
 *   not replaced. The rules about what is recorded live in the service; this layer stores.
 * @structure
 *   - addClassificationAudit(rows)            -- upsert a batch, adding counts on the unique address
 *   - listClassificationAudit(filter)         -- filtered rows, newest first
 *   - pruneClassificationAudit(before)        -- remove rows whose lastAt is older than `before`
 *   - deleteClassificationAuditByScope(scope) -- everything recorded in one scope (an organism going)
 * @usage
 *   import type { ClassificationAuditRepository } from './repositories/classification-audit.repository.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { ClassificationAuditRow, ClassificationAuditFilter } from '../types/classification-audit.js';

export interface ClassificationAuditRepository {
  /**
   * Insert each row, or when a row with the same (minute, reader, action, scope, kind, key) exists,
   * add its `count`, keep the earlier `firstAt` and the later `lastAt`, and take the new `label`,
   * `readerKind` and a non-null `purpose`. The id of an existing row is kept. Duplicates inside one
   * batch are merged the same way. A long batch is chunked inside.
   */
  addClassificationAudit(rows: ClassificationAuditRow[]): Promise<void>;

  /** Newest first by lastAt. `limit` defaults to 200 and is capped at 1000. */
  listClassificationAudit(filter: ClassificationAuditFilter): Promise<ClassificationAuditRow[]>;

  /** Removes rows whose lastAt is before `before` (ISO). Returns the number removed. */
  pruneClassificationAudit(before: string): Promise<number>;

  /** Returns the number of rows removed. */
  deleteClassificationAuditByScope(scope: string): Promise<number>;
}
