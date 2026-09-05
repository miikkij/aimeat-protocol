/**
 * @file src/data/atelier-effects.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE EFFECTS REGISTRY — every post-process effect the Atelier kit ships
 *   (sdk-libs/atelier/effects.js on content, ambient-post.js on the layer), described so an AI
 *   can CHOOSE one, bounded so the kit and the validators clamp to the same numbers, and
 *   classified so the contrast matrix can PROVE the ones that touch colour
 *   (wish-atelier-post-process-effects, 2026-09-05).
 *
 *   TWO MECHANISMS, ONE SHELF EACH. A GENERATOR makes a moving field from nothing (plasma,
 *   lava, tunnel) and is an ambient preset in atelier-ambients.ts. A FILTER transforms what is
 *   already painted, and that is what this file holds: a CSS filter with SVG primitives for a
 *   warp or a duotone, plain filter functions for a recolour, a gradient overlay for the
 *   vignette and the scanlines; and, on the ambient LAYER, a second pass in the layer's own
 *   loop (kaleidoscope, ripple, vhs, glitch), where continuous motion is allowed because the
 *   layer already moves.
 *
 *   LIVING MOTION STAYS BEHIND THE WORDS (the decision of 2026-09-05). On content an effect is
 *   STILL (a vignette, a duotone) or a MOMENT (a glitch on a cue, gone on `finished`); `living`
 *   is legal only as a post pass on the ambient layer or inside an ambientStage. The validator
 *   refuses `living` on a block, so the kit's zero-idle gate and its "exactly two infinite
 *   animations" claim stay true by construction.
 *
 *   A VOLUME SAYS WHERE IT MAY LAND. `ground` may sit under body text (colour and overlay
 *   effects only, and the matrix proves the words on it); `prop` is one object — a hero's
 *   image band, a figure, a picture card; `zone` is a band or the layer. A prop or zone effect
 *   never lands on a component that bears text: EFFECT_HOSTS names the exceptions, so the rule
 *   is declared once and every other component is text-bearing by default.
 *
 *   ONE CLAMP, TWO CONSUMERS. Every parameter is declared here with its bounds and default. The
 *   kit writes the clamped number both as a `--ak-fx-<id>-<param>` custom property and into the
 *   SVG attribute; the validators refuse a value outside the bounds with the bounds in words;
 *   the matrix proves the colour effects at the same resolved numbers.
 * @structure AtelierEffect · AtelierEffectParam · EFFECT_TOKENS · EFFECT_TOKEN_VARS · EFFECTS ·
 *   EFFECT_IDS · POST_IDS · EFFECT_HOSTS · POST_MAX · effectById() · isTextBearing() ·
 *   clampParam() · resolveParams()
 * @usage
 *   import { EFFECTS, effectById, resolveParams } from '../data/atelier-effects.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial: the nine filters (scanlines, vignette, duotone, recolour,
 *     distort, glitch, vhs, ripple, kaleidoscope) (wish-atelier-post-process-effects, stage 2).
 */

/** How the effect is drawn on CONTENT. `css` is filter functions, a mask or a gradient overlay
 *  and never touches script; `svg` is a CSS filter backed by an SVG graph the kit injects;
 *  `canvas` has no content-side rendering at all and exists only as a post pass on the layer. */
export type EffectEngine = 'css' | 'svg' | 'canvas';
/** Where the effect may land: under body text, on one object, or on a band or the layer. */
export type EffectVolume = 'ground' | 'prop' | 'zone';
/** How it moves: never, once on a cue, or for as long as the layer runs. */
export type EffectMotion = 'still' | 'moment' | 'living';
/** How the matrix proves it: by mapping the grounds and the inks through the same transform
 *  and holding the mapped pairs to the floor, by compositing ink over the ground at the darkest
 *  point, or not at all (the volume rule is the whole guarantee). */
export type EffectProof = 'colour' | 'overlay' | 'none';

export type AtelierEffectParam =
  | {
    name: string;
    kind: 'number';
    min: number;
    max: number;
    default: number;
    /** The unit the number is written in; absent for a plain ratio or a count. */
    unit?: 'px' | 'deg' | 'ms';
    /** What turning it does, in the words the catalogue hands an AI. */
    what: string;
  }
  | {
    name: string;
    kind: 'token';
    /** The token names the parameter may take (EFFECT_TOKENS). */
    tokens: readonly string[];
    default: string;
    what: string;
  };

export interface AtelierEffect {
  /** The effect id: the `.ak-fx-<id>` class, the `--ak-fx-<id>-*` property prefix, and the
   *  post pass's key in the kit. */
  id: string;
  /** What the eye sees — plain words, no filter jargon. */
  feel: string;
  /** What it evokes — the registers it belongs to. */
  evokes: string;
  engine: EffectEngine;
  /** The volumes it may land at. */
  volume: readonly EffectVolume[];
  /** The motions it may run at ON CONTENT; a post pass on the layer is always living. */
  motion: readonly EffectMotion[];
  /** True when it may post-process what is BEHIND an element (backdrop-filter). Only a
   *  filter-function engine qualifies until the browser proves it honours an SVG-backed
   *  backdrop; the validator refuses the rest naming that reason. */
  backdrop: boolean;
  /** True when it exists as a pass on the ambient layer (ambient-post.js). */
  post: boolean;
  proof: EffectProof;
  params: readonly AtelierEffectParam[];
  /** The --ak-* tokens the effect samples on content (the kit rewrites them on a theme,
   *  palette or look change). */
  reads: readonly string[];
  /** Looks it belongs in, best first — the shelf seed's look and the prompt's hint. */
  fitsLooks: readonly string[];
  /** Why it is what it is. */
  note: string;
}

/** The token names a colour parameter may take, and the contract token each one is. */
export const EFFECT_TOKENS: readonly string[] = ['ink', 'bg', 'accent', 'spectrum-2', 'spectrum-3'];
export const EFFECT_TOKEN_VARS: Readonly<Record<string, string>> = {
  ink: '--ak-ink',
  bg: '--ak-bg',
  accent: '--ak-accent',
  'spectrum-2': '--ak-spectrum-2',
  'spectrum-3': '--ak-spectrum-3',
};

/** How many post passes the ambient layer chains at most: a third pass costs a third full
 *  read of the frame and buys nothing a second did not. */
export const POST_MAX = 2;

export const EFFECTS: readonly AtelierEffect[] = [
  {
    id: 'scanlines',
    feel: 'Fine horizontal lines over the picture, like the raster of a tube television seen up close.',
    evokes: 'Broadcast, a CRT monitor, an arcade cabinet, the ident before the programme.',
    engine: 'css',
    volume: ['ground', 'prop'],
    motion: ['still'],
    backdrop: false,
    post: false,
    proof: 'overlay',
    params: [
      { name: 'pitch', kind: 'number', min: 2, max: 8, default: 3, unit: 'px', what: 'The distance from one line to the next.' },
      { name: 'strength', kind: 'number', min: 0, max: 0.3, default: 0.12, what: 'How dark the lines are: the share of ink laid on each one. Under words, about a quarter is what every look carries; the matrix says per look.' },
    ],
    reads: ['--ak-ink'],
    fitsLooks: ['broadcast', 'terminal', 'neon-dense'],
    note: 'A repeating linear gradient of ink at `strength`, one line per `pitch`, as an overlay pseudo-element: no script, no filter, drawn once by the compositor. On a ground the matrix proves body ink on the darkest line (AK-FX overlay): measured 2026-09-05, 0.25 passes every look and palette, 0.30 passes the six worlds that own their ground and fails the palette page by a hair (4.45 on mist/dark). On a picture the whole range is open.',
  },
  {
    id: 'vignette',
    feel: 'The edges and corners fall into shadow and the middle stays lit, the way a lens draws the eye to the centre.',
    evokes: 'A photograph, a cinema frame, a spotlit stage, a quiet focus.',
    engine: 'css',
    volume: ['ground', 'prop'],
    motion: ['still'],
    backdrop: false,
    post: false,
    proof: 'overlay',
    params: [
      { name: 'size', kind: 'number', min: 0.4, max: 1, default: 0.75, what: 'How far from the centre the light reaches before the shadow begins, as a share of the box.' },
      { name: 'strength', kind: 'number', min: 0, max: 0.7, default: 0.25, what: 'How dark the corners get: the share of ink at the very edge. Under words, about a quarter is what every look carries and a third is a world\'s limit; a picture takes the whole range.' },
    ],
    reads: ['--ak-ink'],
    fitsLooks: ['gallery', 'stage', 'lounge', 'editorial'],
    note: 'A radial gradient of ink, clear inside `size` and `strength` at the edge, as an overlay pseudo-element. On a ground the matrix proves body ink at the darkest corner (AK-FX overlay), because a caption or a footer line sits there: measured 2026-09-05, 0.25 passes every look and palette, 0.35 passes four worlds, 0.40 fails everywhere (3.43 on mist/dark), so the default is the quarter and the deep photographic vignette is a picture effect.',
  },
  {
    id: 'duotone',
    feel: 'The picture reduced to two colours: every shadow becomes one token, every highlight the other, and the tones between run from one to the other.',
    evokes: 'A screen print, a risograph, a concert poster, a magazine cover from the sixties.',
    engine: 'svg',
    volume: ['prop'],
    motion: ['still'],
    backdrop: false,
    post: false,
    proof: 'colour',
    params: [
      { name: 'shadow', kind: 'token', tokens: EFFECT_TOKENS, default: 'ink', what: 'The token the shadows become.' },
      { name: 'light', kind: 'token', tokens: EFFECT_TOKENS, default: 'bg', what: 'The token the highlights become.' },
      { name: 'strength', kind: 'number', min: 0, max: 1, default: 1, what: 'How far toward the two-colour picture to go; below 1 the original shows through.' },
    ],
    reads: ['--ak-ink', '--ak-bg', '--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3'],
    fitsLooks: ['riso', 'gallery', 'broadsheet', 'vivid'],
    note: 'feColorMatrix (the luminance rows) → feComponentTransfer with a two-entry table per channel, shadow to light (a straight ramp between the two tokens, the same map duotoneSrgb() computes) → feComposite arithmetic mixing back toward the source by 1 − strength; color-interpolation-filters="sRGB" so the browser and the proof agree. A PICTURE effect, never a ground, and the matrix is why: it maps page, card, ink, dimmed ink and accent text through the same ramp (AK-FX colour), and measured on 2026-09-05 the dimmed ink lands in the middle of a two-colour ramp on 18 of 19 looks (as low as 1.2:1), because a ramp between two inks has half its range where secondary text sits. Words under a duotone are unreadable by construction; a hero image, a picture card or a figure is what it is for.',
  },
  {
    id: 'recolour',
    feel: 'The same picture with its hues turned round the wheel and its saturation pushed or pulled: a warm scene made cold, a dull one made vivid.',
    evokes: 'A colour grade, a film stock, a mood shifted without a repaint.',
    engine: 'css',
    volume: ['ground', 'prop'],
    motion: ['still'],
    backdrop: true,
    post: false,
    proof: 'colour',
    params: [
      { name: 'hue', kind: 'number', min: -180, max: 180, default: 0, unit: 'deg', what: 'How far round the colour wheel to turn every hue.' },
      { name: 'saturate', kind: 'number', min: 0.5, max: 2, default: 1, what: 'How vivid the colours become: 1 leaves them, 0.5 halves them, 2 doubles them.' },
    ],
    reads: [],
    fitsLooks: ['vivid', 'aurora', 'lounge', 'stage'],
    note: 'filter: hue-rotate() saturate(), plain filter functions with no SVG, which is why it is the ONE effect allowed on backdrop-filter (post-processing what is behind a card: the ambient seen through it). The shorthand functions run in sRGB, and the matrix runs the same two matrices (hueRotateSrgb, saturateSrgb) on page, card, ink and accent text and proves the mapped pairs (AK-FX colour): a hue rotation is a linear rotation in sRGB and does not keep luminance, which is why it is measured rather than trusted. Measured 2026-09-05: any hue at saturate 1.5 or under passes every look; saturate 2 passes the six worlds and fails the palette page on accent text (3.65).',
  },
  {
    id: 'distort',
    feel: 'The picture seen through rippled glass: edges wander, straight lines bend a little, the whole thing breathes when it moves.',
    evokes: 'Old window glass, heat over a road, a dream sequence, water in a jar.',
    engine: 'svg',
    volume: ['prop'],
    motion: ['still', 'moment'],
    backdrop: false,
    post: false,
    proof: 'none',
    params: [
      { name: 'scale', kind: 'number', min: 2, max: 40, default: 12, unit: 'px', what: 'How far a pixel may be pushed: the warp\'s strength.' },
      { name: 'frequency', kind: 'number', min: 0.002, max: 0.05, default: 0.012, what: 'How fine the ripples are: low is a slow swell, high is a shimmer.' },
      { name: 'octaves', kind: 'number', min: 1, max: 2, default: 1, what: 'How much fine detail the noise carries; two costs twice the paint.' },
      { name: 'duration', kind: 'number', min: 200, max: 1500, default: 700, unit: 'ms', what: 'How long a moment takes to swell to full scale and settle back; a still ignores it.' },
    ],
    reads: [],
    fitsLooks: ['gallery', 'lounge', 'dawn', 'stage'],
    note: 'feTurbulence (fractalNoise at `frequency`, `octaves`, a fixed seed, stitched tiles) → feDisplacementMap on the source at `scale`, in a filter region of −6 % to 112 % so a scale-40 warp does not grow the paint area in silence. Prop only: the words it would bend are why the validator refuses it on a text-bearing block. A moment plays the scale up and back on WAAPI over one finite keyframe.',
  },
  {
    id: 'glitch',
    feel: 'For a fraction of a second the picture tears: slices jump sideways, the colour channels split, two bands invert what is under them, then it snaps back whole.',
    evokes: 'A corrupted signal, a cyberpunk title card, a hard cut, an alarm.',
    engine: 'css',
    volume: ['prop', 'zone'],
    motion: ['moment'],
    backdrop: false,
    post: true,
    proof: 'none',
    params: [
      { name: 'strength', kind: 'number', min: 0, max: 1, default: 0.6, what: 'How far the slices jump and how wide the channels split.' },
      { name: 'duration', kind: 'number', min: 200, max: 900, default: 420, unit: 'ms', what: 'How long the tear lasts before the picture snaps back.' },
    ],
    reads: ['--ak-accent', '--ak-spectrum-2'],
    fitsLooks: ['neon-dense', 'terminal', 'broadcast'],
    note: 'The vhs channel split at a shorter duration plus two overlay bands whose backdrop-filter (invert, a quarter-turn of hue) displaces what is beneath them, translated across on WAAPI; where backdrop-filter is missing the bands degrade to a tinted overlay. On the layer it runs as a post pass (slice offsets and a channel split) for as long as the layer does.',
  },
  {
    id: 'vhs',
    feel: 'A worn videotape: the red and blue fringes drift apart, a tracking band rolls up the picture, the whole frame shivers once and settles.',
    evokes: 'A home video, the late eighties, a rental from a corner shop, memory with the colour bleeding.',
    engine: 'svg',
    volume: ['zone'],
    motion: ['moment'],
    backdrop: false,
    post: true,
    proof: 'none',
    params: [
      { name: 'strength', kind: 'number', min: 0, max: 1, default: 0.5, what: 'How far the colour fringes drift and how tall the tracking band is.' },
      { name: 'duration', kind: 'number', min: 400, max: 1200, default: 800, unit: 'ms', what: 'How long the tape takes to settle.' },
    ],
    reads: ['--ak-ink'],
    fitsLooks: ['broadcast', 'lounge', 'terminal'],
    note: 'A chroma split set once for the moment (three feOffset + feColorMatrix channel branches screened together) and a tracking band on an overlay child riding a finite CSS keyframe on transform, compositor-only, plus a WAAPI filter swap at three offsets. Nothing animates the SVG: no SMIL, no per-frame script. On the layer it is a post pass (channel-offset draws, tracking bands, a noise tile through the seeded RNG).',
  },
  {
    id: 'ripple',
    feel: 'A ring spreads across the picture from its centre the way a drop lands on still water; on the layer the ground keeps rolling in slow horizontal waves.',
    evokes: 'Water, a pond, a lens, a touch that lands somewhere.',
    engine: 'svg',
    volume: ['zone'],
    motion: ['moment', 'living'],
    backdrop: false,
    post: true,
    proof: 'none',
    params: [
      { name: 'amplitude', kind: 'number', min: 0, max: 1, default: 0.4, what: 'How high the wave lifts the picture.' },
      { name: 'wavelength', kind: 'number', min: 20, max: 160, default: 60, unit: 'px', what: 'The distance from one crest to the next.' },
      { name: 'speed', kind: 'number', min: 0.25, max: 2, default: 1, what: 'How fast the rings spread (1 is the design speed).' },
    ],
    reads: [],
    fitsLooks: ['lounge', 'dawn', 'gallery'],
    note: 'A moment on content is one expanding ring: a feDisplacementMap on a radial map whose radius rides WAAPI, gone on finished. Living is layer-only: a per-strip sinusoidal shear in the layer\'s loop, one capability with one implementation per surface. Zone only, because the words it would lift are exactly what the volume rule protects.',
  },
  {
    id: 'kaleidoscope',
    feel: 'The layer folded into mirrored wedges around the centre, turning slowly: every drift in the field becomes a symmetric bloom.',
    evokes: 'A kaleidoscope, a mandala, a light show, a rose window.',
    engine: 'canvas',
    volume: ['zone'],
    motion: ['living'],
    backdrop: false,
    post: true,
    proof: 'none',
    params: [
      { name: 'segments', kind: 'number', min: 4, max: 12, default: 6, what: 'How many mirrored wedges the circle is cut into.' },
      { name: 'spin', kind: 'number', min: -1, max: 1, default: 0.15, what: 'How fast the wedges turn and which way; 0 holds still.' },
    ],
    reads: [],
    fitsLooks: ['lounge', 'aurora', 'vivid', 'stage'],
    note: 'Layer only: each frame the field is drawn once into a wedge, then mirrored and rotated `segments` times with clipped drawImage calls, a post pass in the layer\'s own loop. There is no content-side rendering, because a mirrored fold of a page of words is unreadable by construction.',
  },
];

export const EFFECT_IDS: readonly string[] = EFFECTS.map((e) => e.id);

/** The effects that exist as a pass on the ambient layer (`ambient.post` names them). */
export const POST_IDS: readonly string[] = EFFECTS.filter((e) => e.post).map((e) => e.id);

/**
 * THE EXCEPTIONS TO "EVERY COMPONENT BEARS TEXT": the mosaic components that are a picture, a
 * drawing or one big object rather than words, so a prop or zone effect may land on them. A
 * hero takes it on its image band (never its title); a figure is one numeral; the rest draw.
 * Append-only: a component joins by being an object a warp cannot make unreadable.
 */
export const EFFECT_HOSTS: readonly string[] = [
  'hero', 'figure', 'mediaCard', 'carousel', 'scene3d', 'crt', 'ring', 'waveform', 'chart', 'map',
];

/** True when a prop or zone effect may not land on this component, which is every component
 *  EFFECT_HOSTS does not name. */
export function isTextBearing(componentId: string): boolean {
  return !EFFECT_HOSTS.includes(componentId);
}

const byId = new Map(EFFECTS.map((e) => [e.id, e]));

/** The effect, or undefined — the validator words the refusal. */
export function effectById(id: string): AtelierEffect | undefined {
  return byId.get(id);
}

/** One value clamped into its declaration: a number into [min, max] (NaN and a non-number fall
 *  to the default), a token to one of the allowed names (anything else falls to the default).
 *  The kit clamps the same way; the validators REFUSE instead, so a stored layout never carries
 *  a number the words did not agree to. */
export function clampParam(param: AtelierEffectParam, value: unknown): number | string {
  if (param.kind === 'token') {
    return typeof value === 'string' && param.tokens.includes(value) ? value : param.default;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return param.default;
  return Math.min(param.max, Math.max(param.min, n));
}

/** Every parameter of an effect resolved: the given value clamped, or the default. Unknown
 *  names are dropped here (the validators refuse them by name before anything is stored). */
export function resolveParams(effect: AtelierEffect, given?: Record<string, unknown> | null): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of effect.params) out[p.name] = clampParam(p, given?.[p.name]);
  return out;
}
