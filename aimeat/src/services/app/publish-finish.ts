/**
 * @file src/services/app/publish-finish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What finishing an Atelier app means, said once: the one size matrix every check is
 *   made at, and which of the four owed items an app owes at its level. The build specification
 *   (builder/atelier-prompt.ts, builder/atelier-screens.ts), the appdev handbook's FINISH, the skills
 *   aimeat-app-builder-atelier and aimeat-app-workstation, and the publish answer's `next_steps`
 *   (publish-next-steps.ts) read the matrix; FINISH, the skill's step 9 and `next_steps` read the
 *   owed items. The specification's Finishing points at step 9 for them, because its part
 *   `libraries` is at MAX_PART_CHARS.
 *
 *   WHY ONE PLACE. An instruction review on 2026-11-08 found the publish answer naming 390 and 1440
 *   while the specification and the skill named 390×844, 1280×900 and 1280×460, and on 2026-11-25
 *   the specification itself listed four sizes and called them "these three", the workstation skill
 *   named three of the four, and FINISH and the specification said every app owes all four items
 *   while the publish refusal (owed-gate.ts) asks a quick prototype for neither a skill nor a face.
 *   A builder meets these texts at different moments of one build, and each one it meets last wins.
 *
 *   A leaf module: it imports nothing, so a data file and a service can both read it.
 * @structure ATELIER_SIZES · ATELIER_SIZE_MATRIX · ATELIER_PHONE_SIZE · ATELIER_DESKTOP_SIZES ·
 *   ATELIER_SCREENSHOT_SIZES · OWED_BY_LEVEL · faceAndSkillNotOwed(level, noAiPath)
 * @usage `open the app at ${ATELIER_SIZE_MATRIX} in both themes` · `the four things it owes, by level: ${OWED_BY_LEVEL}`
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-agentti-saa-nykyiset-aimeat-ohjeet-ja-tekee-sovitun-ty-n-lop, items 4 and 5).
 */

/** The one size matrix, in the order a check goes through it. */
export const ATELIER_SIZES: ReadonlyArray<{ width: number; height: number; form: 'phone' | 'desktop' | 'short desktop' }> = [
  { width: 390, height: 844, form: 'phone' },
  { width: 1280, height: 900, form: 'desktop' },
  { width: 1280, height: 460, form: 'short desktop' },
  { width: 1920, height: 1080, form: 'desktop' },
];

const label = (s: { width: number; height: number }): string => `${s.width}×${s.height}`;

/** A list in words: "a, b and c". */
function inWords(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "390×844, 1280×900, 1280×460 and 1920×1080". */
export const ATELIER_SIZE_MATRIX = inWords(ATELIER_SIZES.map(label));

/** The phone of the matrix, "390×844". */
export const ATELIER_PHONE_SIZE = label(ATELIER_SIZES.find(s => s.form === 'phone')!);

/** The desktops of the matrix that a layout is judged at, "1280×900 and 1920×1080". */
export const ATELIER_DESKTOP_SIZES = inWords(ATELIER_SIZES.filter(s => s.form === 'desktop').map(label));

/** The two sizes whose screenshots stand beside the forked genre, "390×844 and 1280×900". */
export const ATELIER_SCREENSHOT_SIZES = inWords(ATELIER_SIZES.slice(0, 2).map(label));

/**
 * Which of the four owed items an app owes, by its level: the rule services/app/owed-gate.ts
 * enforces from an app's second version, in words.
 */
export const OWED_BY_LEVEL = 'the design spec always; the data map when the app keeps data (it declares no '
  + '`aimeat-scopes`, or one that writes); the bound skill and the agent face on every level but a quick '
  + 'prototype (`proto`) and a presentation (`<meta name="aimeat-ai-path" content="none">`)';

/**
 * Why an app owes no bound skill and no agent face, or undefined when it owes both. Same reading as
 * owed-gate.ts: a quick prototype, or a page that declares it is a presentation.
 */
export function faceAndSkillNotOwed(level: string | undefined, noAiPath: boolean): string | undefined {
  if (level === 'proto') return 'a quick prototype (`proto`) owes no bound skill and no agent face';
  if (noAiPath) return 'a presentation (`aimeat-ai-path` none) owes no bound skill and no agent face';
  return undefined;
}
