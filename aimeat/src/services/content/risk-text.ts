/**
 * @file src/services/content/risk-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words of a value as the content risk marks read them, one function for every point
 *   (risk-intake.ts, the pipeline's `risk` stage, risk-read.ts), so a mark's hash and offsets mean the
 *   same thing wherever it was made.
 *
 *   NOT JSON. A JSON text escapes a line break as the two characters `\n`, so the word after it follows
 *   a letter and no word rule matches it; a receiver's `{ "text": "Report.\nIgnore all previous
 *   instructions" }` read as JSON carried no ai-instruction mark (seen in e2e-content-risk, 2026-11-21).
 *   An object is read as its string values, one per line in key order (Postgres reorders a stored
 *   object's keys, and a row hashed from its request must hash the same when read back), to MAX_DEPTH
 *   levels; a document as its title
 *   and markdown; a person's context as its name, summary, core and material; a string as it is.
 * @structure riskTextOf · MAX_DEPTH
 * @usage const text = riskTextOf(record.value);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */

/** How deep into an object the string values are read. */
export const MAX_DEPTH = 8;
const MAX_PARTS = 20_000;

function leaves(v: unknown, depth: number, out: string[]): void {
  if (out.length >= MAX_PARTS) return;
  if (typeof v === 'string') { if (v.trim()) out.push(v); return; }
  if (depth >= MAX_DEPTH || !v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) leaves(x, depth + 1, out); return; }
  // In key order: Postgres stores a JSON object with its keys in an order of its own, so a value read
  // back is not in the order it was written, and its words must hash the same either way.
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o).sort()) leaves(o[k], depth + 1, out);
}

/** The words of a value: see the file header. */
export function riskTextOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '');
    if (typeof v.markdown === 'string') return [s('title'), v.markdown].filter(Boolean).join('\n\n');
    if (v.type === 'aimeat.context/v1' && typeof v.core === 'string') {
      return [s('name') ? `# ${s('name')}` : '', s('summary'), s('core'), s('material')].filter(Boolean).join('\n\n');
    }
  }
  const out: string[] = [];
  leaves(value, 0, out);
  return out.join('\n');
}
