/**
 * @file src/services/classification/present-memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one way a memory value is shown to a caller (TARGET-082, spec §13.2 group 1). It
 *   does the two things every memory read owes its reader, in one call: the classification check
 *   (reader.show) and the credential mask (a key on the secret-records list reads as
 *   `{ configured: true }`, services/secret-records.ts). Before this file, the mask was applied at
 *   21 places one by one and was missing from six more; a check added the same way would have had
 *   the same holes.
 * @structure presentMemories(reader, records) · presentMemory(reader, record)
 * @usage
 *   const shown = await presentMemories(reader, items);
 *   res.json({ items: shown.map(r => ({ key: r.key, value: r.value })) });
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { shownMemoryValue } from '../secret-records.js';
import { memoryTarget } from './labels.js';
import type { ContentReader } from './reader.js';

/** The fields this reads. Every memory record shape the node hands out has them. */
export interface PresentableMemory {
  key: string;
  value: unknown;
  ownerGaii: string;
}

/** The records this reader may see, each with its value as it may be shown. Order is kept. */
export async function presentMemories<T extends PresentableMemory>(reader: ContentReader, records: readonly T[]): Promise<T[]> {
  const shown = await reader.show(records, r => memoryTarget(r.ownerGaii, r.key));
  return shown.map(r => ({ ...r, value: shownMemoryValue(r.key, r.value) }));
}

/** One record, or null when this reader may not see it. */
export async function presentMemory<T extends PresentableMemory>(reader: ContentReader, record: T): Promise<T | null> {
  const [shown] = await presentMemories(reader, [record]);
  return shown ?? null;
}
