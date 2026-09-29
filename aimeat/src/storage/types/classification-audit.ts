/**
 * @file src/storage/types/classification-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored form of the classification audit log (TARGET-082 V4). A row says that a
 *   reader was shown, used, was refused, or changed the label of one labelled item, in one minute.
 *   The row is a COUNT, not an event: the same reader, the same item and the same action in the same
 *   minute is one row whose `count` grows, so the table grows with distinct (reader, item, minute)
 *   combinations and never with raw reads. An earlier per-read audit (consent audit) reached
 *   1.2 million rows in production; this shape is the answer to that.
 *
 *   The unique address of a row is (minute, reader, action, scope, kind, key). `label`, `readerKind`
 *   and `purpose` are what the latest merge into the row said. `ownerGaii` names the person whose
 *   content it is, for erasure; it is null on organism content, which goes with the organism.
 * @structure ClassificationAuditReaderKind · ClassificationAuditAction · ClassificationAuditRow ·
 *   ClassificationAuditFilter
 * @usage import type { ClassificationAuditRow } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { ContentLabelKind } from './content-labels.js';

/** Who the reader was, in the classification reader's own terms. */
export type ClassificationAuditReaderKind = 'human' | 'ai' | 'system' | 'anonymous';

/**
 * What happened. `shown` and `used` are recorded only for a label with `audit: true`; `refused`
 * (hidden from or refused to a reader) and `changed` (a label set or moved) are always recorded.
 */
export type ClassificationAuditAction = 'shown' | 'used' | 'refused' | 'changed';

/** One stored audit row. */
export interface ClassificationAuditRow {
  id: string;
  /** ISO 8601 UTC, truncated to the minute: `2026-09-29T10:15:00.000Z`. */
  minute: string;
  /** An owner identity, or `organism:<id>`. The same scope the label row carries. */
  scope: string;
  ownerGaii: string | null;
  kind: ContentLabelKind;
  key: string;
  label: string;
  /** The principal id of the reader. */
  reader: string;
  readerKind: ClassificationAuditReaderKind;
  action: ClassificationAuditAction;
  /** What the content was for: a capability and a model, when the caller knows them. */
  purpose: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** A filtered read of the log, newest first. `since` compares with `lastAt`. */
export interface ClassificationAuditFilter {
  ownerGaii?: string;
  scope?: string;
  since?: string;
  action?: string;
  /** Defaults to 200, capped at 1000. */
  limit?: number;
}
