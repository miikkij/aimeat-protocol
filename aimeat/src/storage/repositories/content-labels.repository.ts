/**
 * @file src/storage/repositories/content-labels.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for classification labels (TARGET-082). One row per labelled
 *   thing, addressed by (kind, scope, key). The read that matters is the batch one: a list or a
 *   search page asks for the labels of every item it holds in ONE query, never one query per item.
 *   The rules about who may set what live in services/classification/labels.ts; this layer stores.
 * @structure
 *   - getContentLabels(kind, scope, keys)  -- the labels of many keys of one scope, one IN query
 *   - getContentLabel(target)              -- one label
 *   - getContentLabelsUnder(kind, scope, prefixes) -- the labels under many key prefixes of one scope
 *   - putContentLabel(row)                 -- insert or replace the row of (kind, scope, key)
 *   - deleteContentLabel(target)           -- remove one label (the target falls back to the default)
 *   - listContentLabels(query)             -- a page of one scope's labels, in key order
 *   - deleteContentLabelsByScope(scope)    -- everything labelled in one scope (an organism going)
 * @usage
 *   import type { ContentLabelRepository } from './repositories/content-labels.repository.js';
 * @version-history
 *   v1.1.0 — 2026-09-30 — getContentLabelsUnder: the labels under key prefixes, for the labels a
 *     workspace document's copies carried before a document had one label address.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { ContentLabelKind, ContentLabelRow, ContentLabelTarget, ContentLabelListQuery } from '../types/content-labels.js';

export interface ContentLabelRepository {
  /**
   * The stored labels of `keys` in one scope. Keys without a row are absent from the answer.
   * Duplicates are ignored, and a long list is chunked inside, so the caller passes a whole page.
   */
  getContentLabels(kind: ContentLabelKind, scope: string, keys: string[]): Promise<ContentLabelRow[]>;

  getContentLabel(target: ContentLabelTarget): Promise<ContentLabelRow | undefined>;

  /**
   * The stored labels in one scope whose key starts with one of `prefixes` (each ends with `.`), a
   * few queries for a whole page. It finds the labels a workspace document's copies carried under
   * their own keys before a document had one address (services/classification/labels.ts).
   */
  getContentLabelsUnder(kind: ContentLabelKind, scope: string, prefixes: string[]): Promise<ContentLabelRow[]>;

  /** Insert, or replace the row with the same (kind, scope, key). The row's `id` is kept on replace. */
  putContentLabel(row: ContentLabelRow): Promise<void>;

  /** Returns true when a row was removed. */
  deleteContentLabel(target: ContentLabelTarget): Promise<boolean>;

  /** `limit` defaults to 100 and is capped at 500. */
  listContentLabels(query: ContentLabelListQuery): Promise<ContentLabelRow[]>;

  /** Returns the number of rows removed. */
  deleteContentLabelsByScope(scope: string): Promise<number>;
}
