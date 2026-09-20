/**
 * @file src/services/app-build-notes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a builder decided about the Design Book while building one version of an app,
 *   and why, read off the page it published.
 *
 *   The developer's point, 2026-09-20: a usage count does not say a part is good, it says an AI
 *   favoured it, for a reason nobody wrote down; and "the build is finished" is not the moment to
 *   store anything, because he rebuilt one app three times and liked the third. So the REASON is
 *   written at the moment of the choice, when the builder still has it, and kept with the version
 *   it belongs to. What becomes of it is decided later and by the owner (design-book/reasons.ts).
 *
 *   THE PAGE CARRIES IT, the way it carries its layout, so nothing has to be called:
 *
 *     <script type="application/json" id="aimeat-build-notes">
 *     { "took":   [ { "part": "leiska-dashboard", "why": "numbers over one list is this app" } ],
 *       "passed": [ { "part": "leiska-work-queue", "why": "a queue has states; habits have none" } ],
 *       "made":   [ { "name": "week-grid", "what": "seven tappable days per habit",
 *                     "why": "the Book has no grid of days a person ticks" } ] }
 *     </script>
 *
 *   `took`   a Design Book part that is in this page, and what it was chosen for.
 *   `passed` a part that was looked at and left, and why it did not fit. The most useful of the
 *            three: it is the only place a part's weakness is ever written down.
 *   `made`   something built by hand because the Book had nothing for it. This list, across apps,
 *            is what the Book should grow next.
 *
 *   A REASON IS THE BUILDER'S OWN ACCOUNT, NOT A MEASUREMENT. It can be a story told afterwards.
 *   It is kept as a lead for a person to read, and nothing is decided from it alone.
 *
 *   Pure: parsing and bounding only. An unparseable block or a malformed row is reported in
 *   `problems` and never refuses a publish.
 * @structure BuildNotes · NOTE_LIMITS · buildNotesDeclared(html)
 * @usage const notes = buildNotesDeclared(html);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial (wish-atelierin-ui-kehitys-haltuun-miksi-osa-otettiin-miksi-tehtii).
 */

export interface TookNote { part: string; why: string }
export interface PassedNote { part: string; why: string }
export interface MadeNote { name: string; what: string; why: string }

export interface BuildNotes {
  took: TookNote[];
  passed: PassedNote[];
  made: MadeNote[];
}

export const NOTE_LIMITS = { rows: 12, why: 400, what: 200, name: 60 } as const;

const PART_ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
const NAME = /^[a-z0-9][a-z0-9-]{1,59}$/;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The notes the page carries: null when it carries none, otherwise the rows that read cleanly and
 * a sentence for each that did not.
 */
export function buildNotesDeclared(html: string): { notes: BuildNotes; problems: string[] } | null {
  const raw = /<script\b[^>]*\bid\s*=\s*["']aimeat-build-notes["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (raw === undefined) return null;
  const problems: string[] = [];
  const notes: BuildNotes = { took: [], passed: [], made: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { notes, problems: [`The #aimeat-build-notes block is not JSON: ${(err as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { notes, problems: ['The #aimeat-build-notes block must be one object with `took`, `passed` and `made` lists.'] };
  }
  const body = parsed as Record<string, unknown>;
  const rows = (key: string): unknown[] => {
    const v = body[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { problems.push(`\`${key}\` must be a list.`); return []; }
    if (v.length > NOTE_LIMITS.rows) problems.push(`\`${key}\` holds ${v.length} rows; the first ${NOTE_LIMITS.rows} are kept.`);
    return v.slice(0, NOTE_LIMITS.rows);
  };

  for (const key of ['took', 'passed'] as const) {
    for (const row of rows(key)) {
      const r = (row ?? {}) as Record<string, unknown>;
      const part = text(r.part, 80);
      const why = text(r.why, NOTE_LIMITS.why);
      if (!PART_ID.test(part)) { problems.push(`A \`${key}\` row names no Design Book part id: ${JSON.stringify(row).slice(0, 80)}`); continue; }
      // The reason is the whole point of the row. A part with no reason is the bare count again.
      if (!why) { problems.push(`\`${key}\` "${part}" gives no \`why\`. One sentence: what made it fit, or what made it not fit.`); continue; }
      notes[key].push({ part, why });
    }
  }
  for (const row of rows('made')) {
    const r = (row ?? {}) as Record<string, unknown>;
    const name = text(r.name, NOTE_LIMITS.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const what = text(r.what, NOTE_LIMITS.what);
    const why = text(r.why, NOTE_LIMITS.why);
    if (!NAME.test(name)) { problems.push(`A \`made\` row has no usable \`name\`: ${JSON.stringify(row).slice(0, 80)}`); continue; }
    if (!what || !why) { problems.push(`\`made\` "${name}" needs both \`what\` (what it is) and \`why\` (why the Book had nothing for it).`); continue; }
    notes.made.push({ name, what, why });
  }
  return { notes, problems };
}
