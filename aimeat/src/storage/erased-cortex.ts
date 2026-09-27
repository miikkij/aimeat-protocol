/**
 * @file src/storage/erased-cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an erasure takes of a cortex the erased account installed. Both storage providers
 *   call this from their owner cascade (postgres-kysely/methods/owner-cascade.ts
 *   deleteInstalledCortexesDb, sqlite/repos/cortex-erasure.ts deleteInstalledCortexes), so the rule
 *   cannot drift between them; each writes its own SQL.
 *
 *   WHY THE RECORD GOES. A cortex record names the account that installed it (`installedBy`, the bare
 *   account name), and every ownership question about a cortex compares against that name. A deleted
 *   username is released for reuse (decision 2026-08-10), so the record goes with the account, and
 *   the cortex's own name is free for the next install.
 *
 *   WHY WHAT IT MADE GOES WITH IT. The record is the only thing that points at what an activation
 *   made: its actions, its schema locks, its boards and its prompt, ontology and seed records. They
 *   go with the record, so none of them stays with nothing that knows why it is there. The lib files,
 *   the kept versions and the dependency edges are keyed by the cortex's name, which the next install
 *   of that name takes, so they go too.
 * @structure
 *   - ErasedCortexParts: what one record's activation made, as the cascades delete it
 *   - erasedCortexParts(raw): read from the stored activationArtifacts (a JSON object or its text)
 * @usage
 *   const parts = erasedCortexParts(row.activationArtifacts);
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: an account deletion takes the cortexes it installed (secaudit
 *     2026-09, R4 "found": the cortex record).
 */
import type { CortexActivationArtifacts } from './interface.js';

/** What one cortex's activation made, read from its record, as the erasure deletes it. */
export interface ErasedCortexParts {
  /** The actions its activation published. */
  actionIds: string[];
  /** The identity they were published under, when the record names it. */
  actionProvider: string | null;
  /** The key patterns of its schema locks. */
  schemaKeys: string[];
  /** Its boards. */
  boardIds: string[];
  /** Its prompt, ontology and seed records, written under the principal that activated it. */
  memoryKeys: string[];
}

/**
 * The parts of one stored activation. `raw` is the record's activationArtifacts as the provider
 * returns it: an object on Postgres (JSONB), the JSON text on SQLite. A field that is missing or not
 * a list of strings reads as empty, and a text that does not parse reads as an activation that made
 * nothing, so an odd record never stops an erasure; the record itself is deleted either way.
 */
export function erasedCortexParts(raw: unknown): ErasedCortexParts {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the stored text is not JSON, so the activation lists nothing
    try { value = JSON.parse(raw); } catch { value = {}; }
  }
  const a = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof CortexActivationArtifacts, unknown>>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
  return {
    actionIds: list(a.actionIds),
    actionProvider: typeof a.actionProvider === 'string' && a.actionProvider !== '' ? a.actionProvider : null,
    schemaKeys: list(a.schemaKeys),
    boardIds: list(a.boardIds),
    memoryKeys: [...new Set([...list(a.promptKeys), ...list(a.ontologyKeys), ...list(a.seedDataKeys)])],
  };
}
