/**
 * @file src/storage/join-request-via.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads the `via` column of a join request, which both providers store as the JSON text
 *   of a JoinRequestVia ({ kind, ref, label }). One reader for both, so a stored value that is not
 *   that shape reads as "no source" in SQLite and PostgreSQL alike and never reaches a caller as a
 *   half-built object.
 * @structure parseJoinRequestVia()
 * @usage const via = parseJoinRequestVia(row.via);   // JoinRequestVia | undefined
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial (migration 0129).
 */
import type { JoinRequestVia } from './types/organisms-federation.js';
import { logger } from '../utils/logger.js';

const KINDS: ReadonlySet<string> = new Set(['app', 'portfolio', 'company']);

/** The stored `via` text as a JoinRequestVia, or undefined when the column is empty or not that shape. */
export function parseJoinRequestVia(raw: unknown): JoinRequestVia | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('join request: the via column does not parse; read as a request with no source', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
  const v = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<JoinRequestVia>;
  if (typeof v.kind !== 'string' || !KINDS.has(v.kind) || typeof v.ref !== 'string' || !v.ref) return undefined;
  return { kind: v.kind, ref: v.ref, label: typeof v.label === 'string' ? v.label : v.ref };
}
