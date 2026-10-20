/**
 * @file src/services/content/correct-fields.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The property values an extracted entity holds, by property name: the reverse of
 *   classes.ts entityFor. Its own file because both the pipeline (which keeps a corrected value when a
 *   class is extracted again) and the correction (correct.ts, which imports the pipeline's error)
 *   read it, and either importing the other would close an import cycle.
 * @structure fieldsOf
 * @usage const values = fieldsOf(facts.entities.invoice.entity, 'invoice');
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */

/** `{ vendor: 'Acme', amount: 248 }` from an entity's `cc:invoice.vendor`, `cc:invoice.amount`. */
export function fieldsOf(entity: Record<string, unknown> | undefined, classId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const prefix = `cc:${classId}.`;
  for (const [k, v] of Object.entries(entity ?? {})) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}
