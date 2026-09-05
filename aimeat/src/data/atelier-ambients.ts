/**
 * @file src/data/atelier-ambients.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE AMBIENT REGISTRY — every background animation the Atelier kit ships
 *   (sdk-libs/atelier/ambient-presets.js), described so an AI can CHOOSE one and measured so
 *   the contrast matrix can PROVE it. The ambient is the kit's one declared exception to
 *   "nothing loops idle" (wish-atelier-ambient-visuals, 2026-09-05): a single layer behind the
 *   app that may move on its own, the way the PlayStation 3's wave did, and that stops when
 *   nobody can see it, when the person asks for less motion, and when the OS does.
 *
 *   THE LOOK DECIDES. Each look names its ambient (or none) on the contract's --ak-ambient token
 *   with its own --ak-ambient-alpha; an app overrides through app({ ambient }) or its stored
 *   arrangement; a Design Book part carries a proven combination. Every colour the layer paints
 *   is read from the --ak-* tokens at mount and again on a theme, palette or look change — no
 *   literal colour, ever.
 *
 *   TWO VOLUMES, ONE RULE. A look that stands on the palette's own page may run a field preset
 *   only at the page whisper (peak × alpha within the AK-PAGE cap, 8%), exactly as its still
 *   page ground is held; a WORLD that owns its ground (lounge, dawn, stage, broadcast) may run
 *   it as loud as the ink allows, because the matrix proves the words on it. The shipped
 *   default alpha of every field preset sits at the whisper, so a preset named without a
 *   number is legal on every look; the worlds turn it up in their own tokens.
 *
 *   ONE ENTRY, THREE READERS: the kit's renderers (pinned to these numbers by
 *   test/unit/atelier-ambients.test.ts), the validators (app-ui/validate.ts refuses a preset or
 *   a bound this file does not know), and the words (the ui catalogue, the Atelier prompt).
 * @structure AtelierAmbient · AMBIENTS · AMBIENT_IDS · AMBIENT_NONE · AMBIENT_BOUNDS ·
 *   ambientById() · isAmbientValue()
 * @usage
 *   import { AMBIENTS, AMBIENT_BOUNDS, ambientById } from '../data/atelier-ambients.js';
 * @version-history
 *   v1.2.0 — 2026-09-05 — THE GENERATORS (wish-atelier-post-process-effects, stage 3): plasma
 *     and lava, two fields drawn per pixel at a fraction of the size, and tunnel, a sparse
 *     preset of rings and spokes. A generator makes a moving field from nothing, so it is an
 *     ambient preset like the six before it; a filter, which transforms what is already
 *     painted, lives in atelier-effects.ts.
 *   v1.1.0 — 2026-09-05 — shelfAlpha: the alpha the Design Book's seeded part shows each preset
 *     at, on the first look it fits — a world that owns its ground — so the shelf shows the
 *     wave at eight tenths on lounge rather than the whisper the bare preset ships at. The
 *     propose bench proves every seed on that look, and the unit test proves it earlier.
 *   v1.0.1 — 2026-09-05 — lounge and dawn exist: the fits lists name them.
 *   v1.0.0 — 2026-09-05 — Initial: the six shipped presets (waves, aurora, dust, grid, static,
 *     ink), described for choosing and measured for proving (wish-atelier-ambient-visuals).
 */

export interface AtelierAmbient {
  /** The preset id: the value of --ak-ambient, of data-ak-ambient on the layer, and the
   *  renderer's key in the kit. */
  id: string;
  /** What the eye sees — plain words, no geometry jargon. */
  feel: string;
  /** What it evokes — the registers it belongs to. */
  evokes: string;
  /** How it is drawn. `css` runs on the compositor and never touches script; `canvas` is a
   *  Canvas 2D loop; `webgl+canvas` tries a shader first and falls back to the 2D loop. */
  technique: 'canvas' | 'css' | 'webgl+canvas';
  /** The --ak-* tokens the renderer samples. Every preset also reads --ak-bg against --ak-ink
   *  to know whether it paints on a dark or a light ground. */
  reads: string[];
  /** How the matrix proves it. A FIELD lays pigment under the words: body ink and accent text
   *  are proven readable over every token in `pigments` composited at peak × alpha, and on a
   *  look that does not own its ground the field is held to the page whisper. SPARSE (motes,
   *  lines) is not a ground a word sits on, so only its peak is bounded. */
  proof: 'field' | 'sparse';
  /** For a field: the tokens it lays down as a ground (a subset of `reads`); empty for sparse. */
  pigments: string[];
  /** The strongest pigment the layer composites anywhere at alpha 1, as a share of the page
   *  (0..1). The renderer is pinned to it and the matrix composites exactly this. */
  peak: number;
  /** How the pigment lands: `over` is source-over (what a canvas does), `mix` is an OKLab
   *  color-mix (what the CSS lobes do). */
  blend: 'over' | 'mix';
  /** The alpha the preset ships at when a look or an app names none — at the whisper for a
   *  field, so the bare preset is legal on every look. */
  defaultAlpha: number;
  /** The alpha the Design Book's shelf shows it at, on the first look it fits (a world that
   *  owns its ground, so the matrix proves it loud): the seeded part's alpha. */
  shelfAlpha: number;
  /** The speed the preset ships at (1 = the design speed). */
  defaultSpeed: number;
  /** Frames per second the loop is gated to; 0 for a compositor animation. */
  fps: number;
  /** Looks it belongs in, best first — the preview's default look and the prompt's hint. */
  fitsLooks: string[];
  /** Why it is what it is. */
  note: string;
}

/** The value of --ak-ambient that switches the layer off. */
export const AMBIENT_NONE = 'none';

/** The ONE place the bounds live: the kit clamps to them, the validators refuse outside them. */
export const AMBIENT_BOUNDS = {
  alpha: [0, 1],
  speed: [0.25, 2],
} as const;

export const AMBIENTS: readonly AtelierAmbient[] = [
  {
    id: 'waves',
    feel: 'Two or three translucent ribbons crossing the screen in slow sine curves, a soft glow along each, a few specks rising — the PlayStation 3 wave, in the look\'s own colours.',
    evokes: 'A console at rest, a lounge, a late hour; the calm of a machine that is waiting for you.',
    technique: 'webgl+canvas',
    reads: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3', '--ak-ink', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3'],
    peak: 0.35,
    blend: 'over',
    defaultAlpha: 0.22,
    shelfAlpha: 0.8,
    defaultSpeed: 1,
    fps: 30,
    fitsLooks: ['lounge', 'stage'],
    note: 'Additive on a dark ground, where light adds up the way it does on a screen; low-alpha source-over on a light one, because additive on white washes to nothing. The ribbons are drawn at half resolution and upscaled: the upscale is the glow, and it costs a quarter of the pixels. Lounge owns its navy and runs it at 0.8; on a palette page the whisper is all there is.',
  },
  {
    id: 'aurora',
    feel: 'The kit\'s four-lobe aurora, alive: the colour lobes drift across the page over a minute, the way the hero band already breathes.',
    evokes: 'Long-exposure light, the vivid house register at full volume, a launch page.',
    technique: 'css',
    reads: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3'],
    peak: 0.26,
    blend: 'mix',
    defaultAlpha: 0.3,
    shelfAlpha: 0.9,
    defaultSpeed: 1,
    fps: 0,
    fitsLooks: ['dawn', 'aurora', 'vivid'],
    note: 'The one preset with no script: an oversized layer of radial lobes tweened on transform by the compositor, so it never repaints a page-sized gradient. Dawn owns its warm paper and runs it at 0.9; the aurora look stands on the palette page and keeps it at the whisper.',
  },
  {
    id: 'dust',
    feel: 'Sparse motes drifting up and sideways at three depths: the near ones large and soft, the far ones pinpricks.',
    evokes: 'A spotlit stage, a projector beam, a quiet room with the sun on it.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-ink', '--ak-bg'],
    proof: 'sparse',
    pigments: [],
    peak: 0.5,
    blend: 'over',
    defaultAlpha: 0.6,
    shelfAlpha: 0.7,
    defaultSpeed: 1,
    fps: 30,
    fitsLooks: ['stage', 'lounge', 'gallery'],
    note: 'Sixty to a hundred and twenty motes scaled to the area, depth driving size, alpha, speed and sway. Points, not a ground: a word never sits on one, so the matrix bounds how loud they are and asks nothing else.',
  },
  {
    id: 'grid',
    feel: 'A perspective floor grid running toward the viewer, its lines fading into a glow at the horizon.',
    evokes: 'Synthwave, an arcade cabinet, a machine room, the eighties\' idea of the future.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-spectrum-2', '--ak-bg'],
    proof: 'sparse',
    pigments: [],
    peak: 0.6,
    blend: 'over',
    defaultAlpha: 0.5,
    shelfAlpha: 0.5,
    defaultSpeed: 1,
    fps: 30,
    fitsLooks: ['neon-dense', 'terminal', 'lounge'],
    note: 'Forty stroked lines a frame, which is why it is a canvas and not a transformed CSS plane: a perspective-transformed plane rasterises at its transformed size times the device pixel ratio, tens of megabytes on a phone, and would need a second pause mechanism of its own.',
  },
  {
    id: 'static',
    feel: 'Phosphor noise flickering twelve times a second under faint scanlines: a television between channels, at a whisper.',
    evokes: 'Broadcast, a CRT, tape, the ident before the programme.',
    technique: 'canvas',
    reads: ['--ak-ink', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-ink'],
    peak: 0.3,
    blend: 'over',
    defaultAlpha: 0.25,
    shelfAlpha: 0.35,
    defaultSpeed: 1,
    fps: 12,
    fitsLooks: ['broadcast', 'terminal'],
    note: 'Four to six noise tiles generated once and blitted at random offsets, so a frame is a pattern fill and not a per-pixel loop. The scanlines are CSS on the layer. Noise covers every pixel, so it is proven as a field of ink over the page.',
  },
  {
    id: 'ink',
    feel: 'Five or six large soft blots of colour breathing in and out over half a minute, like ink wash spreading on wet paper.',
    evokes: 'Paper, a print studio, a gallery wall, slow time.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-spectrum-3', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-accent', '--ak-spectrum-3'],
    peak: 0.22,
    blend: 'over',
    defaultAlpha: 0.35,
    shelfAlpha: 0.7,
    defaultSpeed: 1,
    fps: 24,
    fitsLooks: ['riso', 'gallery', 'broadsheet'],
    note: 'Drawn at a sixth of the resolution and upscaled: the blur is free and the frame is cheap. Slow on purpose — the eye should notice it has changed, never see it move.',
  },
  {
    id: 'plasma',
    feel: 'Slow interference bands of colour rolling over one another, the old demo-scene plasma: no edges, only bloom sliding into bloom.',
    evokes: 'A demo party, a screensaver on a CRT, the nineties\' idea of a computer at play, a warm room late at night.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-accent', '--ak-spectrum-2', '--ak-spectrum-3'],
    peak: 0.32,
    blend: 'over',
    defaultAlpha: 0.25,
    shelfAlpha: 0.8,
    defaultSpeed: 1,
    fps: 24,
    fitsLooks: ['lounge', 'aurora', 'vivid'],
    note: 'Four sines per pixel over an eighth-resolution image (about eighteen thousand pixels at a laptop size), a sine table and a 256-entry colour ramp built once per palette, then one putImageData and the upscale: the upscale IS the softness. Every pixel carries pigment, so it is a field proven at peak × alpha.',
  },
  {
    id: 'lava',
    feel: 'Five or six blobs of colour rising and sinking through the dark, stretching as they move and merging when they meet, the way wax does in a lava lamp.',
    evokes: 'A lava lamp, a lounge in 1968, a slow evening, a shop window after closing.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-spectrum-3', '--ak-bg'],
    proof: 'field',
    pigments: ['--ak-accent', '--ak-spectrum-3'],
    peak: 0.3,
    blend: 'over',
    defaultAlpha: 0.25,
    shelfAlpha: 0.7,
    defaultSpeed: 1,
    fps: 24,
    fitsLooks: ['stage', 'lounge'],
    note: 'Metaballs at a sixth of the resolution: every blob\'s field is summed per pixel and thresholded, so two that touch fuse into one, with a rim in the third hue where the field is thin. A blob squashes along its travel. Drawn into an image and upscaled, which is where the softness comes from.',
  },
  {
    id: 'tunnel',
    feel: 'Rings rushing outward from a point deep in the screen, a few spokes turning slowly through them: the view down a tunnel that never ends.',
    evokes: 'A wormhole, a demo-scene intro, the starfield\'s cousin, arriving somewhere at speed.',
    technique: 'canvas',
    reads: ['--ak-accent', '--ak-spectrum-2', '--ak-bg'],
    proof: 'sparse',
    pigments: [],
    peak: 0.55,
    blend: 'over',
    defaultAlpha: 0.5,
    shelfAlpha: 0.5,
    defaultSpeed: 1,
    fps: 30,
    fitsLooks: ['terminal', 'neon-dense', 'lounge'],
    note: 'Twenty-four stroked rings on a perspective spacing with a scrolling phase, and twelve spokes turning at a fraction of the ring speed: about forty strokes a frame, lines and not a ground, so the matrix bounds how loud they are and asks nothing else.',
  },
];

export const AMBIENT_IDS: readonly string[] = AMBIENTS.map((a) => a.id);

const byId = new Map(AMBIENTS.map((a) => [a.id, a]));

/** The preset, or undefined. */
export function ambientById(id: string): AtelierAmbient | undefined {
  return byId.get(id);
}

/** True for a preset id or for none — the values --ak-ambient may take. */
export function isAmbientValue(value: unknown): value is string {
  return value === AMBIENT_NONE || (typeof value === 'string' && byId.has(value));
}
