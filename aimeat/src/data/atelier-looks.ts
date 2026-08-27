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
 *   A LOOK NEVER INTRODUCES A COLOUR: every colour value is an expression over the theme tokens
 *   (color-mix in oklab, the OKLCh spectrum rotations). That rule is what makes the matrix able
 *   to prove all of this arithmetically.
 * @structure AtelierStructure / AtelierLook · STRUCTURES · LOOKS · lookById()
 * @usage
 *   import { LOOKS, STRUCTURES } from '../data/atelier-looks.js';
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial: the seven hand-written presets become entries, five new looks
 *     arrive as proof the factory works (broadsheet, gallery, brutalist, terminal, aurora), and
 *     the three structures extracted from editorial/poster become shared vocabulary.
 */

/** A named, reusable page-shape recipe. `css(sel)` emits its rules scoped to one look. */
export interface AtelierStructure {
  id: string;
  /** One sentence for the catalogue and the data sheet. */
  summary: string;
  /** The rules, scoped to the given look selector (e.g. "[data-ak-look='editorial']"). */
  css: (sel: string) => string;
}

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
  /** The comment above the generated block — why this look is what it is. */
  note: string;
}

// ── The structures: page shapes, written once, reused by any look ────────────────────────────

export const STRUCTURES: readonly AtelierStructure[] = [
  {
    id: 'masthead',
    summary: 'The hero is a front-page masthead: giant display type on rules, no card, no mesh — and the news under it separates with RULES, not boxes (a card widget inside a newspaper was the first design review\'s finding).',
    css: (sel) => `
${sel} .ak-hero {
  min-height: unset;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  border-top: 3px solid var(--ak-ink);
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  overflow: visible;
}
${sel} .ak-hero::before,
${sel} .ak-hero__scrim { display: none; }
${sel} .ak-hero__inner { padding: calc(var(--ak-pad) * 1.25) 0; }
${sel} .ak-hero__title {
  font-size: clamp(2.8rem, 9vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
}
${sel} .ak-hero__sub { font-size: var(--ak-text-title); }
${sel} .ak-statrow { gap: 0; }
${sel} .ak-statrow__tile {
  border: 0;
  border-right: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: calc(var(--ak-pad) * 1.25) var(--ak-pad);
  transform: none;
}
${sel} .ak-statrow__tile:last-child { border-right: 0; }
${sel} .ak-statrow__value { font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; }
${sel} .ak-statrow__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--ak-font-mono);
}
${sel} .ak-list__row {
  border: 0;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding-inline: 0;
}
${sel} .ak-list .ak-badge {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--ak-font-mono);
  font-size: var(--ak-text-fine);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ak-ink-dim);
}`,
  },
  {
    id: 'joined',
    summary: 'Cells share hairlines inside one bordered frame — a laid-out page, not floating cards.',
    css: (sel) => `
${sel} .ak-mosaic__units--grid {
  gap: 0;
  border: var(--ak-line-w) solid var(--ak-line);
}
${sel} .ak-mosaic__units--grid .ak-mosaic__unit {
  align-self: stretch;
  border-right: var(--ak-line-w) solid var(--ak-line);
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  padding: var(--ak-pad);
  margin-right: calc(-1 * var(--ak-line-w));
  margin-bottom: calc(-1 * var(--ak-line-w));
}
${sel} .ak-mosaic .ak-section {
  border: 0;
  box-shadow: none;
  background: transparent;
  padding: 0;
}`,
  },
  {
    id: 'full-bleed-hero',
    summary: 'The focal band runs edge to edge, out of the measure column.',
    css: (sel) => `
${sel} .ak-mosaic__band .ak-hero {
  border-radius: 0;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
}
/* The band escapes the column; its TEXT stays aligned to it — found in the first
 * real-data experiment run, where the title clipped at the viewport edge. */
${sel} .ak-mosaic__band .ak-hero .ak-hero__inner {
  padding-inline: max(var(--ak-pad), calc((100vw - min(var(--ak-main-max), 100vw)) / 2 + var(--ak-pad)));
}`,
  },
];

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
      '--ak-surface-image': 'linear-gradient(180deg, color-mix(in oklab, var(--ak-accent) 3%, var(--ak-surface)), var(--ak-surface))',
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
      '--ak-radius': '24px',
      '--ak-radius-sm': '16px',
      '--ak-surface-image': 'linear-gradient(180deg, color-mix(in oklab, var(--ak-accent-2) 3%, var(--ak-surface)), var(--ak-surface))',
      '--ak-display-shadow': '0 4px 0 color-mix(in oklab, var(--ak-ink) 32%, var(--ak-surface))',
      '--ak-elev-1': '0 5px 0 color-mix(in oklab, var(--ak-ink) 20%, transparent)',
      '--ak-tilt': '-2deg',
      '--ak-enter-distance': '22px',
      '--ak-enter-stagger': '55ms',
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
      '--ak-surface-image': 'linear-gradient(180deg, color-mix(in oklab, var(--ak-accent) 4%, var(--ak-surface)), var(--ak-surface))',
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
    tokens: {
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
];

const byId = new Map(LOOKS.map((l) => [l.id, l]));

/** The look, or undefined. */
export function lookById(id: string): AtelierLook | undefined {
  return byId.get(id);
}
