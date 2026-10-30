/**
 * @file src/data/atelier-ornament-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ORNAMENT SETS REGISTRY — eleven styles the Atelier kit draws
 *   (sdk-libs/atelier/ornament-sets*.js), each one figure for each of five places on a screen, so a
 *   page decorated from one set reads as one hand (wish-kymmenen-koristesetti-eri-tyyleiss):
 *
 *     frame    round a card or a panel
 *     rule     an empty element under a heading, or between parts
 *     bar      a progress bar (takes `value`)
 *     bullets  a list, a mark before each item
 *     strip    an empty element at the foot of a page or a section
 *
 *   The figure ids are `<set>-<role>`; atelier-ornaments.ts turns each set into its five registry
 *   entries, so the kit, the build prompt and the Design Book all read the same list. A set is
 *   described for a picker by its mood and by what each of its five figures draws.
 * @structure OrnamentSetRole · ORNAMENT_SET_ROLES · AtelierOrnamentSet · ORNAMENT_SETS · ORNAMENT_SET_IDS ·
 *   ornamentSetById()
 * @usage
 *   import { ORNAMENT_SETS } from '../data/atelier-ornament-sets.js';
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial: the eleven sets of the accepted set canvas.
 */

export type OrnamentSetRole = 'frame' | 'rule' | 'bar' | 'bullets' | 'strip';

export const ORNAMENT_SET_ROLES: readonly OrnamentSetRole[] = ['frame', 'rule', 'bar', 'bullets', 'strip'];

export interface AtelierOrnamentSet {
  /** The set id: the figures are `<id>-<role>`, and AIMEAT.atelier.ornamentSet(id, …) takes it. */
  id: string;
  title: string;
  /** The mood, for a picker; 200 characters at most. */
  summary: string;
  /** What each of the five figures draws, one sentence each. */
  roles: Readonly<Record<OrnamentSetRole, string>>;
  /** The looks it suits, first one the Book previews it on. */
  fitsLooks: readonly string[];
  /** A knob of its own beyond speed and delay (and value on the bar). */
  extra?: readonly 'mess'[];
}

export const ORNAMENT_SETS: readonly AtelierOrnamentSet[] = [
  { id: 'modern', title: 'Modern', fitsLooks: ['flat', 'calm-card', 'workbench', 'editorial'],
    summary: 'Hairlines, brackets, rulers and one accent square: quiet and exact.',
    roles: {
      frame: 'A hairline round the card, two corner brackets growing out of opposite corners, one accent square and five ticks.',
      rule: 'An accent lead, a hairline and ticks every 44 px.',
      bar: 'An outlined track with a ruler under it and a marker over the value.',
      bullets: 'Open squares, the first one filled with the accent.',
      strip: 'A ruler along the foot, a long tick every fifth.',
    } },
  { id: 'futuristic', title: 'Futuristic', fitsLooks: ['aurora', 'neon-dense', 'terminal', 'tdr'],
    summary: 'Chamfered outlines, readouts, lit segments and a crosshair: a ship\'s console.',
    roles: {
      frame: 'A chamfered outline drawn both ways from one cut, readout ticks, a segmented arc on a corner and a crosshair below.',
      rule: 'Two lines running to a centre diamond, brackets closing the ends.',
      bar: 'Blocks that light up in turn, the last lit one in the second colour, brackets at the ends.',
      bullets: 'Hexagons, the first one with a lit core.',
      strip: 'A dim rail with nodes, lit runs between them in turn.',
    } },
  { id: 'cyberpunk', title: 'Cyberpunk', fitsLooks: ['neon-dense', 'terminal', 'broadcast'],
    summary: 'Neon outlines with a shifted ghost, circuit traces and vias: a city at night.',
    roles: {
      frame: 'A neon outline with a shifted ghost of three runs, and circuit traces leaving every side, turning at 45 degrees into vias.',
      rule: 'A three-line bus with one 45-degree jog and a via at each end.',
      bar: 'A neon track, data packets in the filled run and a cursor at the value.',
      bullets: 'A via with a short stub, the first one lit.',
      strip: 'Three traces along the foot, each jogging twice.',
    } },
  { id: 'vibrant', title: 'Vibrant', fitsLooks: ['carnival', 'vivid', 'sticker', 'riso'],
    summary: 'Thick wavy ribbons in four colours and confetti: a party.',
    roles: {
      frame: 'A thick wavy ribbon on each side, each in its own colour, and confetti round the card.',
      rule: 'Two waves half a period apart, a dot at each end.',
      bar: 'A rounded track, a wave riding the filled run and a star where it ends.',
      bullets: 'Dots in three colours, each with a small one bouncing beside it.',
      strip: 'A zigzag in four colour runs.',
    } },
  { id: 'emotional', title: 'Emotional', fitsLooks: ['dawn', 'lounge', 'calm-card'],
    summary: 'Hand-drawn lines, a loop, falling petals and a heartbeat: soft and personal.',
    roles: {
      frame: 'The outline drawn twice by hand, each pass a little off the other, a curl at one corner and petals falling at the other.',
      rule: 'A handwritten line that ties one loop in the middle.',
      bar: 'A soft pencil track, a thicker stroke over the value and a petal where it stops.',
      bullets: 'Petals in three soft colours, drifting into place.',
      strip: 'A quiet line that beats once in the middle.',
    } },
  { id: 'dramatic', title: 'Dramatic', fitsLooks: ['stage', 'poster', 'broadsheet', 'billboard'],
    summary: 'Heavy rules, blades, diamonds and rays: a curtain about to rise.',
    roles: {
      frame: 'A heavy rule opened from the top centre both ways, a fine inner rule, diamonds on the corners, swashes on top and rays below.',
      rule: 'A blade, thickest in the middle, a hairline under it and a diamond at its heart.',
      bar: 'A dark track in a fine rule, a mark and a diamond at the value.',
      bullets: 'Diamonds inside fine outlines.',
      strip: 'Two swords drawn out from a centre diamond.',
    } },
  { id: 'symmetrical', title: 'Symmetrical', fitsLooks: ['gallery', 'editorial', 'kirjapaino', 'broadsheet'],
    summary: 'Mirrored halves, rosettes and scrolls in pairs: balance itself.',
    roles: {
      frame: 'Both halves drawn from the top centre to meet at the bottom, an inner rule, rosettes on the corners and mirrored scrolls.',
      rule: 'A rosette in the middle, lines growing out both ways and a scroll at each end.',
      bar: 'A rounded track, mirrored end brackets and a mark at the middle.',
      bullets: 'Four-petal rosettes turning in.',
      strip: 'Rosettes at the centre and the quarters, diamonds between them, all in pairs.',
    } },
  { id: 'chaotic', title: 'Chaotic', fitsLooks: ['riso', 'brutalist', 'sticker'], extra: ['mess'],
    summary: 'Scribbles, knots and splatter, seeded so the same mess draws every time; mess sets how far it wanders.',
    roles: {
      frame: 'Three scribbled loops in three inks, a knot on one corner and a splatter at another.',
      rule: 'A wandering line that ties small loops on its way, an echo under it.',
      bar: 'A scribbled outline and a zigzag hatched over the value.',
      bullets: 'Small knots in three inks.',
      strip: 'Three walks crossing one another along the foot.',
    } },
  { id: 'velocity', title: 'Velocity', fitsLooks: ['broadcast', 'billboard', 'vivid', 'poster'],
    summary: 'Speed lines, tapering streaks and chevrons, everything drawn left to right and speeding up.',
    roles: {
      frame: 'Speed lines trailing off one edge, the top edge shooting across into a chevron, two lines under the card and chevrons pointing on.',
      rule: 'A streak that thickens toward its point, two thinner lines riding beside it.',
      bar: 'A striped fill, a chevron at the value with speed lines trailing it.',
      bullets: 'Chevrons.',
      strip: 'A burst of speed lines along the foot.',
    } },
  { id: 'art-deco', title: 'Art deco', fitsLooks: ['lounge', 'gallery', 'kirjapaino', 'stage'],
    summary: 'Stepped corners, sunbursts, fans and scallops: a 1920s lobby.',
    roles: {
      frame: 'Three stepped rules, the outer one heaviest, a rising sun on top and a setting one below.',
      rule: 'Three lines from each end closing in on a small sun and a diamond.',
      bar: 'A double rule round the track and stepped marks under the quarters.',
      bullets: 'Quarter suns.',
      strip: 'A row of scallops over a rule, every other one holding a sun.',
    } },
  { id: 'crystal', title: 'Crystal', fitsLooks: ['aurora', 'calm-card', 'dawn', 'flat'],
    summary: 'Frost arms branching at 60 degrees, flakes and facets: cold and clear.',
    roles: {
      frame: 'From every corner an arm of frost grows along each edge, branching outward, a crystal in each corner.',
      rule: 'A flake in the middle with branching arms growing out both ways.',
      bar: 'A light track, twigs of frost on the filled run and a faceted point at the value.',
      bullets: 'Small snowflakes.',
      strip: 'A band of facets between two rules, every third one filled.',
    } },
];

export const ORNAMENT_SET_IDS: readonly string[] = ORNAMENT_SETS.map((s) => s.id);

const byId = new Map(ORNAMENT_SETS.map((s) => [s.id, s]));

export function ornamentSetById(id: string): AtelierOrnamentSet | undefined {
  return byId.get(id);
}
