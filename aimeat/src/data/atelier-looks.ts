/**
 * @file src/data/atelier-looks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE LOOK REGISTRY — every Atelier look as one data entry (TARGET-074, the look
 *   factory). A look is: token overrides on the --ak-* contract, a list of STRUCTURES (named,
 *   reusable page-shape recipes: the masthead, the joined frame, the full-bleed band), and the
 *   words a picker and the imagery pipeline use. From this ONE registry derive:
 *     (1) the generated stylesheet — tools/build-atelier-looks.ts emits
 *         public/lib/aimeat-atelier/looks.css, and pnpm check:atelier refuses drift;
 *     (2) the arithmetic gate — every entry is a @preset-block the 70-combination matrix runs;
 *     (3) the build prompt's look table (build-atelier-prompt.ts);
 *     (4) the mosaic catalogue's look list and look sheets (app-ui/registry.ts).
 *
 *   CREATING A NEW LOOK IS ADDING ONE ENTRY and running `pnpm build:atelier-looks` — the matrix
 *   then proves it against every palette and mode, which is the growth rule working instead of
 *   being remembered. This file exists because the developer's award-site references made the
 *   gap plain, and because hand-writing a preset block, a prompt row and a catalogue row for
 *   every look made each new look a project instead of a decision.
 *
 *   A LOOK NEVER SHIPS AN UNPROVEN COLOUR. Two legal forms: an EXPRESSION over the theme tokens
 *   (color-mix in oklab, the OKLCh spectrum rotations), or — for a WORLD — literal GROUNDS
 *   (bg/surface/surface-2/ink/ink-dim/line, one set per mode) plus dark-mode expressions
 *   (dusk), because the matrix runs every check against exactly those values. Freed from
 *   "never a colour" on 2026-08-29 at the developer's direction: the old rule protected
 *   readability by forbidding paper, phosphor and night, and the proof mechanism replaces the
 *   prohibition.
 * @structure AtelierStructure / AtelierLook · STRUCTURES · WORLD_LOOKS (re-exported) · LOOKS ·
 *   lookById()
 * @usage
 *   import { LOOKS, STRUCTURES } from '../data/atelier-looks.js';
 * @version-history
 *   v1.8.0 — 2026-09-05 — THE AMBIENT (wish-atelier-ambient-visuals): five looks name the one
 *     layer allowed to move at idle — aurora runs the aurora drift at the whisper, neon-dense
 *     and terminal the floor grid, broadcast the static, stage the dust — and two WORLDS arrive
 *     for it: lounge (a navy night with the wave through it, the PlayStation register) and dawn
 *     (warm paper with the aurora under it). Every look that names an ambient sets its own
 *     alpha and speed, so nothing is inherited, and the matrix proves each (AK-AMBIENT). THIS
 *     CHANGES THE IDLE BEHAVIOUR of the five: where they were still they now move, the weather
 *     switch appears in their bar, and app({ ambient: false }) or a stored { preset: 'none' }
 *     opts an app out. The six WORLDS moved whole to atelier-looks-worlds.ts (pure extraction,
 *     the 800-line cap, the move STRUCTURES made before them) and LOOKS composes them after the
 *     page looks, so terminal, riso and stage now list after aurora.
 *   v1.7.0 — 2026-09-02 — A FEEL PER LOOK: every entry declares the spring hand
 *     (--ak-spring-stiffness / --ak-spring-damping / --ak-spring-mass), so the kit's spring,
 *     drag and staggered entrance move the way the look moves: terminal at 380/32/0.8 is a
 *     state change, carnival at 200/12/1 swings twice, editorial at 120/26/1 never bounces.
 *     Speed and curve were already the look's (--ak-motion, --ak-ease); the physics was three
 *     numbers frozen in the primitive, which meant a spring felt the same under every look on
 *     the shelf. The contract carries the three (mode-independent) and REQUIRED_BASE makes the
 *     matrix prove each look resolves them.
 *   v1.6.0 — 2026-09-01 — BROADCAST: the night-gallery world the developer accepted on the
 *     Atelier Next canvas — two proven grounds (violet night, pale violet paper), maximum
 *     display weight with the accent landing a step off, printed offset depth in the spectrum
 *     hues, sticker tilt; the broadcast family's channel colours stay the contract's neons (a
 *     palette-derived retune muddied the signal yellow, so the look leaves them alone). The
 *     STRUCTURES moved whole to atelier-structures.ts (pure extraction, the 800-line cap) and
 *     are re-exported from here.
 *   v1.5.0 — 2026-08-29 — THE BONES FREED: two COMPOSITION structures. press-sheet (riso) — the
 *     masthead is giant display type ON the sheet, print-sticker KPI chips overlap its foot,
 *     unspanned units set themselves asymmetrically. marquee (stage) — the band fills three
 *     quarters of the window and the working surface rises over its bottom edge, staggered.
 *     The developer's point, finally heard: the skeleton was what never changed.
 *   v1.4.0 — 2026-08-29 — WORLDS OWN THEIR GROUNDS: grounds (proven literal ground pairs) and
 *     dusk (dark-mode expressions) join the entry shape; riso gets its paper, terminal goes
 *     permanently phosphor-on-black, stage permanently night, and the purity rule is reframed
 *     from "never a colour" to "never an UNPROVEN colour".
 *   v1.3.0 — 2026-08-28 — BILLBOARD: the whole screen is the poster — carnival's language with
 *     the measure column dropped (--ak-main-max 100%) and a half-viewport banner. The
 *     developer's ask: not everything is a lane in the middle of the screen.
 *   v1.2.0 — 2026-08-28 — CARNIVAL: the front-demo2 register joins the registry — a saturated
 *     three-hue banner mixed over ink (so AK-GRAD proves the action ink on every stop and the
 *     mesh cap never applies), brutalist offset depth, sticker tilt, maximum display weight.
 *     The developer pointed at the demo page and asked where the loud looks were; now it is one
 *     entry the matrix proves (2942 checks over 13 looks).
 *   v1.1.0 — 2026-08-28 — An explicit hero image survives the masthead: the structure's hero
 *     flattening (no band, no scrim, zero inline padding) scopes to :not(.ak-hero--image), so an
 *     editorial or broadsheet page with a generated cover keeps the photographic band and its
 *     scrim. Found by the first imagery-pipeline demo: the picture was paid for and never painted.
 *   v1.0.0 — 2026-08-27 — Initial: the seven hand-written presets become entries, five new looks
 *     arrive as proof the factory works (broadsheet, gallery, brutalist, terminal, aurora), and
 *     the three structures extracted from editorial/poster become shared vocabulary.
 */

// The structures live in atelier-structures.ts since 2026-09-01 (a pure move under the 800-line
// cap); they are re-exported here so every importer keeps the address it always had.
import { STRUCTURES, type AtelierStructure } from './atelier-structures.js';
export { STRUCTURES, type AtelierStructure };
// The WORLDS (the looks that own their ground) live in atelier-looks-worlds.ts since 2026-09-05,
// the same pure move under the same cap; LOOKS below composes them after the page looks.
import { WORLD_LOOKS } from './atelier-looks-worlds.js';
export { WORLD_LOOKS };

// The SHAPE of a look lives in atelier-look-shape.ts (2026-09-05), so this file and the worlds
// file can both fill it without importing each other; re-exported so every importer keeps the
// address it always had.
import type { AtelierLook } from './atelier-look-shape.js';
export type { AtelierLook };

// ── The looks ────────────────────────────────────────────────────────────────────────────────

/** The looks that stand on the palette's own page — the contract, tuned. */
const PAGE_LOOKS: readonly AtelierLook[] = [
  {
    id: 'vivid',
    feel: 'the default — an aurora hero on the derived spectrum, tinted cards, glass chrome, a real entrance; pick when unsure',
    imagery: 'bright layered gradient-mesh abstract, soft grain, airy light ground',
    structures: [],
    tokens: {
      // The house hand: arrives promptly and stops just short of a bounce.
      '--ak-spring-stiffness': '170',
      '--ak-spring-damping': '20',
      '--ak-spring-mass': '1',
    },
    note: 'The base contract IS vivid; this entry exists for the picker and the prompt table. The spring hand restates the contract\'s own three numbers so a vivid block nested inside a loud look keeps the house feel instead of inheriting its bounce.',
  },
  {
    id: 'flat',
    feel: 'the deliberate opt-out: no decoration, no entrance',
    imagery: 'none — flat means flat',
    structures: [],
    tokens: {
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-page-image': 'none',
      '--ak-grain': 'none',
      '--ak-blur': '0px',
      '--ak-glass': 'var(--ak-surface)',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)))',
      '--ak-enter-distance': '0px',
      '--ak-enter-stagger': '0ms',
      '--ak-elev-2': 'var(--ak-elev-1)',
      '--ak-weight-display': '650',
      // Instant and dead flat: overdamped, so a move that must happen never bounces on arrival.
      '--ak-spring-stiffness': '320',
      '--ak-spring-damping': '34',
      '--ak-spring-mass': '0.9',
    },
    note: 'The opt-out is a choice the spec records, not an accident — and even flat darkens the action fill, because body-size text on the raw accent fails on the aimeat palette.',
  },
  {
    id: 'calm-card',
    feel: 'quiet professional product',
    imagery: 'minimal line illustration, single accent hue, generous ground',
    structures: [],
    tokens: {
      '--ak-page-image': 'none',
      '--ak-grain': 'none',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'radial-gradient(at 30% 20%, color-mix(in oklab, var(--ak-accent) 8%, var(--ak-bg)), transparent 60%)',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 80%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 70%, var(--ak-ink)))',
      '--ak-elev-2': 'var(--ak-elev-1)',
      '--ak-enter-distance': '8px',
      '--ak-enter-stagger': '30ms',
      '--ak-hero-min': '18dvh',
      '--ak-weight-display': '650',
      // Quiet and sure: critically damped, so it settles once and does not restate itself.
      '--ak-spring-stiffness': '150',
      '--ak-spring-damping': '24',
      '--ak-spring-mass': '1',
    },
    note: 'A whisper of tint, hairlines over shadows, a lower hero, a shorter entrance. Calm, not flat.',
  },
  {
    id: 'editorial',
    feel: 'magazine: masthead on rules, giant joined numerals, cells in one frame, slow fades',
    imagery: 'warm duotone photographic style',
    structures: ['masthead', 'joined'],
    tokens: {
      '--ak-main-max': '76rem',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-page-image': 'none',
      '--ak-grain': 'none',
      '--ak-blur': '0px',
      '--ak-glass': 'var(--ak-surface)',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)))',
      '--ak-elev-1': 'none',
      '--ak-elev-2': 'none',
      '--ak-radius': '8px',
      '--ak-radius-sm': '6px',
      '--ak-text-hero': 'clamp(2.2rem, 7vw, 3.4rem)',
      '--ak-weight-display': '800',
      '--ak-enter-distance': '0px',
      '--ak-enter-stagger': '60ms',
      '--ak-motion': 'var(--motion-slow, 320ms)',
      // Calm and settled: a slow, heavy arrival with no overshoot, like paper coming to rest.
      '--ak-spring-stiffness': '120',
      '--ak-spring-damping': '26',
      '--ak-spring-mass': '1',
    },
    note: 'Structure carries the page, not depth — the front page of a paper.',
  },
  {
    id: 'sticker',
    feel: 'playful: pill corners, the whole grid tilts, extruded titles, chunky offset shadows',
    imagery: 'flat sticker illustration, thick outline, white sticker border',
    structures: [],
    tokens: {
      '--ak-kinetic': 'letters',
      '--ak-radius': '24px',
      '--ak-radius-sm': '16px',
      '--ak-surface-image': 'none',
      '--ak-display-shadow': '0 4px 0 color-mix(in oklab, var(--ak-ink) 32%, var(--ak-surface))',
      '--ak-elev-1': '0 5px 0 color-mix(in oklab, var(--ak-ink) 20%, transparent)',
      '--ak-tilt': '-2deg',
      '--ak-enter-distance': '22px',
      '--ak-enter-stagger': '55ms',
      '--ak-ease': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      '--ak-weight-display': '800',
      // Rubbery: the spring matches the overshoot curve above, so a sticker wobbles into place.
      '--ak-spring-stiffness': '220',
      '--ak-spring-damping': '14',
      '--ak-spring-mass': '1',
    },
    note: 'The playful form language the game kit proved. The 3% secondary tint is deliberate: at 4% the aimeat palette\'s near-white card sank into the page (check:atelier, step 1.09).',
  },
  {
    id: 'neon-dense',
    feel: 'operator console: tight, mono display face, accent ring + glow on every card, fast',
    imagery: 'isometric technical illustration, blueprint linework',
    structures: [],
    tokens: {
      '--ak-main-max': '80rem',
      '--ak-radius': '8px',
      '--ak-radius-sm': '6px',
      '--ak-gap': '8px',
      '--ak-pad': '12px',
      '--ak-font-display': 'var(--ak-font-mono)',
      '--ak-surface-image': 'none',
      '--ak-elev-1': '0 0 0 1px color-mix(in oklab, var(--ak-accent) 45%, var(--ak-surface)), 0 0 18px color-mix(in oklab, var(--ak-accent) 22%, transparent)',
      '--ak-line': 'color-mix(in oklab, var(--ak-accent) 35%, var(--ak-ink-dim))',
      '--ak-hero-min': '18dvh',
      '--ak-enter-distance': '6px',
      '--ak-enter-stagger': '20ms',
      '--ak-motion': 'var(--motion-fast, 120ms)',
      '--ak-weight-display': '700',
      // The idle layer: the floor grid, scrolling at half strength.
      '--ak-ambient': 'grid',
      '--ak-ambient-alpha': '0.5',
      '--ak-ambient-speed': '1',
      // Console-quick: stiff and light, a hair of overshoot so the panel still reads as alive.
      '--ak-spring-stiffness': '300',
      '--ak-spring-damping': '26',
      '--ak-spring-mass': '0.9',
    },
    note: 'The neon is the edge, not the fill: the ring and glow carry the current, the tint stays at 4% so a card never sinks into a light page.',
  },
  {
    id: 'poster',
    feel: 'one giant focal statement on the brand gradient, edge to edge; everything else recedes',
    imagery: 'bold graphic poster art, dominant brand hue',
    structures: ['full-bleed-hero'],
    tokens: {
      '--ak-hero-min': '48dvh',
      '--ak-hero-image': 'none',
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 85%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-2) 72%, var(--ak-ink)))',
      '--ak-text-hero': 'clamp(3rem, 11vw, 5.2rem)',
      '--ak-weight-display': '900',
      '--ak-display-shadow': '0 4px 0 color-mix(in oklab, var(--ak-ink) 30%, transparent)',
      '--ak-surface-image': 'none',
      '--ak-elev-1': 'none',
      '--ak-enter-distance': '24px',
      '--ak-enter-stagger': '70ms',
      // Weighty: extra mass and a soft damping, so a poster statement lands and rocks once.
      '--ak-spring-stiffness': '190',
      '--ak-spring-damping': '18',
      '--ak-spring-mass': '1.1',
    },
    note: 'The band\'s ground is the brand gradient itself — poster means committing; the scrim under the title is still what AK-SCRIM verifies.',
  },
  {
    id: 'broadsheet',
    feel: 'the big paper: an even bigger masthead than editorial, heavy rules, joined columns, ink on paper',
    imagery: 'engraved editorial illustration, single-colour ink on paper',
    structures: ['masthead', 'joined'],
    tokens: {
      '--ak-main-max': '78rem',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-page-image': 'none',
      '--ak-grain': 'none',
      '--ak-blur': '0px',
      '--ak-glass': 'var(--ak-surface)',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)))',
      '--ak-elev-1': 'none',
      '--ak-elev-2': 'none',
      '--ak-radius': '0px',
      '--ak-radius-sm': '0px',
      '--ak-line': 'color-mix(in oklab, var(--ak-ink) 45%, var(--ak-bg))',
      '--ak-text-hero': 'clamp(3.2rem, 11vw, 6.4rem)',
      '--ak-weight-display': '750',
      '--ak-enter-distance': '0px',
      '--ak-enter-stagger': '70ms',
      '--ak-motion': 'var(--motion-slow, 320ms)',
      // Editorial's own hand, slower: the biggest paper moves last and never springs back.
      '--ak-spring-stiffness': '110',
      '--ak-spring-damping': '26',
      '--ak-spring-mass': '1.1',
    },
    note: 'Editorial\'s bigger sibling: square everything, darker hairlines, a masthead that owns the fold.',
  },
  {
    id: 'gallery',
    feel: 'airy exhibition: generous space, thin giant display, hairlines only, the work is the hero',
    imagery: 'large-format photography, muted tones, gallery lighting',
    structures: ['full-bleed-hero'],
    tokens: {
      '--ak-main-max': '80rem',
      '--ak-pad': '22px',
      '--ak-gap': '22px',
      '--ak-surface-image': 'none',
      '--ak-page-image': 'none',
      '--ak-grain': 'none',
      '--ak-elev-1': 'none',
      '--ak-elev-2': 'none',
      '--ak-radius': '0px',
      '--ak-radius-sm': '0px',
      '--ak-text-hero': 'clamp(2.8rem, 9vw, 5rem)',
      '--ak-weight-display': '550',
      '--ak-enter-distance': '10px',
      '--ak-enter-stagger': '70ms',
      '--ak-motion': 'var(--motion-slow, 320ms)',
      // Weightless and slow: critically damped, so nothing in the room draws attention to itself.
      '--ak-spring-stiffness': '130',
      '--ak-spring-damping': '24',
      '--ak-spring-mass': '1',
    },
    note: 'The room recedes so the work can speak: no shadows, no tints, hairline edges, a thin giant title over the full-bleed band.',
  },
  {
    id: 'brutalist',
    feel: 'loud and square: thick ink borders, hard offset shadows, maximum weight, no apologies',
    imagery: 'high-contrast xerox collage, harsh halftone',
    structures: [],
    tokens: {
      '--ak-line-w': '2px',
      '--ak-line': 'color-mix(in oklab, var(--ak-ink) 80%, var(--ak-bg))',
      '--ak-radius': '0px',
      '--ak-radius-sm': '0px',
      '--ak-surface-image': 'none',
      '--ak-page-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)))',
      '--ak-blur': '0px',
      '--ak-glass': 'var(--ak-surface)',
      '--ak-elev-1': '5px 5px 0 color-mix(in oklab, var(--ak-ink) 85%, transparent)',
      '--ak-elev-2': '8px 8px 0 color-mix(in oklab, var(--ak-ink) 85%, transparent)',
      '--ak-display-shadow': '3px 3px 0 color-mix(in oklab, var(--ak-accent) 70%, var(--ak-bg))',
      '--ak-text-hero': 'clamp(2.6rem, 9vw, 4.6rem)',
      '--ak-weight-display': '900',
      '--ak-enter-distance': '10px',
      '--ak-enter-stagger': '30ms',
      // Blunt: very stiff, barely a wobble, so a block arrives where it was going and stops dead.
      '--ak-spring-stiffness': '340',
      '--ak-spring-damping': '30',
      '--ak-spring-mass': '1',
    },
    note: 'Depth as printed offset, never blur; the accent appears as the display type\'s hard shadow.',
  },
  {
    id: 'carnival',
    feel: 'the fairground at full volume: a saturated three-hue banner, thick ink borders, hard offset shadows, tilted stickers, maximum energy',
    imagery: 'vibrant pop-art carnival illustration, saturated colours, bold outlines, confetti energy',
    structures: ['full-bleed-hero'],
    tokens: {
      '--ak-kinetic': 'letters',
      '--ak-hero-min': '44dvh',
      '--ak-hero-image': 'none',
      '--ak-grad': 'linear-gradient(150deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-2) 76%, var(--ak-ink)) 55%, color-mix(in oklab, var(--ak-spectrum-3) 70%, var(--ak-ink)))',
      '--ak-line-w': '2px',
      '--ak-line': 'color-mix(in oklab, var(--ak-ink) 85%, var(--ak-bg))',
      '--ak-radius': '12px',
      '--ak-radius-sm': '8px',
      '--ak-surface-image': 'none',
      '--ak-elev-1': '5px 5px 0 color-mix(in oklab, var(--ak-ink) 88%, transparent)',
      '--ak-elev-2': '9px 9px 0 color-mix(in oklab, var(--ak-ink) 88%, transparent)',
      '--ak-display-shadow': '3px 3px 0 color-mix(in oklab, var(--ak-ink) 40%, transparent)',
      '--ak-text-hero': 'clamp(3rem, 11vw, 5.4rem)',
      '--ak-weight-display': '900',
      '--ak-tilt': '-1.6deg',
      '--ak-enter-distance': '26px',
      '--ak-enter-stagger': '60ms',
      '--ak-ease': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-ink) 14%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-display-stroke': '0',
      // Bouncy: the loudest hand there is, a real overshoot and two visible swings back.
      '--ak-spring-stiffness': '200',
      '--ak-spring-damping': '12',
      '--ak-spring-mass': '1',
    },
    note: 'The front-demo2 register as arithmetic: a three-hue brand banner (every stop mixed over ink, so the mesh cap never applies and AK-GRAD proves the action ink on each), the INVERSE BAND (light hero ink on the saturated ground, a thin dark scrim instead of the pale wash — the pair AK-SCRIM now proves), depth as printed offset like brutalist, the tilt doing the sticker work. Loud is a look, not an accident.',
  },
  {
    id: 'billboard',
    feel: 'the whole screen is the poster: carnival\'s energy edge to edge, no measure column, a half-screen banner — for fronts, showcases and anything that should fill the room',
    imagery: 'vibrant pop-art carnival illustration, saturated colours, bold outlines, wide panoramic energy',
    structures: ['full-bleed-hero'],
    tokens: {
      '--ak-kinetic': 'letters',
      '--ak-main-max': '100%',
      '--ak-hero-min': '52dvh',
      '--ak-hero-image': 'none',
      '--ak-grad': 'linear-gradient(150deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-2) 76%, var(--ak-ink)) 55%, color-mix(in oklab, var(--ak-spectrum-3) 70%, var(--ak-ink)))',
      '--ak-line-w': '2px',
      '--ak-line': 'color-mix(in oklab, var(--ak-ink) 85%, var(--ak-bg))',
      '--ak-radius': '14px',
      '--ak-radius-sm': '10px',
      '--ak-gap': '18px',
      '--ak-surface-image': 'none',
      '--ak-elev-1': '6px 6px 0 color-mix(in oklab, var(--ak-ink) 88%, transparent)',
      '--ak-elev-2': '10px 10px 0 color-mix(in oklab, var(--ak-ink) 88%, transparent)',
      '--ak-display-shadow': '3px 3px 0 color-mix(in oklab, var(--ak-ink) 40%, transparent)',
      '--ak-text-hero': 'clamp(3.2rem, 12vw, 6.4rem)',
      '--ak-weight-display': '900',
      '--ak-tilt': '-1.6deg',
      '--ak-enter-distance': '30px',
      '--ak-enter-stagger': '55ms',
      '--ak-ease': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-ink) 14%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-display-stroke': '0',
      // Carnival's bounce with room-scale weight: bigger things swing wider and take longer.
      '--ak-spring-stiffness': '210',
      '--ak-spring-damping': '13',
      '--ak-spring-mass': '1.2',
    },
    note: 'The developer\'s ask, verbatim in spirit: why is everything a lane in the middle of the screen? Billboard drops the measure column entirely (--ak-main-max 100%) and grows the banner to half the viewport — carnival\'s inverse band and printed depth, at room scale. The narrow-screen story is unchanged: the column was never narrower than the phone.',
  },
  {
    id: 'aurora',
    feel: 'vivid at full volume: a taller drifting aurora, wider spectrum, deeper glass, edge to edge',
    imagery: 'flowing aurora gradients, long exposure light, deep atmosphere',
    structures: ['full-bleed-hero'],
    tokens: {
      '--ak-spectrum-2': 'oklch(from var(--ak-accent) l c calc(h + 120))',
      '--ak-spectrum-3': 'oklch(from var(--ak-accent) l c calc(h - 90))',
      '--ak-hero-min': '42dvh',
      '--ak-blur': '18px',
      '--ak-glass': 'color-mix(in oklab, var(--ak-surface) 66%, transparent)',
      '--ak-radius': '18px',
      '--ak-enter-distance': '26px',
      '--ak-enter-stagger': '70ms',
      '--ak-weight-display': '800',
      // The one layer that moves at idle: the aurora drift, at the whisper — this look stands on
      // the palette's own page, so the matrix holds it to the AK-PAGE cap.
      '--ak-ambient': 'aurora',
      '--ak-ambient-alpha': '0.3',
      '--ak-ambient-speed': '1',
      // Drifting: the loosest hand, heavy and slow to settle, motion as weather.
      '--ak-spring-stiffness': '140',
      '--ak-spring-damping': '18',
      '--ak-spring-mass': '1.3',
    },
    note: 'The spectrum spreads wider (+120/-90), the band grows, the glass deepens — the look for an app that wants to feel like weather.',
  },
];

/** Every look: the page looks first, then the worlds — the order a picker and the prompt show. */
export const LOOKS: readonly AtelierLook[] = [...PAGE_LOOKS, ...WORLD_LOOKS];

const byId = new Map(LOOKS.map((l) => [l.id, l]));

/** The look, or undefined. */
export function lookById(id: string): AtelierLook | undefined {
  return byId.get(id);
}
