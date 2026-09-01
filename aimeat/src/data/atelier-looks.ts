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
 * @structure AtelierStructure / AtelierLook · STRUCTURES · LOOKS · lookById()
 * @usage
 *   import { LOOKS, STRUCTURES } from '../data/atelier-looks.js';
 * @version-history
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

export interface AtelierLook {
  id: string;
  /** How it feels — the picker's words. */
  feel: string;
  /** The imagery pipeline's style words for this look. */
  imagery: string;
  /** Structure recipes this look uses, by id. */
  structures: string[];
  /** Token overrides on the --ak-* contract. Empty for the base look (vivid IS the contract). */
  tokens: Record<string, string>;
  /** A WORLD owns its ground: literal values for the ground tokens (bg, surface, surface-2,
   *  ink, ink-dim, line), one set per mode — paper for a print world, phosphor for a machine
   *  one, night for a stage. The matrix runs every check against these in both modes, which is
   *  what makes the literals legal: a look never ships an UNPROVEN colour. A world that is
   *  always dark simply declares the same set twice. */
  grounds?: { light: Record<string, string>; dark: Record<string, string> };
  /** Dark-mode token EXPRESSIONS layered with the dark ground (var()/color-mix only — the
   *  purity check covers them): for the values whose polarity flips with the palette's accent,
   *  like the action band. */
  dusk?: Record<string, string>;
  /** The comment above the generated block — why this look is what it is. */
  note: string;
}

// ── The looks ────────────────────────────────────────────────────────────────────────────────

export const LOOKS: readonly AtelierLook[] = [
  {
    id: 'vivid',
    feel: 'the default — an aurora hero on the derived spectrum, tinted cards, glass chrome, a real entrance; pick when unsure',
    imagery: 'bright layered gradient-mesh abstract, soft grain, airy light ground',
    structures: [],
    tokens: {},
    note: 'The base contract IS vivid; this entry exists for the picker and the prompt table.',
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
    },
    note: 'Depth as printed offset, never blur; the accent appears as the display type\'s hard shadow.',
  },
  {
    id: 'terminal',
    feel: 'the machine speaks: mono everything, joined cells, dense, grain like phosphor',
    imagery: 'ASCII and wireframe schematics, phosphor glow',
    structures: ['joined'],
    dusk: {
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 76%, var(--ak-ink)))',
    },
    grounds: {
      light: {
        '--ak-bg': '#04120a',
        '--ak-surface': '#0f2416',
        '--ak-surface-2': '#020a05',
        '--ak-ink': '#aef2c4',
        '--ak-ink-dim': '#5fae7f',
      },
      dark: {
        '--ak-bg': '#04120a',
        '--ak-surface': '#0f2416',
        '--ak-surface-2': '#020a05',
        '--ak-ink': '#aef2c4',
        '--ak-ink-dim': '#5fae7f',
      },
    },
    tokens: {
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-surface-2)), color-mix(in oklab, var(--ak-accent) 76%, var(--ak-surface-2)))',
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 52%, var(--ak-ink))',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-surface-2) 16%, transparent)',
      '--ak-page-grain': 'var(--ak-grain)',
      '--ak-main-max': '80rem',
      '--ak-font': 'var(--ak-font-mono)',
      '--ak-font-display': 'var(--ak-font-mono)',
      '--ak-radius': '0px',
      '--ak-radius-sm': '0px',
      '--ak-gap': '6px',
      '--ak-pad': '10px',
      '--ak-surface-image': 'none',
      '--ak-page-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-line': 'color-mix(in oklab, var(--ak-accent) 40%, var(--ak-ink-dim))',
      '--ak-elev-1': 'none',
      '--ak-elev-2': 'none',
      '--ak-hero-min': '14dvh',
      '--ak-text-hero': 'clamp(1.6rem, 5vw, 2.4rem)',
      '--ak-weight-display': '700',
      '--ak-enter-distance': '4px',
      '--ak-enter-stagger': '15ms',
      '--ak-motion': 'var(--motion-fast, 120ms)',
    },
    note: 'Everything is the mono face and a hairline grid; the grain stays on, like phosphor.',
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
    },
    note: 'The developer\'s ask, verbatim in spirit: why is everything a lane in the middle of the screen? Billboard drops the measure column entirely (--ak-main-max 100%) and grows the banner to half the viewport — carnival\'s inverse band and printed depth, at room scale. The narrow-screen story is unchanged: the column was never narrower than the phone.',
  },
  {
    id: 'riso',
    feel: 'two inks printed slightly off register: flat blocks, a hard second-hue type shadow, paper grain everywhere, no shadows because print has none — the miss is the style',
    imagery: 'risograph print, two-colour overprint, flat shapes, visible paper grain, slight misregistration',
    structures: ['press-sheet'],
    dusk: {
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 72%, var(--ak-ink))',
    },
    grounds: {
      light: {
        '--ak-bg': '#efe6d2',
        '--ak-surface': '#fbf6ea',
        '--ak-surface-2': '#e6dabf',
        '--ak-ink': '#241e13',
        '--ak-ink-dim': '#655a44',
      },
      dark: {
        '--ak-bg': '#211a10',
        '--ak-surface': '#2d2517',
        '--ak-surface-2': '#171208',
        '--ak-ink': '#f2e9d4',
        '--ak-ink-dim': '#bfb297',
      },
    },
    tokens: {
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 58%, var(--ak-ink))',
      '--ak-kinetic': 'words',
      '--ak-page-grain': 'var(--ak-grain)',
      '--ak-line-w': '2px',
      '--ak-line': 'color-mix(in oklab, var(--ak-accent) 72%, var(--ak-ink))',
      '--ak-radius': '4px',
      '--ak-radius-sm': '2px',
      '--ak-surface-image': 'none',
      '--ak-page-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-grad': 'linear-gradient(0deg, color-mix(in oklab, var(--ak-accent) 82%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 76%, var(--ak-ink)))',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-ink) 14%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-elev-1': 'none',
      '--ak-elev-2': 'none',
      '--ak-display-shadow': '4px 3px 0 color-mix(in oklab, var(--ak-spectrum-2) 65%, transparent)',
      '--ak-display-stroke': '0',
      '--ak-text-hero': 'clamp(2.6rem, 9vw, 4.6rem)',
      '--ak-weight-display': '900',
      '--ak-tilt': '-1.2deg',
      '--ak-enter-distance': '18px',
      '--ak-enter-stagger': '50ms',
      '--ak-ease': 'cubic-bezier(0.2, 0.9, 0.3, 1)',
      '--ak-hero-min': '30dvh',
    },
    note: 'The print-shop world: separation comes from the 2px accent-mixed edge and the paper grain, never from a shadow (print has none). The display shadow is the second ink landing a millimetre off, and the masthead is a solid ink plate so the pair AK-SCRIM proves stays the same arithmetic carnival passes.',
  },
  {
    id: 'stage',
    feel: 'the lit stage: a spotlight falls from above, panels float as glass with a glowing edge, depth everywhere — the room a digital twin lives in',
    imagery: 'spotlit dark stage, wireframe schematics, floating glass panels, atmospheric depth',
    structures: ['marquee'],
    dusk: {
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 80%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-3) 70%, var(--ak-ink)))',
    },
    grounds: {
      light: {
        '--ak-bg': '#0b0d16',
        '--ak-surface': '#171b2b',
        '--ak-surface-2': '#060810',
        '--ak-ink': '#e9ecf6',
        '--ak-ink-dim': '#a6abc2',
      },
      dark: {
        '--ak-bg': '#0b0d16',
        '--ak-surface': '#171b2b',
        '--ak-surface-2': '#060810',
        '--ak-ink': '#e9ecf6',
        '--ak-ink-dim': '#a6abc2',
      },
    },
    tokens: {
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 55%, var(--ak-ink))',
      '--ak-page-image': 'radial-gradient(at 50% 0%, color-mix(in oklab, var(--ak-accent) 16%, var(--ak-bg)), transparent 58%), radial-gradient(at 86% 92%, color-mix(in oklab, var(--ak-spectrum-3) 11%, var(--ak-bg)), transparent 54%)',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-line': 'color-mix(in oklab, var(--ak-accent) 22%, var(--ak-ink-dim))',
      '--ak-line-w': '1px',
      '--ak-radius': '14px',
      '--ak-radius-sm': '10px',
      '--ak-blur': '10px',
      '--ak-elev-1': '0 6px 24px color-mix(in oklab, var(--ak-ink) 28%, transparent)',
      '--ak-elev-2': '0 14px 44px color-mix(in oklab, var(--ak-ink) 42%, transparent), 0 0 30px color-mix(in oklab, var(--ak-accent) 18%, transparent)',
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 80%, var(--ak-surface-2)), color-mix(in oklab, var(--ak-spectrum-3) 70%, var(--ak-surface-2)))',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-surface-2) 18%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-hero-min': '38dvh',
      '--ak-text-hero': 'clamp(2.6rem, 9vw, 4.8rem)',
      '--ak-weight-display': '800',
      '--ak-enter-distance': '34px',
      '--ak-enter-stagger': '70ms',
      '--ak-motion': '260ms',
      '--ak-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    note: 'The atmosphere half of the lit-stage direction: spotlight ambient, glass panels, glow depth — proven in both modes by the matrix, truest in the dark. The WebGL ground (universe camera, twin scenes) arrives as a vendored lib on top; this look is its guaranteed flat fallback.',
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
    },
    note: 'The spectrum spreads wider (+120/-90), the band grows, the glass deepens — the look for an app that wants to feel like weather.',
  },
  {
    id: 'broadcast',
    feel: 'the night gallery: display type that owns the room, exhibits under gallery light with hard offset shadows in the channel colours, one signal band for the loud action — a shelf staged as its own broadcast',
    imagery: '80s music television at night, neon channel colours on a dark stage, CRT glow, block display type, sprayed tags',
    structures: ['press-sheet'],
    dusk: {
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 70%, var(--ak-ink))',
    },
    grounds: {
      light: {
        '--ak-bg': '#f4f1f9',
        '--ak-surface': '#ffffff',
        '--ak-surface-2': '#e9e4f2',
        '--ak-ink': '#14101f',
        '--ak-ink-dim': '#5a5468',
      },
      dark: {
        '--ak-bg': '#0d0a16',
        '--ak-surface': '#1c1728',
        '--ak-surface-2': '#0b0813',
        '--ak-ink': '#f4f2fa',
        '--ak-ink-dim': '#a9a3b8',
      },
    },
    tokens: {
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 62%, var(--ak-ink))',
      '--ak-kinetic': 'letters',
      '--ak-page-image': 'radial-gradient(at 78% -5%, color-mix(in oklab, var(--ak-accent) 14%, var(--ak-bg)), transparent 60%), radial-gradient(at 8% 30%, color-mix(in oklab, var(--ak-spectrum-2) 9%, var(--ak-bg)), transparent 60%)',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-line': 'color-mix(in oklab, var(--ak-ink) 28%, var(--ak-bg))',
      '--ak-line-w': '1.5px',
      '--ak-radius': '6px',
      '--ak-radius-sm': '3px',
      '--ak-radius-pill': '3px',
      '--ak-elev-1': '8px 8px 0 color-mix(in oklab, var(--ak-crt-ch1) 42%, transparent)',
      '--ak-elev-2': '12px 12px 0 color-mix(in oklab, var(--ak-crt-ch2) 60%, transparent)',
      '--ak-grad': 'linear-gradient(150deg, color-mix(in oklab, var(--ak-accent) 84%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-2) 74%, var(--ak-ink)))',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-ink) 14%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-display-shadow': '4px 4px 0 color-mix(in oklab, var(--ak-accent) 55%, transparent)',
      '--ak-display-stroke': '0',
      '--ak-text-hero': 'clamp(3.2rem, 11vw, 6.2rem)',
      // The faces are the look's own: Archivo Black (one cut, so the weight is 400) for display,
      // Archivo for reading, JetBrains Mono for the machine lines — all self-hosted by the node.
      '--ak-font-display': "'Archivo Black', Archivo, system-ui, sans-serif",
      '--ak-font': 'Archivo, system-ui, sans-serif',
      '--ak-font-mono': "'JetBrains Mono', ui-monospace, monospace",
      '--ak-weight-display': '400',
      '--ak-tilt': '-1.2deg',
      '--ak-enter-distance': '24px',
      '--ak-enter-stagger': '60ms',
      '--ak-ease': 'cubic-bezier(0.34, 1.3, 0.5, 1)',
      '--ak-hero-min': '30dvh',
    },
    note: 'The night-gallery direction the developer accepted on the Atelier Next canvas (2026-09-01): a WORLD with two proven grounds — violet night by default, a pale violet paper in light — display type at maximum weight with the accent landing a step off, printed offset depth in the spectrum hues, sticker tilt. The channel colours stay the contract\'s television neons on purpose: retuning them from the palette accent was tried and muddied the signal yellow into olive, and the identity IS the neon.',
  },
];

const byId = new Map(LOOKS.map((l) => [l.id, l]));

/** The look, or undefined. */
export function lookById(id: string): AtelierLook | undefined {
  return byId.get(id);
}
