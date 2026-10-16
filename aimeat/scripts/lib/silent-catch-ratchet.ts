/**
 * @file scripts/lib/silent-catch-ratchet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The comparisons behind `check:silent-catch --strict`, as pure functions so a unit test
 *   can hold them without running ESLint over the tree.
 *
 *   Three ceilings, all keyed by FILE and a COUNT, because a catch handler has no stable name and a
 *   line number stops covering the code it was written for as soon as anything above it moves:
 *     - the substitute baseline (security/silent-catch-substitutes.json): the fourth shape in the
 *       areas where the other three are already at zero;
 *     - the src/static baseline (security/silent-catch-static-baseline.json): all four shapes, per
 *       shape, for the served SDK libs, the app-catalog bundle and the standalone scripts, which were
 *       reported and not gated until 2026-10-16;
 *     - the exemption baseline (security/silent-catch-exemptions.json): how many findings an
 *       `eslint-disable… aimeat/no-silent-catch` directive suppresses in each file. An exemption is
 *       a finding somebody chose to keep, so adding one is the same event as adding the finding, and
 *       it is counted the same way. A directive with no reason after `--` is refused outright.
 *   A file over its ceiling fails the gate; a file under it is named so the gain can be locked in.
 *   Only a whole-tree pass may say a file improved: in `--staged` mode every file the commit does not
 *   touch was never linted and would read as zero.
 * @structure SHAPES · ShapeName · shapeName() · compareCeilings() · compareShapeCeilings() ·
 *   countExemptions()
 * @usage import { compareCeilings, compareShapeCeilings, countExemptions } from './lib/silent-catch-ratchet.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: src/static gated per shape and per file, exemptions counted and
 *     ratcheted, a reasonless exemption refused (W25 "An error is not an empty result").
 */

/** The rule's four message ids and the short names the baselines and the table use for them. */
export const SHAPES = [
  { id: 'emptyCatch', name: 'empty' },
  { id: 'returnsAbsence', name: 'absence' },
  { id: 'discardsError', name: 'discards' },
  { id: 'substitutesValue', name: 'substitute' },
] as const;

export type ShapeName = typeof SHAPES[number]['name'];

/** The short name for a rule message id, or the id itself when the rule grows a fifth shape. */
export function shapeName(messageId: string): string {
  return SHAPES.find(s => s.id === messageId)?.name ?? messageId;
}

/** What a ceiling comparison found: files over their ceiling (a failure) and under it (a gain). */
export interface Comparison {
  over: string[];
  under: string[];
}

/**
 * One count per file against one ceiling per file. A file absent from `listed` has a ceiling of 0.
 * @param now        file -> count found now
 * @param listed     file -> { count } from the baseline
 * @param wholeTree  false in `--staged` mode, where no gain can be claimed
 */
export function compareCeilings(
  now: Map<string, number>,
  listed: Record<string, { count: number }>,
  wholeTree: boolean,
): Comparison {
  const over: string[] = [];
  const under: string[] = [];
  for (const [file, count] of now) {
    const allowed = listed[file]?.count ?? 0;
    if (count > allowed) over.push(`${file}: ${count} now, ${allowed} allowed`);
  }
  if (wholeTree) {
    for (const [file, entry] of Object.entries(listed)) {
      const count = now.get(file) ?? 0;
      if (count < entry.count) under.push(`${file}: ${count} now, ${entry.count} listed`);
    }
  }
  return { over, under };
}

/**
 * Per file AND per shape: fixing an empty catch does not buy room for a new substitute, because the
 * two hide different things. A shape absent from a file's entry has a ceiling of 0.
 * @param now     file -> shape name -> count found now
 * @param listed  file -> { counts: shape name -> ceiling }
 */
export function compareShapeCeilings(
  now: Map<string, Record<string, number>>,
  listed: Record<string, { counts: Record<string, number> }>,
  wholeTree: boolean,
): Comparison {
  const over: string[] = [];
  const under: string[] = [];
  for (const [file, counts] of now) {
    for (const [shape, count] of Object.entries(counts)) {
      const allowed = listed[file]?.counts?.[shape] ?? 0;
      if (count > allowed) over.push(`${file}: ${count} ${shape} now, ${allowed} allowed`);
    }
  }
  if (wholeTree) {
    for (const [file, entry] of Object.entries(listed)) {
      for (const [shape, allowed] of Object.entries(entry.counts ?? {})) {
        const count = now.get(file)?.[shape] ?? 0;
        if (count < allowed) under.push(`${file}: ${count} ${shape} now, ${allowed} listed`);
      }
    }
  }
  return { over, under };
}

/** The part of an ESLint suppressed message this counter reads. */
export interface SuppressedLike {
  ruleId: string | null;
  line: number;
  suppressions?: { kind: string; justification?: string }[];
}

/**
 * Count the findings of `rule` that a disable directive suppresses, per file, and name every one
 * whose directive gives no reason after `--`. Reading ESLint's own suppression record rather than
 * grepping for the comment means a directive inside a string is not counted, a bare
 * `eslint-disable-next-line` (no rule named) that hides this rule IS counted, and a block disable
 * counts every finding it covers, so a new catch inside an old block raises the count.
 * @param files  per file, its suppressed messages (ESLint's `suppressedMessages`)
 */
export function countExemptions(
  files: { file: string; suppressed: SuppressedLike[] }[],
  rule: string,
): { perFile: Map<string, number>; unreasoned: string[] } {
  const perFile = new Map<string, number>();
  const unreasoned: string[] = [];
  for (const { file, suppressed } of files) {
    for (const m of suppressed) {
      if (m.ruleId !== rule) continue;
      const directives = (m.suppressions ?? []).filter(s => s.kind === 'directive');
      if (directives.length === 0) continue;
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
      if (!directives.some(s => (s.justification ?? '').trim().length > 0)) unreasoned.push(`${file}:${m.line}`);
    }
  }
  return { perFile: new Map([...perFile].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))), unreasoned };
}
