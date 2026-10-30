/**
 * @file src/data/atelier-ornaments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ORNAMENTS REGISTRY — every ornament figure the Atelier kit draws
 *   (sdk-libs/atelier/ornament*.js), described so an AI can CHOOSE one for an element of its page,
 *   bounded so the kit and the Design Book's bench clamp to the same numbers, and placed so the
 *   Book can show each one on content it suits (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin).
 *
 *   AN ORNAMENT DECORATES, IT NEVER CARRIES MEANING. Every figure is aria-hidden; the element it
 *   sits on keeps its words, its role and its value. A figure grows once and holds still, and
 *   stands settled under Less motion, so the kit's zero-idle claim stays true.
 *
 *   WHAT IT WRAPS decides where it goes: a block (a card, a panel), a badge, a bar, a rule (an empty
 *   element between parts), a heading, a paragraph, a list, a button or a column. The Book's
 *   preview builds that element and puts the figure on it; the build prompt names it, so a figure
 *   lands on the kind of element it was drawn for.
 *
 *   ONE CLAMP, TWO CONSUMERS. ORNAMENT_PARAMS here and ORN_PARAMS in the kit carry the same bounds;
 *   test/unit/atelier-ornaments.test.ts holds them, the ids and each figure's knobs equal.
 * @structure OrnamentWraps · OrnamentParamName · ORNAMENT_PARAMS · AtelierOrnament · ORNAMENTS ·
 *   ORNAMENT_IDS · ornamentById() · ornamentParamProblem() · resolveOrnamentParams()
 * @usage
 *   import { ORNAMENTS, ornamentById, resolveOrnamentParams } from '../data/atelier-ornaments.js';
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial: 23 figures ported from the accepted ornament canvas.
 */

/** The kind of element a figure is drawn for. */
export type OrnamentWraps = 'block' | 'badge' | 'bar' | 'rule' | 'heading' | 'text' | 'list' | 'button' | 'column';

export type OrnamentParamName = 'speed' | 'delay' | 'leaves' | 'value' | 'strands';

export interface OrnamentParam {
  min: number;
  max: number;
  default: number;
  /** The unit the number is written in; absent for a ratio or a count. */
  unit?: 's';
  /** What turning it does, in the words the catalogue hands an AI. */
  what: string;
}

/** Every knob, with the bounds the kit clamps to. speed and delay apply to every figure. */
export const ORNAMENT_PARAMS: Readonly<Record<OrnamentParamName, OrnamentParam>> = {
  speed: { min: 0.25, max: 3, default: 1, what: 'How fast it grows: 2 is twice as fast, 0.5 half.' },
  delay: { min: 0, max: 5, default: 0, unit: 's', what: 'Seconds before it starts to grow, to let one ornament follow another.' },
  leaves: { min: 0, max: 2, default: 1, what: 'How leafy: 0 none, 1 as drawn, 2 lush.' },
  value: { min: 0, max: 1, default: 0.64, what: 'How far the vine has grown along the bar; at 1 the tip flowers.' },
  strands: { min: 2, max: 4, default: 3, what: 'How many strands the rope is twisted from.' },
};

export interface AtelierOrnament {
  /** The id the kit takes: AIMEAT.atelier.ornament(el, id). */
  id: string;
  title: string;
  /** What it is and where it goes, for a picker; 240 characters at most. */
  summary: string;
  wraps: OrnamentWraps;
  /** The knobs it takes beyond speed and delay. */
  params: readonly OrnamentParamName[];
  /** The looks it was drawn for, first one the Book previews it on. */
  fitsLooks: readonly string[];
}

const ENGRAVED = ['kirjapaino', 'broadsheet', 'lounge', 'editorial', 'gallery'] as const;
const LIVING = ['kirjapaino', 'calm-card', 'lounge', 'dawn', 'editorial'] as const;

export const ORNAMENTS: readonly AtelierOrnament[] = [
  { id: 'frame', title: 'Engraved frame', wraps: 'block', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'Double rules with hatching between them, corner scrolls that curl open from a rosette, and palmettes in the middle of the long edges. Round a card or a panel.' },
  { id: 'vine-border', title: 'Vine round the border', wraps: 'block', params: ['leaves'], fitsLooks: LIVING,
    summary: 'Two strands twine round the element\'s border once, passing in front of and behind it, and close the loop in a flower. Round a card.' },
  { id: 'rope', title: 'Rope border', wraps: 'block', params: ['strands'], fitsLooks: ENGRAVED,
    summary: 'A rope of two to four strands twisted round the element\'s border. Round a card or a notice.' },
  { id: 'jugend', title: 'Jugend panel', wraps: 'block', params: ['leaves'], fitsLooks: LIVING,
    summary: 'Rules round a tall panel and long stems rising either side to a lily, a cup and a bud. Needs free room beside the panel, about a third of its height each side.' },
  { id: 'guilloche-band', title: 'Guilloche band', wraps: 'block', params: [], fitsLooks: ENGRAVED,
    summary: 'Banknote waves under a slowly breathing envelope behind a block\'s content, between fine rules. Behind a figure, a price or a title.' },
  { id: 'wreath', title: 'Wreath', wraps: 'badge', params: ['leaves'], fitsLooks: LIVING,
    summary: 'Two leafy branches grow up round a round badge from stems that cross below it, with an engraved ring on the badge\'s edge. Round an avatar, a monogram or a medal.' },
  { id: 'guilloche', title: 'Guilloche rosette', wraps: 'badge', params: [], fitsLooks: ENGRAVED,
    summary: 'Three woven rings of closed wavy circles, the engraving on a banknote, filling a square element. A seal, a medallion, an empty hero corner.' },
  { id: 'vine-bar', title: 'Vine progress bar', wraps: 'bar', params: ['leaves', 'value'], fitsLooks: LIVING,
    summary: 'A progress bar that two strands twine round; the vine grows with the value, leaves open as the tip passes, and at 1 the tip flowers. handle.set(v) moves it.' },
  { id: 'wrap', title: 'Ribbon wrap', wraps: 'bar', params: [], fitsLooks: ENGRAVED,
    summary: 'A wide band wound tight round a rod-shaped element and bound at both ends, like the grip of a handle. Round a slim bar or a rail.' },
  { id: 'divider', title: 'Rosette divider', wraps: 'rule', params: ['leaves'], fitsLooks: LIVING,
    summary: 'A rosette in the middle, a hairline each way with a strand twining round it, and a curl at each end. Between sections.' },
  { id: 'vine-rail', title: 'Vine rail', wraps: 'rule', params: [], fitsLooks: LIVING,
    summary: 'Two strands round a hairline, beaded at the ends: a quiet rule between parts.' },
  { id: 'braid', title: 'Braid', wraps: 'rule', params: ['strands'], fitsLooks: ENGRAVED,
    summary: 'A three-strand braid with a knot at each end. A rule between sections, or under a title.' },
  { id: 'cord', title: 'Cord with tassels', wraps: 'rule', params: [], fitsLooks: ENGRAVED,
    summary: 'Two strands twisted into a cord with a tassel hanging from each end. Under a title, or at the top of a card.' },
  { id: 'guilloche-strip', title: 'Guilloche strip', wraps: 'rule', params: [], fitsLooks: ENGRAVED,
    summary: 'Eight waves braided along a line between two fine rules: a narrow banknote border.' },
  { id: 'fleuron', title: 'Fleuron', wraps: 'rule', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'An upright leaf between two mirrored curls, beads below: the mark at the end of a section or a story.' },
  { id: 'dinkus', title: 'Dinkus', wraps: 'rule', params: [], fitsLooks: ENGRAVED,
    summary: 'A small rosette with a leaf either way and fine rules: a pause between two parts of one text.' },
  { id: 'flourish', title: 'Heading flourish', wraps: 'heading', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'Scrolls curl out either side of a short heading, with leaves and beads. A page title or a section title of a few words.' },
  { id: 'swash', title: 'Swash under a heading', wraps: 'heading', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'A long stroke that starts in a small curl and ends in a big one, under a heading or a word.' },
  { id: 'dropcap', title: 'Drop cap', wraps: 'text', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'The paragraph\'s first letter, set large in a box with a strand twining round it; the letter stays in the text, so the word reads whole.' },
  { id: 'ribbon', title: 'Ribbon banner', wraps: 'heading', params: [], fitsLooks: ENGRAVED,
    summary: 'An arched band behind a short title, its ends folded back into swallowtails. A title of one to three words.' },
  { id: 'bullets', title: 'Leaf bullets', wraps: 'list', params: [], fitsLooks: LIVING,
    summary: 'A leaf before each item of a list, opening one after another.' },
  { id: 'ivy', title: 'Ivy on a column', wraps: 'column', params: ['leaves'], fitsLooks: LIVING,
    summary: 'Ivy climbs a tall element from its foot, passing in front of it and behind it, with a cluster of leaves at the top. A sidebar rule, a pillar, a tall image.' },
  { id: 'brackets', title: 'Scroll brackets', wraps: 'button', params: ['leaves'], fitsLooks: ENGRAVED,
    summary: 'A curved bracket with curled ends either side of a button, a leaf on each. Round the one button that matters.' },
];

export const ORNAMENT_IDS: readonly string[] = ORNAMENTS.map((o) => o.id);

const byId = new Map(ORNAMENTS.map((o) => [o.id, o]));

export function ornamentById(id: string): AtelierOrnament | undefined {
  return byId.get(id);
}

/** The refusal for one knob, in words, or null when it is fine. Knobs the figure does not take are refused by name. */
export function ornamentParamProblem(id: string, params: unknown): string | null {
  const entry = byId.get(id);
  if (!entry) return `"${id}" is not an ornament. The ornaments: ${ORNAMENT_IDS.join(', ')}.`;
  if (params === undefined) return null;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return 'params is an object of numbers, such as { "speed": 1.5, "leaves": 2 }.';
  }
  const takes = new Set<string>(['speed', 'delay', ...entry.params]);
  for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
    if (!takes.has(name)) return `"${id}" takes ${[...takes].join(', ')}; "${name}" is none of them.`;
    const b = ORNAMENT_PARAMS[name as OrnamentParamName];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < b.min || value > b.max) {
      return `"${name}" is a number from ${b.min} to ${b.max}${b.unit ? ` ${b.unit}` : ''}; ${JSON.stringify(value)} is not.`;
    }
  }
  return null;
}

/** The knobs that differ from the defaults: what a stored part keeps. */
export function resolveOrnamentParams(params: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!params) return undefined;
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (ORNAMENT_PARAMS[name as OrnamentParamName]?.default !== value) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
