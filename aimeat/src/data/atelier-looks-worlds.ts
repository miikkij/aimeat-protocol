/**
 * @file src/data/atelier-looks-worlds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE WORLDS — the looks that OWN THEIR GROUND: literal bg/surface/ink values, one
 *   set per mode, proven by the matrix in both (terminal's phosphor, riso's paper, stage's
 *   night, broadcast's night gallery, lounge's navy with the wave through it, dawn's warm paper
 *   with the aurora under it). A pure extraction from atelier-looks.ts on 2026-09-05, the day
 *   lounge and dawn took the registry past the 800-line cap; the entries are byte for byte what
 *   they were, and LOOKS in atelier-looks.ts composes them after the looks that stand on the
 *   palette's own page. Everything else about a look — the shape, the rules, the purity gate —
 *   is documented in atelier-looks.ts.
 * @structure WORLD_LOOKS
 * @usage
 *   import { LOOKS } from '../data/atelier-looks.js';   // the composed list, worlds included
 * @version-history
 *   v1.0.0 — 2026-09-05 — Pure extraction of the six worlds (wish-atelier-ambient-visuals).
 */
import type { AtelierLook } from './atelier-look-shape.js';

/** The looks that own their ground, in the order they arrived. */
export const WORLD_LOOKS: readonly AtelierLook[] = [
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
      // The idle layer: the floor grid, faint and a step slower — phosphor, not neon.
      '--ak-ambient': 'grid',
      '--ak-ambient-alpha': '0.35',
      '--ak-ambient-speed': '0.8',
      // Mechanical: the stiffest hand in the registry, light and near-critical. A state change
      // rather than a movement, because a machine does not ease.
      '--ak-spring-stiffness': '380',
      '--ak-spring-damping': '32',
      '--ak-spring-mass': '0.8',
    },
    note: 'Everything is the mono face and a hairline grid; the grain stays on, like phosphor.',
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
      // Pressed: firm and quick with one small rebound, the way a plate meets paper.
      '--ak-spring-stiffness': '180',
      '--ak-spring-damping': '22',
      '--ak-spring-mass': '1',
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
      // The idle layer: dust in the spotlight, slow.
      '--ak-ambient': 'dust',
      '--ak-ambient-alpha': '0.7',
      '--ak-ambient-speed': '0.7',
      // Floating: soft and heavy, so a glass panel glides to rest instead of snapping to it.
      '--ak-spring-stiffness': '160',
      '--ak-spring-damping': '20',
      '--ak-spring-mass': '1.2',
    },
    note: 'The atmosphere half of the lit-stage direction: spotlight ambient, glass panels, glow depth — proven in both modes by the matrix, truest in the dark. The WebGL ground (universe camera, twin scenes) arrives as a vendored lib on top; this look is its guaranteed flat fallback.',
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
      // The idle layer: the static between channels, at a whisper under the scanlines.
      '--ak-ambient': 'static',
      '--ak-ambient-alpha': '0.35',
      '--ak-ambient-speed': '1',
      // Snappy and springy: a hard cut in, one overshoot, gone. The station ident's timing.
      '--ak-spring-stiffness': '260',
      '--ak-spring-damping': '16',
      '--ak-spring-mass': '1',
    },
    note: 'The night-gallery direction the developer accepted on the Atelier Next canvas (2026-09-01): a WORLD with two proven grounds — violet night by default, a pale violet paper in light — display type at maximum weight with the accent landing a step off, printed offset depth in the spectrum hues, sticker tilt. The channel colours stay the contract\'s television neons on purpose: retuning them from the palette accent was tried and muddied the signal yellow into olive, and the identity IS the neon.',
  },
  {
    id: 'lounge',
    feel: 'the console at rest: a deep navy night with the wave moving through it, thin display type, glass that floats, everything a beat slower — the room a person leaves running',
    imagery: 'deep navy night, translucent light ribbons in slow curves, soft bloom, floating glass panels, long exposure',
    structures: ['full-bleed-hero'],
    dusk: {
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 78%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-3) 66%, var(--ak-ink)))',
    },
    grounds: {
      light: {
        '--ak-bg': '#070b18',
        '--ak-surface': '#10182c',
        '--ak-surface-2': '#050813',
        '--ak-ink': '#eef2ff',
        '--ak-ink-dim': '#a9b2cf',
      },
      dark: {
        '--ak-bg': '#070b18',
        '--ak-surface': '#10182c',
        '--ak-surface-2': '#050813',
        '--ak-ink': '#eef2ff',
        '--ak-ink-dim': '#a9b2cf',
      },
    },
    tokens: {
      // The wave, loud: this world owns its night, so the matrix proves the words over it.
      '--ak-ambient': 'waves',
      '--ak-ambient-alpha': '0.8',
      '--ak-ambient-speed': '1',
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 55%, var(--ak-ink))',
      // The wave is the weather: no still page image under it, no card mesh over it.
      '--ak-page-image': 'none',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-line': 'color-mix(in oklab, var(--ak-accent) 18%, var(--ak-ink-dim))',
      '--ak-line-w': '1px',
      '--ak-radius': '16px',
      '--ak-radius-sm': '10px',
      '--ak-blur': '18px',
      '--ak-glass': 'color-mix(in oklab, var(--ak-surface) 62%, transparent)',
      '--ak-elev-1': '0 8px 28px color-mix(in oklab, var(--ak-surface-2) 60%, transparent)',
      '--ak-elev-2': '0 18px 48px color-mix(in oklab, var(--ak-surface-2) 75%, transparent), 0 0 32px color-mix(in oklab, var(--ak-accent) 14%, transparent)',
      '--ak-grad': 'linear-gradient(160deg, color-mix(in oklab, var(--ak-accent) 78%, var(--ak-surface-2)), color-mix(in oklab, var(--ak-spectrum-3) 66%, var(--ak-surface-2)))',
      '--ak-scrim': 'color-mix(in oklab, var(--ak-surface-2) 24%, transparent)',
      '--ak-hero-ink': 'var(--ak-accent-ink)',
      '--ak-hero-ink-dim': 'var(--ak-accent-ink)',
      '--ak-hero-min': '36dvh',
      '--ak-text-hero': 'clamp(2.4rem, 8vw, 4.2rem)',
      '--ak-weight-display': '600',
      '--ak-enter-distance': '20px',
      '--ak-enter-stagger': '80ms',
      '--ak-motion': '320ms',
      '--ak-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
      // Soft and a little heavy: a panel drifts to rest the way the wave does.
      '--ak-spring-stiffness': '150',
      '--ak-spring-damping': '22',
      '--ak-spring-mass': '1.1',
    },
    note: 'The PlayStation register as a WORLD, because that is the only way it reads: a wave over a palette page is a stain, a wave over a proven navy is light. Permanent night in both modes, the ink near white, the wave at eight tenths with the matrix proving body ink and accent text over its three pigments; glass deeper than aurora\'s so a panel floats on the water rather than sitting on it.',
  },
  {
    id: 'dawn',
    feel: 'first light: warm pale paper with the aurora drifting under it, soft edges, a gentle hand — the morning register',
    imagery: 'warm dawn light on paper, a soft peach and rose haze, long slow gradients, quiet',
    structures: [],
    grounds: {
      // The paper is a step deeper than the card (1.13 between them; the matrix wants 1.10),
      // and the hairline is a literal per mode because an expression off the ink sat at 1.21
      // against the night card where 1.30 is the floor.
      light: {
        '--ak-bg': '#f6eadb',
        '--ak-surface': '#fffaf4',
        '--ak-surface-2': '#efe0cf',
        '--ak-ink': '#2a2330',
        '--ak-ink-dim': '#5c5364',
        '--ak-line': '#e2d6c8',
      },
      dark: {
        '--ak-bg': '#1c1720',
        '--ak-surface': '#2b2533',
        '--ak-surface-2': '#140f18',
        '--ak-ink': '#f6efe8',
        '--ak-ink-dim': '#b3a9ad',
        '--ak-line': '#4a4152',
      },
    },
    tokens: {
      // The aurora at nine tenths: this world owns its paper, so the matrix proves the words
      // over it; the aurora look, standing on the palette page, keeps the same preset at 0.3.
      '--ak-ambient': 'aurora',
      '--ak-ambient-alpha': '0.9',
      '--ak-ambient-speed': '0.8',
      // Accent text leans further into the ink than the contract's, because it has to read
      // over the aurora at its loudest (3.7 at the contract's mix, over 5 here).
      '--ak-accent-text': 'color-mix(in oklab, var(--ak-accent) 52%, var(--ak-ink))',
      // The action band mixes toward the ink, which flips with the mode: deeper on paper for
      // the white action ink, lighter at night for the dark one (the contract's own mix read
      // 4.44 on this paper, a hair under the floor).
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 78%, var(--ak-ink)), color-mix(in oklab, var(--ak-spectrum-3) 72%, var(--ak-ink)))',
      '--ak-page-image': 'none',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'radial-gradient(at 20% 10%, color-mix(in oklab, var(--ak-accent) 22%, var(--ak-bg)), transparent 60%), radial-gradient(at 80% 90%, color-mix(in oklab, var(--ak-spectrum-3) 16%, var(--ak-bg)), transparent 55%)',
      '--ak-radius': '18px',
      '--ak-radius-sm': '12px',
      '--ak-blur': '14px',
      '--ak-elev-1': '0 6px 22px color-mix(in oklab, var(--ak-ink) 10%, transparent)',
      '--ak-elev-2': '0 14px 40px color-mix(in oklab, var(--ak-ink) 16%, transparent)',
      '--ak-weight-display': '700',
      '--ak-enter-distance': '18px',
      '--ak-enter-stagger': '70ms',
      '--ak-motion': '300ms',
      // Gentle: a slow hand that never bounces, the morning\'s tempo.
      '--ak-spring-stiffness': '140',
      '--ak-spring-damping': '22',
      '--ak-spring-mass': '1.1',
    },
    note: 'The light twin of lounge: a warm paper world with a dark twin for night, so the aurora may run at full volume under it — the matrix proves the ink over each lobe. No still page image, because the moving one is the ground; the hero keeps a low two-lobe wash so a page without the layer (Less motion, an older kit) still opens warm.',
  },
];
